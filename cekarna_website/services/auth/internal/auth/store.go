package auth

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var ErrDenied = errors.New("authentication denied")
var ErrReuse = errors.New("refresh token reused")
var ErrConflict = errors.New("workspace conflict")

type User struct {
	ID            string `json:"id"`
	Email         string `json:"email"`
	FirstName     string `json:"first_name"`
	EmailVerified bool   `json:"email_verified"`
}
type Session struct {
	ID, UserID string
	Expires    time.Time
}
type Store struct{ DB *pgxpool.Pool }

func (s Store) CandidateWorkspace(ctx context.Context, uid string) (json.RawMessage, time.Time, int64, error) {
	var workspace json.RawMessage
	var updated time.Time
	var revision int64
	err := s.DB.QueryRow(ctx, "SELECT workspace,updated_at,revision FROM candidate_workspaces WHERE user_id=$1", uid).Scan(&workspace, &updated, &revision)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, time.Time{}, 0, nil
	}
	return workspace, updated, revision, err
}

func (s Store) SaveCandidateWorkspace(ctx context.Context, uid string, workspace json.RawMessage, revision int64, overwrite bool) (time.Time, int64, error) {
	var updated time.Time
	var nextRevision int64
	err := s.DB.QueryRow(ctx, `INSERT INTO candidate_workspaces(user_id,workspace,revision)
VALUES($1,$2,1) ON CONFLICT(user_id) DO UPDATE SET workspace=EXCLUDED.workspace,updated_at=now(),revision=candidate_workspaces.revision+1
WHERE $4 OR candidate_workspaces.revision=$3 RETURNING updated_at,revision`, uid, workspace, revision, overwrite).Scan(&updated, &nextRevision)
	if errors.Is(err, pgx.ErrNoRows) {
		return time.Time{}, 0, ErrConflict
	}
	return updated, nextRevision, err
}

func (s Store) RevokeAll(ctx context.Context, uid, actor string) ([]string, error) {
	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	rows, err := tx.Query(ctx, "UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL RETURNING id", uid)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var sessionIDs []string
	for rows.Next() {
		var id string
		if err = rows.Scan(&id); err != nil {
			return nil, err
		}
		sessionIDs = append(sessionIDs, id)
	}
	if err = rows.Err(); err != nil {
		return nil, err
	}
	if err = auditTx(ctx, tx, "logout_all", uid, "", actor); err != nil {
		return nil, err
	}
	return sessionIDs, tx.Commit(ctx)
}

func (s Store) DeleteUser(ctx context.Context, uid string) error {
	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, "DELETE FROM audit_events WHERE user_id=$1", uid); err != nil {
		return err
	}
	command, err := tx.Exec(ctx, "DELETE FROM users WHERE id=$1", uid)
	if err != nil {
		return err
	}
	if command.RowsAffected() != 1 {
		return ErrDenied
	}
	return tx.Commit(ctx)
}

// Audit deliberately excludes emails, passwords, raw IPs and tokens.
func (s Store) Audit(ctx context.Context, event, uid, sid, actor string) error {
	_, err := s.DB.Exec(ctx, "INSERT INTO audit_events(event,user_id,session_id,actor_hash) VALUES($1,NULLIF($2,''),NULLIF($3,''),$4)", event, uid, sid, actor)
	return err
}
func auditTx(ctx context.Context, tx pgx.Tx, event, uid, sid, actor string) error {
	_, err := tx.Exec(ctx, "INSERT INTO audit_events(event,user_id,session_id,actor_hash) VALUES($1,NULLIF($2,''),NULLIF($3,''),$4)", event, uid, sid, actor)
	return err
}

// Register records the account when the address is free. It returns the new
// user id, or an empty string when the email was already taken — the handler
// must keep the response identical in both cases.
func (s Store) Register(ctx context.Context, email, name, passwordHash, actor string) (string, error) {
	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer tx.Rollback(ctx)
	id := randomToken()
	var inserted string
	err = tx.QueryRow(ctx, "INSERT INTO users(id,email,first_name) VALUES($1,$2,$3) ON CONFLICT(email) DO NOTHING RETURNING id", id, email, name).Scan(&inserted)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return "", err
	}
	if inserted != "" {
		if _, err = tx.Exec(ctx, "INSERT INTO credentials(user_id,password_hash) VALUES($1,$2)", id, passwordHash); err != nil {
			return "", err
		}
		workspace, workspaceErr := json.Marshal(map[string]any{
			"version": 1,
			"demo":    false,
			"profile": map[string]string{
				"firstName": name,
				"title":     "", "city": "", "contract": "", "skills": "", "about": "",
			},
			"jobs": []any{},
		})
		if workspaceErr != nil {
			return "", workspaceErr
		}
		if _, err = tx.Exec(ctx, "INSERT INTO candidate_workspaces(user_id,workspace,revision) VALUES($1,$2,0)", id, workspace); err != nil {
			return "", err
		}
	}
	if err = auditTx(ctx, tx, "registration_requested", inserted, "", actor); err != nil {
		return "", err
	}
	if err = tx.Commit(ctx); err != nil {
		return "", err
	}
	return inserted, nil
}
func (s Store) Credential(ctx context.Context, email string) (User, string, error) {
	var u User
	var hash string
	err := s.DB.QueryRow(ctx, "SELECT u.id,u.email,u.first_name,u.email_verified,c.password_hash FROM users u JOIN credentials c ON c.user_id=u.id WHERE u.email=$1 AND NOT u.disabled", email).Scan(&u.ID, &u.Email, &u.FirstName, &u.EmailVerified, &hash)
	if errors.Is(err, pgx.ErrNoRows) {
		err = ErrDenied
	}
	return u, hash, err
}
func (s Store) NewSession(ctx context.Context, uid, tokenHash, actor string) (Session, error) {
	session := Session{randomToken(), uid, time.Now().Add(30 * 24 * time.Hour)}
	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return Session{}, err
	}
	defer tx.Rollback(ctx)
	var enabled bool
	err = tx.QueryRow(ctx, "SELECT NOT disabled FROM users WHERE id=$1 FOR UPDATE", uid).Scan(&enabled)
	if err != nil {
		return Session{}, err
	}
	if !enabled {
		return Session{}, ErrDenied
	}
	_, err = tx.Exec(ctx, "INSERT INTO sessions(id,user_id,expires_at) VALUES($1,$2,$3)", session.ID, uid, session.Expires)
	if err != nil {
		return Session{}, err
	}
	_, err = tx.Exec(ctx, "INSERT INTO refresh_tokens(token_hash,session_id,expires_at) VALUES($1,$2,$3)", tokenHash, session.ID, time.Now().Add(7*24*time.Hour))
	if err != nil {
		return Session{}, err
	}
	if err = auditTx(ctx, tx, "login_succeeded", uid, session.ID, actor); err != nil {
		return Session{}, err
	}
	return session, tx.Commit(ctx)
}

func (s Store) Rotate(ctx context.Context, oldHash, newHash, actor string) (Session, error) {
	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return Session{}, err
	}
	defer tx.Rollback(ctx)
	var session Session
	var revoked, consumed *time.Time
	var tokenExpiry time.Time
	var disabled bool
	// All operations on a token family lock the parent session first. Concurrent
	// refreshes serialize; the loser revokes the entire family (strict replay policy).
	err = tx.QueryRow(ctx, `SELECT s.id,s.user_id,s.expires_at,s.revoked_at
 FROM sessions s JOIN refresh_tokens t ON t.session_id=s.id
 WHERE t.token_hash=$1 FOR UPDATE OF s`, oldHash).Scan(&session.ID, &session.UserID, &session.Expires, &revoked)
	if errors.Is(err, pgx.ErrNoRows) {
		return Session{}, ErrDenied
	}
	if err != nil {
		return Session{}, err
	}
	err = tx.QueryRow(ctx, "SELECT consumed_at,expires_at FROM refresh_tokens WHERE token_hash=$1", oldHash).Scan(&consumed, &tokenExpiry)
	if err != nil {
		return Session{}, err
	}
	if revoked != nil || !session.Expires.After(time.Now()) {
		return Session{}, ErrDenied
	}
	if consumed != nil {
		if _, err = tx.Exec(ctx, "UPDATE sessions SET revoked_at=now() WHERE id=$1", session.ID); err != nil {
			return Session{}, err
		}
		if err = auditTx(ctx, tx, "refresh_reuse", session.UserID, session.ID, actor); err != nil {
			return Session{}, err
		}
		if err = tx.Commit(ctx); err != nil {
			return Session{}, err
		}
		return session, ErrReuse
	}
	if !tokenExpiry.After(time.Now()) {
		return Session{}, ErrDenied
	}
	if err = tx.QueryRow(ctx, "SELECT disabled FROM users WHERE id=$1", session.UserID).Scan(&disabled); err != nil {
		return Session{}, err
	}
	if disabled {
		return Session{}, ErrDenied
	}
	if _, err = tx.Exec(ctx, "UPDATE refresh_tokens SET consumed_at=now() WHERE token_hash=$1", oldHash); err != nil {
		return Session{}, err
	}
	nextExpiry := time.Now().Add(7 * 24 * time.Hour)
	if nextExpiry.After(session.Expires) {
		nextExpiry = session.Expires
	}
	if _, err = tx.Exec(ctx, "INSERT INTO refresh_tokens(token_hash,session_id,expires_at) VALUES($1,$2,$3)", newHash, session.ID, nextExpiry); err != nil {
		return Session{}, err
	}
	if err = auditTx(ctx, tx, "refresh_rotated", session.UserID, session.ID, actor); err != nil {
		return Session{}, err
	}
	return session, tx.Commit(ctx)
}
func (s Store) Revoke(ctx context.Context, tokenHash, actor string) (Session, error) {
	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return Session{}, err
	}
	defer tx.Rollback(ctx)
	var session Session
	err = tx.QueryRow(ctx, `SELECT s.id,s.user_id,s.expires_at FROM sessions s JOIN refresh_tokens t ON t.session_id=s.id WHERE t.token_hash=$1 FOR UPDATE OF s`, tokenHash).Scan(&session.ID, &session.UserID, &session.Expires)
	if errors.Is(err, pgx.ErrNoRows) {
		return Session{}, nil
	}
	if err != nil {
		return Session{}, err
	}
	if _, err = tx.Exec(ctx, "UPDATE sessions SET revoked_at=COALESCE(revoked_at,now()) WHERE id=$1", session.ID); err != nil {
		return Session{}, err
	}
	if err = auditTx(ctx, tx, "logout", session.UserID, session.ID, actor); err != nil {
		return Session{}, err
	}
	return session, tx.Commit(ctx)
}
func (s Store) ActiveUser(ctx context.Context, uid, sid string) (User, error) {
	var u User
	err := s.DB.QueryRow(ctx, `SELECT u.id,u.email,u.first_name,u.email_verified FROM users u JOIN sessions s ON s.user_id=u.id WHERE u.id=$1 AND s.id=$2 AND NOT u.disabled AND s.revoked_at IS NULL AND s.expires_at>now()`, uid, sid).Scan(&u.ID, &u.Email, &u.FirstName, &u.EmailVerified)
	if errors.Is(err, pgx.ErrNoRows) {
		err = ErrDenied
	}
	return u, err
}
