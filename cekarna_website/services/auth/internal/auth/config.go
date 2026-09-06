package auth

import (
	"crypto/ed25519"
	"encoding/base64"
	"errors"
	"net/http"
	"net/mail"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	Address, DatabaseURL, RedisURL, Origin string
	Secure                                 bool
	AuditKey                               []byte
	Signer                                 Signer
	Mailer                                 Mailer
}

func LoadConfig() (Config, error) {
	c := Config{Address: os.Getenv("AUTH_ADDR"), DatabaseURL: os.Getenv("DATABASE_URL"), RedisURL: os.Getenv("REDIS_URL"), Origin: os.Getenv("WEB_ORIGIN"), Secure: os.Getenv("APP_ENV") != "development"}
	if c.Address == "" {
		c.Address = "127.0.0.1:8081"
	}
	issuer, audience := os.Getenv("AUTH_ISSUER"), os.Getenv("AUTH_AUDIENCE")
	for _, raw := range []string{c.Origin, issuer} {
		u, err := url.Parse(raw)
		if err != nil || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Path != "" && u.Path != "/") || (u.Scheme != "https" && (c.Secure || u.Scheme != "http")) {
			return Config{}, errors.New("WEB_ORIGIN and AUTH_ISSUER must be valid canonical origins (HTTPS in production)")
		}
	}
	if strings.HasSuffix(c.Origin, "/") || strings.HasSuffix(issuer, "/") {
		return Config{}, errors.New("origins must not end with a slash")
	}
	if audience == "" || c.DatabaseURL == "" || c.RedisURL == "" {
		return Config{}, errors.New("missing audience or database configuration")
	}
	if c.Secure {
		pg, e1 := url.Parse(c.DatabaseURL)
		rd, e2 := url.Parse(c.RedisURL)
		if e1 != nil || e2 != nil || pg.Query().Get("sslmode") != "verify-full" || rd.Scheme != "rediss" {
			return Config{}, errors.New("production requires PostgreSQL verify-full and rediss TLS")
		}
	}
	raw, err := os.ReadFile(os.Getenv("AUTH_SIGNING_KEY_FILE"))
	if err != nil {
		return Config{}, errors.New("cannot read signing key file")
	}
	seed, err := base64.RawURLEncoding.DecodeString(strings.TrimSpace(string(raw)))
	if err != nil || len(seed) != ed25519.SeedSize {
		return Config{}, errors.New("signing file must contain a base64url Ed25519 seed")
	}
	c.AuditKey, err = base64.RawURLEncoding.DecodeString(os.Getenv("AUDIT_HMAC_KEY"))
	if err != nil || len(c.AuditKey) < 32 {
		return Config{}, errors.New("AUDIT_HMAC_KEY must contain at least 32 random bytes in base64url")
	}
	c.Signer = Signer{Key: ed25519.NewKeyFromSeed(seed), Issuer: issuer, Audience: audience, TTL: 5 * time.Minute}
	for _, encoded := range strings.Fields(os.Getenv("AUTH_PREVIOUS_PUBLIC_KEYS")) {
		key, err := base64.RawURLEncoding.DecodeString(encoded)
		if err != nil || len(key) != ed25519.PublicKeySize {
			return Config{}, errors.New("invalid previous public key")
		}
		c.Signer.Previous = append(c.Signer.Previous, ed25519.PublicKey(key))
	}
	switch os.Getenv("AUTH_MAILER") {
	case "", "log":
		c.Mailer = LogMailer{}
	case "smtp":
		mailer, smtpErr := loadSMTPMailer()
		if smtpErr != nil {
			return Config{}, smtpErr
		}
		c.Mailer = mailer
	case "notifications":
		mailer, notificationErr := loadNotificationMailer(c.Secure)
		if notificationErr != nil {
			return Config{}, notificationErr
		}
		c.Mailer = mailer
	default:
		return Config{}, errors.New("AUTH_MAILER must be log, smtp or notifications")
	}
	return c, nil
}

func loadNotificationMailer(secure bool) (NotificationMailer, error) {
	rawURL, token := strings.TrimRight(os.Getenv("NOTIFICATIONS_URL"), "/"), os.Getenv("NOTIFICATIONS_INTERNAL_TOKEN")
	if rawURL == "" || len(token) < 32 {
		return NotificationMailer{}, errors.New("NOTIFICATIONS_URL and a 32-character NOTIFICATIONS_INTERNAL_TOKEN are required for AUTH_MAILER=notifications")
	}
	u, err := url.Parse(rawURL)
	if err != nil || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (secure && u.Scheme != "https") || (!secure && u.Scheme != "http" && u.Scheme != "https") {
		return NotificationMailer{}, errors.New("NOTIFICATIONS_URL must be a canonical internal HTTP(S) origin (HTTPS in production)")
	}
	return NotificationMailer{URL: rawURL, Token: token, Client: &http.Client{Timeout: 5 * time.Second}}, nil
}

func loadSMTPMailer() (SMTPMailer, error) {
	host := strings.TrimSpace(os.Getenv("SMTP_HOST"))
	from := strings.TrimSpace(os.Getenv("SMTP_FROM"))
	username, password := os.Getenv("SMTP_USERNAME"), os.Getenv("SMTP_PASSWORD")
	port := os.Getenv("SMTP_PORT")
	if host == "" || from == "" || username == "" || password == "" || port == "" {
		return SMTPMailer{}, errors.New("SMTP_HOST, SMTP_PORT, SMTP_USERNAME, SMTP_PASSWORD and SMTP_FROM are required for AUTH_MAILER=smtp")
	}
	if strings.ContainsAny(host, " \t\r\n") {
		return SMTPMailer{}, errors.New("SMTP_HOST must be a hostname")
	}
	if _, err := mail.ParseAddress(from); err != nil {
		return SMTPMailer{}, errors.New("SMTP_FROM must be a valid mailbox")
	}
	value, err := strconv.Atoi(port)
	if err != nil || value < 1 || value > 65535 {
		return SMTPMailer{}, errors.New("SMTP_PORT must be an integer between 1 and 65535")
	}
	timeout := 10 * time.Second
	if raw := os.Getenv("SMTP_TIMEOUT_SECONDS"); raw != "" {
		seconds, timeoutErr := strconv.Atoi(raw)
		if timeoutErr != nil || seconds < 1 || seconds > 60 {
			return SMTPMailer{}, errors.New("SMTP_TIMEOUT_SECONDS must be an integer between 1 and 60")
		}
		timeout = time.Duration(seconds) * time.Second
	}
	return SMTPMailer{Host: host, Port: port, Username: username, Password: password, From: from, Timeout: timeout}, nil
}
