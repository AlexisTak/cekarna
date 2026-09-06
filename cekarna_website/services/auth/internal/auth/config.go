package auth

import (
	"crypto/ed25519"
	"encoding/base64"
	"errors"
	"net/url"
	"os"
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
	default:
		return Config{}, errors.New("AUTH_MAILER must be log (the only available transport)")
	}
	return c, nil
}
