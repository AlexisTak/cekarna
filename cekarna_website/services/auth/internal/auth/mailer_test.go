package auth

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
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
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer "+token || r.URL.Path != "/v1/notifications/email" {
			t.Fatal("unexpected internal notification request")
		}
		body, err := io.ReadAll(r.Body)
		if err != nil || !strings.Contains(string(body), `"kind":"auth.email"`) {
			t.Fatal("expected a notification payload")
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()
	if err := (NotificationMailer{URL: server.URL, Token: token, Client: server.Client()}).Send(context.Background(), "person@example.test", "subject", "body"); err != nil {
		t.Fatal(err)
	}
}
