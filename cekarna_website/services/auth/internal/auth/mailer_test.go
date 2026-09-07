package auth

import (
	"context"
	"crypto/sha256"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestLogMailerAndMessages(t *testing.T) {
	if err := (LogMailer{}).Send(context.Background(), "person@example.test", "sujet", "corps"); err != nil {
		t.Fatal("log mailer must never fail", err)
	}
	subject, text := verificationMessage("https://app.test", "tok_123")
	if !strings.Contains(text, "https://app.test/verifier-email?token=tok_123") || subject == "" {
		t.Fatal("verification message must contain the confirmation link")
	}
	subject, text = resetMessage("https://app.test", "tok_456")
	if !strings.Contains(text, "https://app.test/reinitialiser?token=tok_456") || subject == "" {
		t.Fatal("reset message must contain the recovery link")
	}
}

func TestNotificationMailerQueuesWithoutLeakingCredentials(t *testing.T) {
	token := strings.Repeat("a", 32)
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if r.Header.Get("Authorization") != "Bearer "+token || r.URL.Path != "/v1/notifications/email" {
			t.Fatal("unexpected internal notification request")
		}
		expectedDigest := sha256.Sum256([]byte("auth.email\x00person@example.test\x00subject\x00body"))
		if r.Header.Get("Idempotency-Key") != fmt.Sprintf("%x", expectedDigest) {
			t.Fatal("missing or unstable idempotency key")
		}
		body, err := io.ReadAll(r.Body)
		payload := string(body)
		if err != nil || !strings.Contains(payload, `"kind":"auth.email"`) ||
			!strings.Contains(payload, `"owner_id":"owner-1"`) ||
			!strings.Contains(payload, `"expires_at":"2030-01-02T01:04:05Z"`) {
			t.Fatal("expected a notification payload")
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()
	mailer := NotificationMailer{URL: server.URL, Token: token, Client: server.Client()}
	expiresAt := time.Date(2030, 1, 2, 3, 4, 5, 0, time.FixedZone("test", 2*60*60))
	for range 2 {
		if err := mailer.SendForOwnerUntil(context.Background(), "owner-1", "person@example.test", "subject", "body", expiresAt); err != nil {
			t.Fatal(err)
		}
	}
	if calls.Load() != 2 {
		t.Fatal("repeated delivery requests were not exercised")
	}
}
