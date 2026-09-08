package auth

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/go-webauthn/webauthn/webauthn"
	"github.com/jackc/pgx/v5"
)

type Passkey struct {
	ID         string              `json:"id"`
	Name       string              `json:"name"`
	CreatedAt  time.Time           `json:"created_at"`
	LastUsedAt *time.Time          `json:"last_used_at"`
	Credential webauthn.Credential `json:"-"`
}

type webAuthnUser struct {
	User
	Credentials []webauthn.Credential
}

func (u webAuthnUser) WebAuthnID() []byte                         { return []byte(u.ID) }
func (u webAuthnUser) WebAuthnName() string                       { return u.ID }
func (u webAuthnUser) WebAuthnDisplayName() string                { return u.FirstName }
func (u webAuthnUser) WebAuthnCredentials() []webauthn.Credential { return u.Credentials }

func (s Store) PasskeyUser(ctx context.Context, uid string) (webAuthnUser, error) {
	var user webAuthnUser
	err := s.DB.QueryRow(ctx, "SELECT id,email,first_name,email_verified FROM users WHERE id=$1 AND NOT disabled", uid).Scan(&user.ID, &user.Email, &user.FirstName, &user.EmailVerified)
	if errors.Is(err, pgx.ErrNoRows) {
		return user, ErrDenied
	}
	if err != nil {
		return user, err
	}
	rows, err := s.DB.Query(ctx, "SELECT credential FROM passkeys WHERE user_id=$1 ORDER BY created_at,id", uid)
	if err != nil {
		return user, err
	}
	defer rows.Close()
	for rows.Next() {
		var raw []byte
		if err = rows.Scan(&raw); err != nil {
			return user, err
		}
		var credential webauthn.Credential
		if err = json.Unmarshal(raw, &credential); err != nil {
			return user, err
		}
		user.Credentials = append(user.Credentials, credential)
	}
	return user, rows.Err()
}

func (s Store) PasskeyCount(ctx context.Context, uid string) (int, error) {
	var count int
	err := s.DB.QueryRow(ctx, "SELECT count(*) FROM passkeys WHERE user_id=$1", uid).Scan(&count)
	return count, err
}

func (s Store) ListPasskeys(ctx context.Context, uid string) ([]Passkey, error) {
	rows, err := s.DB.Query(ctx, "SELECT id,name,created_at,last_used_at FROM passkeys WHERE user_id=$1 ORDER BY created_at,id", uid)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []Passkey{}
	for rows.Next() {
		var item Passkey
		if err = rows.Scan(&item.ID, &item.Name, &item.CreatedAt, &item.LastUsedAt); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s Store) AddPasskey(ctx context.Context, uid, name, actor string, credential *webauthn.Credential) error {
	raw, err := json.Marshal(credential)
	if err != nil {
		return err
	}
	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	_, err = tx.Exec(ctx, `INSERT INTO passkeys(id,user_id,credential_id,public_key,sign_count,credential,name)
VALUES($1,$2,$3,$4,$5,$6,$7)`, randomToken(), uid, credential.ID, credential.PublicKey, credential.Authenticator.SignCount, raw, name)
	if err != nil {
		return err
	}
	if err = auditTx(ctx, tx, "passkey_registered", uid, "", actor); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s Store) UsePasskey(ctx context.Context, uid, actor string, credential *webauthn.Credential) error {
	raw, err := json.Marshal(credential)
	if err != nil {
		return err
	}
	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	command, err := tx.Exec(ctx, "UPDATE passkeys SET credential=$1,public_key=$2,sign_count=$3,last_used_at=now() WHERE user_id=$4 AND credential_id=$5", raw, credential.PublicKey, credential.Authenticator.SignCount, uid, credential.ID)
	if err != nil {
		return err
	}
	if command.RowsAffected() != 1 {
		return ErrDenied
	}
	event := "mfa_login_succeeded"
	if credential.Authenticator.CloneWarning {
		event = "passkey_clone_suspected"
	}
	if err = auditTx(ctx, tx, event, uid, "", actor); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s Store) DeletePasskey(ctx context.Context, uid, id, actor string) error {
	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	command, err := tx.Exec(ctx, "DELETE FROM passkeys WHERE id=$1 AND user_id=$2", id, uid)
	if err != nil {
		return err
	}
	if command.RowsAffected() != 1 {
		return ErrDenied
	}
	if err = auditTx(ctx, tx, "passkey_deleted", uid, "", actor); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
