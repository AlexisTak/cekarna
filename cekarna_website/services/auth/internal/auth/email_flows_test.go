package auth

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"
)

// captureMailer records messages so integration tests can follow dev links.
type captureMailer struct{ texts []string }

func (m *captureMailer) Send(_ context.Context, _, _, text string) error {
	m.texts = append(m.texts, text)
	return nil
}

type failingMailer struct{}

func (failingMailer) Send(context.Context, string, string, string) error {
	return errors.New("SMTP unavailable")
}

func (m *captureMailer) link(t *testing.T, marker string) string {
	t.Helper()
	for _, text := range m.texts {
		if i := strings.Index(text, marker); i >= 0 {
			start := strings.LastIndex(text[:i], "https://")
			end := strings.IndexAny(text[i:], " \n")
			if start >= 0 && end > 0 {
				return text[start : i+end]
			}
		}
	}
	t.Fatal("no email containing", marker)
	return ""
}

func TestStoreTokenLifecycle(t *testing.T) {
	s := fixture(t)
	ctx := context.Background()
	uid := randomToken()
	// digest is lowercase hex; randomToken contains capitals rejected by users_email_check.
	if _, err := s.Store.DB.Exec(ctx, "INSERT INTO users(id,email,first_name) VALUES($1,$2,'Test')", uid, digest(uid)+"@example.test"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Store.DB.Exec(ctx, "INSERT INTO credentials(user_id,password_hash) VALUES($1,$2)", uid, hashPassword("une longue phrase initiale")); err != nil {
		t.Fatal(err)
	}
	actor := s.Guard.Identity("192.0.2.1")

	raw, err := s.Store.IssueEmailToken(ctx, uid, PurposeVerifyEmail, verifyEmailTTL)
	if err != nil || len(raw) != 43 {
		t.Fatal("token issue", err)
	}
	// Wrong purpose is refused.
	if _, err = s.Store.ResetPassword(ctx, digest(raw), hashPassword("un autre mot de passe valide"), actor); !errors.Is(err, ErrDenied) {
		t.Fatal("purpose confusion accepted")
	}
	if err = s.Store.VerifyEmail(ctx, digest(raw), actor); err != nil {
		t.Fatal("verify", err)
	}
	var verified bool
	if err = s.Store.DB.QueryRow(ctx, "SELECT email_verified FROM users WHERE id=$1", uid).Scan(&verified); err != nil || !verified {
		t.Fatal("email not marked verified", err)
	}
	// Replay is refused.
	if err = s.Store.VerifyEmail(ctx, digest(raw), actor); !errors.Is(err, ErrDenied) {
		t.Fatal("consumed token replayed")
	}
	// Expired token is refused.
	stale, err := s.Store.IssueEmailToken(ctx, uid, PurposeVerifyEmail, -time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	if err = s.Store.VerifyEmail(ctx, digest(stale), actor); !errors.Is(err, ErrDenied) {
		t.Fatal("expired token accepted")
	}
}

func TestIntegrationVerificationCycle(t *testing.T) {
	s := fixture(t)
	m := &captureMailer{}
	s.Mailer = m
	b := newBrowser(t, s)

	// register sends the verification email exactly once when the account is created
	if r := b.call("POST", "/v1/auth/register", `{"email":"person@example.test","password":"une longue phrase unique","first_name":"Camille"}`); r.Code != 202 {
		t.Fatal("register", r.Code)
	}
	link := m.link(t, "/verifier-email?token=")
	if len(m.texts) != 1 {
		t.Fatal("expected one verification email", len(m.texts))
	}
	// registering the same address again sends nothing but stays 202
	if r := b.call("POST", "/v1/auth/register", `{"email":"person@example.test","password":"une longue phrase unique","first_name":"Camille"}`); r.Code != 202 {
		t.Fatal("register replay", r.Code)
	}
	if len(m.texts) != 1 {
		t.Fatal("duplicate registration must not send email")
	}
	token := link[strings.LastIndex(link, "token=")+len("token="):]
	if r := b.call("POST", "/v1/auth/verify/confirm", `{"token":"`+token+`"}`); r.Code != 204 {
		t.Fatal("confirm", r.Code)
	}
	// replay of the same link is refused, indistinguishably
	if r := b.call("POST", "/v1/auth/verify/confirm", `{"token":"`+token+`"}`); r.Code != 401 {
		t.Fatal("replay", r.Code)
	}
	if r := b.call("POST", "/v1/auth/verify/confirm", `{"token":"short"}`); r.Code != 401 {
		t.Fatal("malformed token", r.Code)
	}
	// login then /me shows the verified flag
	if r := b.call("POST", "/v1/auth/login", `{"email":"person@example.test","password":"une longue phrase unique"}`); r.Code != 200 {
		t.Fatal("login", r.Code)
	}
	r := b.call("GET", "/v1/auth/me", "")
	if r.Code != 200 {
		t.Fatal("me", r.Code)
	}
	var me User
	if err := json.Unmarshal(r.Body.Bytes(), &me); err != nil || !me.EmailVerified {
		t.Fatal("email_verified not reflected", err)
	}
	// verify/request stays neutral on an already verified account
	if r := b.call("POST", "/v1/auth/verify/request", ""); r.Code != 202 {
		t.Fatal("verify request on verified account", r.Code)
	}
	if len(m.texts) != 1 {
		t.Fatal("verified account must not receive another email")
	}
}

func TestIntegrationEmailDeliveryFailureIsAudited(t *testing.T) {
	s := fixture(t)
	s.Mailer = failingMailer{}
	b := newBrowser(t, s)
	if r := b.call("POST", "/v1/auth/register", `{"email":"person@example.test","password":"une longue phrase unique","first_name":"Camille"}`); r.Code != 202 {
		t.Fatal("registration must remain neutral when SMTP fails", r.Code)
	}
	var failures int
	if err := s.Store.DB.QueryRow(context.Background(), "SELECT count(*) FROM audit_events WHERE event='email_delivery_failed'").Scan(&failures); err != nil || failures != 1 {
		t.Fatal("SMTP failure audit", err, failures)
	}
}

func TestIntegrationResetCycle(t *testing.T) {
	s := fixture(t)
	m := &captureMailer{}
	s.Mailer = m
	b := newBrowser(t, s)
	registerAndLogin(t, b)

	// unknown address: same response, no email
	before := len(m.texts)
	if r := b.call("POST", "/v1/auth/reset/request", `{"email":"nobody@example.test"}`); r.Code != 202 {
		t.Fatal("reset request unknown", r.Code)
	}
	if len(m.texts) != before {
		t.Fatal("unknown account must not trigger an email")
	}
	// known address: email sent; the reset token must not serve as verify token
	if r := b.call("POST", "/v1/auth/reset/request", `{"email":"person@example.test"}`); r.Code != 202 {
		t.Fatal("reset request", r.Code)
	}
	link := m.link(t, "/reinitialiser?token=")
	token := link[strings.LastIndex(link, "token=")+len("token="):]
	if r := b.call("POST", "/v1/auth/verify/confirm", `{"token":"`+token+`"}`); r.Code != 401 {
		t.Fatal("reset token must not verify email", r.Code)
	}
	// weak password rejected before the token is consumed
	if r := b.call("POST", "/v1/auth/reset/confirm", `{"token":"`+token+`","new_password":"trop court"}`); r.Code != 400 {
		t.Fatal("weak password must be rejected before consuming the token", r.Code)
	}
	if r := b.call("POST", "/v1/auth/reset/confirm", `{"token":"`+token+`","new_password":"une phrase toute neuve"}`); r.Code != 204 {
		t.Fatal("reset confirm", r.Code)
	}
	// every session is revoked: refresh replay refused
	if r := b.call("POST", "/v1/auth/refresh", ""); r.Code != 401 {
		t.Fatal("session must be revoked after reset", r.Code)
	}
	// old password refused, new password accepted
	if r := b.call("POST", "/v1/auth/login", `{"email":"person@example.test","password":"a long unique passphrase"}`); r.Code != 401 {
		t.Fatal("old password accepted", r.Code)
	}
	if r := b.call("POST", "/v1/auth/login", `{"email":"person@example.test","password":"une phrase toute neuve"}`); r.Code != 200 {
		t.Fatal("new password refused", r.Code)
	}
	// token already consumed
	if r := b.call("POST", "/v1/auth/reset/confirm", `{"token":"`+token+`","new_password":"encore une autre phrase"}`); r.Code != 401 {
		t.Fatal("consumed reset token replayed", r.Code)
	}
}
