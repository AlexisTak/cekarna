package auth

import (
	"os"
	"path/filepath"
	"testing"
)

func TestProductionConfiguration(t *testing.T) {
	path := filepath.Join(t.TempDir(), "key")
	if err := os.WriteFile(path, []byte(randomToken()), 0600); err != nil {
		t.Fatal(err)
	}
	values := map[string]string{
		"APP_ENV": "production", "AUTH_ADDR": "", "AUTH_ISSUER": "https://auth.example.test",
		"AUTH_AUDIENCE": "cekarna-api", "WEB_ORIGIN": "https://app.example.test",
		"AUTH_SIGNING_KEY_FILE": path, "AUDIT_HMAC_KEY": randomToken(), "AUTH_PREVIOUS_PUBLIC_KEYS": "",
		"AUTH_MAILER":  "log",
		"DATABASE_URL": "postgres://db.example.test/auth?sslmode=verify-full", "REDIS_URL": "rediss://redis.example.test:6379",
	}
	for key, value := range values {
		t.Setenv(key, value)
	}
	if c, err := LoadConfig(); err != nil || !c.Secure {
		t.Fatal("valid production config", err)
	}
	for key, value := range map[string]string{
		"AUTH_MAILER": "smtp", "SMTP_HOST": "smtp.example.test", "SMTP_PORT": "587",
		"SMTP_USERNAME": "smtp-user", "SMTP_PASSWORD": "smtp-password", "SMTP_FROM": "Cekarna <no-reply@example.test>",
	} {
		t.Setenv(key, value)
	}
	if c, err := LoadConfig(); err != nil {
		t.Fatal("valid SMTP config", err)
	} else if _, ok := c.Mailer.(SMTPMailer); !ok {
		t.Fatal("SMTP mailer not configured")
	}
	t.Setenv("AUTH_MAILER", "notifications")
	t.Setenv("NOTIFICATIONS_URL", "https://notifications.example.test")
	t.Setenv("NOTIFICATIONS_INTERNAL_TOKEN", randomToken())
	if c, err := LoadConfig(); err != nil {
		t.Fatal("valid notification configuration", err)
	} else if _, ok := c.Mailer.(NotificationMailer); !ok {
		t.Fatal("notification mailer not configured")
	}
	t.Setenv("AUTH_MAILER", "smtp")
	t.Setenv("SMTP_PORT", "0")
	if _, err := LoadConfig(); err == nil {
		t.Fatal("unsafe SMTP port accepted")
	}
	t.Setenv("SMTP_PORT", "587")
	for key, bad := range map[string]string{"WEB_ORIGIN": "http://app.example.test", "AUTH_ISSUER": "https://evil.test/path", "AUTH_AUDIENCE": "", "AUTH_MAILER": "unsupported", "DATABASE_URL": "postgres://db/auth?sslmode=disable", "REDIS_URL": "redis://cache:6379", "AUDIT_HMAC_KEY": "short", "AUTH_SIGNING_KEY_FILE": "missing", "AUTH_PREVIOUS_PUBLIC_KEYS": "invalid"} {
		t.Run(key, func(t *testing.T) {
			t.Setenv(key, bad)
			if _, err := LoadConfig(); err == nil {
				t.Fatal("unsafe production config accepted")
			}
		})
	}
	t.Setenv("APP_ENV", "development")
	t.Setenv("AUTH_ISSUER", "http://localhost:8081")
	t.Setenv("WEB_ORIGIN", "http://127.0.0.1:5173")
	t.Setenv("DATABASE_URL", "postgres://localhost/auth?sslmode=disable")
	t.Setenv("REDIS_URL", "redis://localhost:6379")
	if c, err := LoadConfig(); err != nil || c.Secure {
		t.Fatal("local config", err)
	}
}
