package auth

import (
	"context"
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
