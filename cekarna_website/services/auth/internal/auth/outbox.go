package auth

import (
	"context"
	"errors"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5"
)

type OutboxEmail struct {
	ID, UserID, Recipient, Subject, TextBody string
	ExpiresAt                                time.Time
}

// IssueEmailTokenAndQueue stores the token digest and the corresponding email
// intent atomically. The raw token exists only inside the queued message body.
func (s Store) IssueEmailTokenAndQueue(ctx context.Context, uid, purpose, recipient string, ttl time.Duration, message func(string) (string, string)) error {
	token := randomToken()
	subject, text := message(token)
	expiresAt := time.Now().Add(ttl)
	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, "INSERT INTO verification_tokens(token_hash,user_id,purpose,expires_at) VALUES($1,$2,$3,$4)", digest(token), uid, purpose, expiresAt); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, "INSERT INTO email_outbox(id,user_id,recipient,subject,text_body,expires_at) VALUES($1,$2,$3,$4,$5,$6)", randomToken(), uid, recipient, subject, text, expiresAt); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s Store) ClaimOutboxEmail(ctx context.Context) (OutboxEmail, error) {
	_, err := s.DB.Exec(ctx, "DELETE FROM email_outbox WHERE expires_at <= now()")
	if err != nil {
		return OutboxEmail{}, err
	}
	var item OutboxEmail
	err = s.DB.QueryRow(ctx, `WITH next AS (
  SELECT id FROM email_outbox
  WHERE available_at <= now() AND expires_at > now()
  ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1
)
UPDATE email_outbox SET attempts=attempts+1, available_at=now()+interval '30 seconds'
WHERE id=(SELECT id FROM next)
RETURNING id,user_id,recipient,subject,text_body,expires_at`).Scan(
		&item.ID, &item.UserID, &item.Recipient, &item.Subject, &item.TextBody, &item.ExpiresAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return OutboxEmail{}, nil
	}
	return item, err
}

func (s Store) CompleteOutboxEmail(ctx context.Context, id string) error {
	_, err := s.DB.Exec(ctx, "DELETE FROM email_outbox WHERE id=$1", id)
	return err
}

func RunEmailOutbox(ctx context.Context, store Store, mailer NotificationMailer) {
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for {
		item, err := store.ClaimOutboxEmail(ctx)
		if err != nil {
			slog.Error("email outbox claim failed")
		} else if item.ID != "" {
			if err = mailer.SendForOwnerUntil(ctx, item.UserID, item.Recipient, item.Subject, item.TextBody, item.ExpiresAt); err != nil {
				slog.Warn("email outbox delivery deferred")
			} else if err = store.CompleteOutboxEmail(ctx, item.ID); err != nil {
				slog.Error("email outbox completion failed")
			}
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}
