package auth

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
)

const (
	PurposeVerifyEmail   = "verify_email"
	PurposePasswordReset = "password_reset"

	verifyEmailTTL   = 24 * time.Hour
	passwordResetTTL = 30 * time.Minute
)

// IssueEmailToken returns the raw one-time token; only its SHA-256 digest is stored.
func (s Store) IssueEmailToken(ctx context.Context, uid, purpose string, ttl time.Duration) (string, error) {
	token := randomToken()
	_, err := s.DB.Exec(ctx,
		"INSERT INTO verification_tokens(token_hash,user_id,purpose,expires_at) VALUES($1,$2,$3,$4)",
		digest(token), uid, purpose, time.Now().Add(ttl))
	if err != nil {
		return "", err
	}
	return token, nil
}

// consumeEmailToken atomically marks the token used. Invalid, expired, consumed
// or wrong-purpose tokens all yield ErrDenied, indistinguishable to callers.
func consumeEmailToken(ctx context.Context, tx pgx.Tx, tokenHash, purpose string) (string, error) {
	var uid string
	err := tx.QueryRow(ctx,
		`UPDATE verification_tokens SET consumed_at=now()
		 WHERE token_hash=$1 AND purpose=$2 AND consumed_at IS NULL AND expires_at>now()
		 RETURNING user_id`, tokenHash, purpose).Scan(&uid)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrDenied
	}
	return uid, err
}

func (s Store) VerifyEmail(ctx context.Context, tokenHash, actor string) error {
	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	uid, err := consumeEmailToken(ctx, tx, tokenHash, PurposeVerifyEmail)
	if err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, "UPDATE users SET email_verified=true WHERE id=$1", uid); err != nil {
		return err
	}
	if err = auditTx(ctx, tx, "email_verified", uid, "", actor); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// ResetPassword consumes the token, replaces the credential and revokes every
// session of the user. Returned session ids let the handler block the cache.
func (s Store) ResetPassword(ctx context.Context, tokenHash, passwordHash, actor string) ([]string, error) {
	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	uid, err := consumeEmailToken(ctx, tx, tokenHash, PurposePasswordReset)
	if err != nil {
		return nil, err
	}
	if _, err = tx.Exec(ctx, "UPDATE credentials SET password_hash=$1,updated_at=now() WHERE user_id=$2", passwordHash, uid); err != nil {
		return nil, err
	}
	if _, err = tx.Exec(ctx, "DELETE FROM passkeys WHERE user_id=$1", uid); err != nil {
		return nil, err
	}
	rows, err := tx.Query(ctx,
		"UPDATE sessions SET revoked_at=COALESCE(revoked_at,now()) WHERE user_id=$1 AND revoked_at IS NULL RETURNING id", uid)
	if err != nil {
		return nil, err
	}
	var revoked []string
	for rows.Next() {
		var id string
		if err = rows.Scan(&id); err != nil {
			rows.Close()
			return nil, err
		}
		revoked = append(revoked, id)
	}
	rows.Close()
	if rows.Err() != nil {
		return nil, rows.Err()
	}
	if err = auditTx(ctx, tx, "password_reset_done", uid, "", actor); err != nil {
		return nil, err
	}
	if err = tx.Commit(ctx); err != nil {
		return nil, err
	}
	return revoked, nil
}
