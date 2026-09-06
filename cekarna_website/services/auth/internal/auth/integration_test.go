package auth

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"cekarna/auth/migrations"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

func fixture(t *testing.T) *Server {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	redisURL := os.Getenv("TEST_REDIS_URL")
	if dsn == "" || redisURL == "" {
		t.Skip("set TEST_DATABASE_URL and TEST_REDIS_URL to run real PostgreSQL/Redis integration tests")
	}
	ctx := context.Background()
	admin, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal("test PostgreSQL configuration")
	}
	schema := "auth_test_" + digest(randomToken())[:16]
	if _, err = admin.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
		admin.Close()
		t.Fatal("test schema creation failed")
	}
	t.Cleanup(func() { _, _ = admin.Exec(ctx, "DROP SCHEMA "+schema+" CASCADE"); admin.Close() })
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatal(err)
	}
	cfg.ConnConfig.RuntimeParams["search_path"] = schema
	db, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(db.Close)
	if err = migrations.Apply(ctx, db); err != nil {
		t.Fatal(err)
	}
	if err = migrations.Apply(ctx, db); err != nil {
		t.Fatal("migration not repeatable", err)
	}
	ro, err := redis.ParseURL(redisURL)
	if err != nil {
		t.Fatal("test Redis configuration")
	}
	cache := redis.NewClient(ro)
	t.Cleanup(func() { cache.Close() })
	if cache.Ping(ctx).Err() != nil {
		t.Fatal("test Redis unavailable")
	}
	return NewServer(Config{Origin: "https://app.test", Secure: true, Signer: testSigner()}, Store{DB: db}, Guard{Redis: cache, Key: []byte(randomToken())}, LogMailer{})
}

type browser struct {
	server  *Server
	handler http.Handler
	csrf    *http.Cookie
	refresh *http.Cookie
	access  string
}

func newBrowser(t *testing.T, s *Server) *browser {
	b := &browser{server: s, handler: s.Routes()}
	r := b.call("GET", "/v1/auth/csrf", "")
	if r.Code != 200 {
		t.Fatal("csrf unavailable", r.Code)
	}
	return b
}
func (b *browser) call(method, path, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.RemoteAddr = "192.0.2.25:9000"
	req.Header.Set("Origin", b.server.Config.Origin)
	req.Header.Set("Content-Type", "application/json")
	if b.csrf != nil {
		req.AddCookie(b.csrf)
		req.Header.Set("X-CSRF-Token", b.csrf.Value)
	}
	if b.refresh != nil {
		req.AddCookie(b.refresh)
	}
	if b.access != "" {
		req.Header.Set("Authorization", "Bearer "+b.access)
	}
	rec := httptest.NewRecorder()
	b.handler.ServeHTTP(rec, req)
	for _, c := range rec.Result().Cookies() {
		if c.Name == b.server.cookieName("csrf") {
			b.csrf = c
		}
		if c.Name == b.server.cookieName("refresh") {
			b.refresh = c
		}
	}
	var response struct {
		Access string `json:"access_token"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &response)
	if response.Access != "" {
		b.access = response.Access
	}
	return rec
}
func registerAndLogin(t *testing.T, b *browser) {
	t.Helper()
	body := `{"email":"person@example.test","password":"a long unique passphrase","first_name":"Camille"}`
	if r := b.call("POST", "/v1/auth/register", body); r.Code != 202 {
		t.Fatal("register", r.Code)
	}
	if r := b.call("POST", "/v1/auth/login", body); r.Code != 200 {
		t.Fatal("login", r.Code)
	}
}
func TestIntegrationRotationReplayAndLogout(t *testing.T) {
	s := fixture(t)
	b := newBrowser(t, s)
	registerAndLogin(t, b)
	if r := b.call("GET", "/v1/auth/me", ""); r.Code != 200 {
		t.Fatal("me", r.Code)
	}
	old := b.refresh.Value
	if r := b.call("POST", "/v1/auth/refresh", "{}"); r.Code != 200 || b.refresh.Value == old {
		t.Fatal("rotation", r.Code)
	}
	active := b.refresh.Value
	var count int
	if err := s.Store.DB.QueryRow(context.Background(), "SELECT count(*) FROM refresh_tokens WHERE token_hash=$1", old).Scan(&count); err != nil || count != 0 {
		t.Fatal("raw refresh persisted", err)
	}
	b.refresh.Value = old
	if r := b.call("POST", "/v1/auth/refresh", "{}"); r.Code != 401 {
		t.Fatal("replay accepted", r.Code)
	}
	b.refresh.Value = active
	if r := b.call("POST", "/v1/auth/refresh", "{}"); r.Code != 401 {
		t.Fatal("descendant accepted", r.Code)
	}
	if r := b.call("GET", "/v1/auth/me", ""); r.Code != 401 {
		t.Fatal("revoked access accepted", r.Code)
	}
	if err := s.Store.DB.QueryRow(context.Background(), "SELECT count(*) FROM audit_events WHERE event='refresh_reuse'").Scan(&count); err != nil || count != 1 {
		t.Fatal("replay audit", err)
	}
	body := `{"email":"person@example.test","password":"a long unique passphrase"}`
	if r := b.call("POST", "/v1/auth/login", body); r.Code != 200 {
		t.Fatal("relogin", r.Code)
	}
	if r := b.call("POST", "/v1/auth/logout", "{}"); r.Code != 204 {
		t.Fatal("logout", r.Code)
	}
	if r := b.call("GET", "/v1/auth/me", ""); r.Code != 401 {
		t.Fatal("logout did not revoke", r.Code)
	}
}

func TestIntegrationCandidateWorkspaceIsPrivate(t *testing.T) {
	s := fixture(t)
	b := newBrowser(t, s)
	if r := b.call("GET", "/v1/candidate/workspace", ""); r.Code != 401 {
		t.Fatal("anonymous workspace read", r.Code)
	}
	registerAndLogin(t, b)
	if r := b.call("GET", "/v1/candidate/workspace", ""); r.Code != 200 || !strings.Contains(r.Body.String(), `"firstName":"Camille"`) {
		t.Fatal("new account must receive its private personal profile", r.Code, r.Body.String())
	}
	body := `{"workspace":{"version":1,"demo":false,"profile":{"firstName":"Camille"},"jobs":[]}}`
	if r := b.call("PUT", "/v1/candidate/workspace", body); r.Code != 200 {
		t.Fatal("workspace save", r.Code, r.Body.String())
	}
	r := b.call("GET", "/v1/candidate/workspace", "")
	if r.Code != 200 || !strings.Contains(r.Body.String(), `"firstName":"Camille"`) {
		t.Fatal("workspace read", r.Code, r.Body.String())
	}
	other := newBrowser(t, s)
	otherBody := `{"email":"other@example.test","password":"another long passphrase","first_name":"Alex"}`
	if r := other.call("POST", "/v1/auth/register", otherBody); r.Code != 202 {
		t.Fatal("other register", r.Code)
	}
	if r := other.call("POST", "/v1/auth/login", otherBody); r.Code != 200 {
		t.Fatal("other login", r.Code)
	}
	if r := other.call("GET", "/v1/candidate/workspace", ""); r.Code != 200 || !strings.Contains(r.Body.String(), `"firstName":"Alex"`) {
		t.Fatal("workspace leaked to another account", r.Code, r.Body.String())
	}
	conflict := b.call("PUT", "/v1/candidate/workspace", body)
	if conflict.Code != 409 {
		t.Fatal("stale workspace write accepted", conflict.Code, conflict.Body.String())
	}
	overwrite := `{"workspace":{"version":1,"demo":false,"profile":{"firstName":"Marie"},"jobs":[]},"revision":0,"overwrite":true}`
	if r := b.call("PUT", "/v1/candidate/workspace", overwrite); r.Code != 200 {
		t.Fatal("explicit workspace overwrite", r.Code, r.Body.String())
	}
}

func TestIntegrationLogoutAllAndDeleteAccount(t *testing.T) {
	s := fixture(t)
	first := newBrowser(t, s)
	registerAndLogin(t, first)
	second := newBrowser(t, s)
	body := `{"email":"person@example.test","password":"a long unique passphrase"}`
	if r := second.call("POST", "/v1/auth/login", body); r.Code != 200 {
		t.Fatal("second login", r.Code)
	}
	if r := first.call("POST", "/v1/auth/logout-all", "{}"); r.Code != 204 {
		t.Fatal("logout all", r.Code, r.Body.String())
	}
	if r := second.call("GET", "/v1/auth/me", ""); r.Code != 401 {
		t.Fatal("second session survived logout all", r.Code)
	}
	if r := first.call("POST", "/v1/auth/login", body); r.Code != 200 {
		t.Fatal("login before deletion", r.Code)
	}
	if r := first.call("POST", "/v1/auth/delete", `{"password":"wrong passphrase"}`); r.Code != 401 {
		t.Fatal("account deleted with wrong password", r.Code)
	}
	if r := first.call("POST", "/v1/auth/delete", `{"password":"a long unique passphrase"}`); r.Code != 204 {
		t.Fatal("account deletion", r.Code, r.Body.String())
	}
	var users, credentials, sessions, audits int
	if err := s.Store.DB.QueryRow(context.Background(), "SELECT count(*) FROM users").Scan(&users); err != nil || users != 0 {
		t.Fatal("user remained after deletion", err, users)
	}
	if err := s.Store.DB.QueryRow(context.Background(), "SELECT count(*) FROM credentials").Scan(&credentials); err != nil || credentials != 0 {
		t.Fatal("credential remained after deletion", err, credentials)
	}
	if err := s.Store.DB.QueryRow(context.Background(), "SELECT count(*) FROM sessions").Scan(&sessions); err != nil || sessions != 0 {
		t.Fatal("session remained after deletion", err, sessions)
	}
	if err := s.Store.DB.QueryRow(context.Background(), "SELECT count(*) FROM audit_events WHERE user_id IS NOT NULL").Scan(&audits); err != nil || audits != 0 {
		t.Fatal("account audit remained after deletion", err, audits)
	}
}
func TestIntegrationConcurrentRefresh(t *testing.T) {
	s := fixture(t)
	b := newBrowser(t, s)
	registerAndLogin(t, b)
	hash := digest(b.refresh.Value)
	results := make(chan error, 2)
	var wg sync.WaitGroup
	for range 2 {
		wg.Go(func() {
			_, err := s.Store.Rotate(context.Background(), hash, digest(randomToken()), "test")
			results <- err
		})
	}
	wg.Wait()
	close(results)
	succeeded, reused := 0, 0
	for err := range results {
		switch err {
		case nil:
			succeeded++
		case ErrReuse:
			reused++
		default:
			t.Fatal(err)
		}
	}
	if succeeded != 1 || reused != 1 {
		t.Fatalf("race result success=%d reuse=%d", succeeded, reused)
	}
	if r := b.call("GET", "/v1/auth/me", ""); r.Code != 401 {
		t.Fatal("PostgreSQL must reject revoked sessions without relying on cache")
	}
}
func TestIntegrationLimitsAndPrivacy(t *testing.T) {
	s := fixture(t)
	b := newBrowser(t, s)
	registerAndLogin(t, b)
	duplicate := `{"email":"person@example.test","password":"a long unique passphrase","first_name":"Camille"}`
	if r := b.call("POST", "/v1/auth/register", duplicate); r.Code != 202 {
		t.Fatal("duplicate enumeration", r.Code)
	}
	for i := range 6 {
		r := b.call("POST", "/v1/auth/login", `{"email":"absent@example.test","password":"a wrong passphrase"}`)
		want := 401
		if i == 5 {
			want = 429
		}
		if r.Code != want {
			t.Fatalf("attempt %d got %d", i, r.Code)
		}
	}
	ctx := context.Background()
	key := "atomic:" + randomToken()
	var wg sync.WaitGroup
	results := make(chan bool, 20)
	for range 20 {
		wg.Go(func() {
			ok, err := s.Guard.Allow(ctx, key, 5, time.Minute)
			if err != nil {
				t.Error("Redis limit", err)
			}
			results <- ok
		})
	}
	wg.Wait()
	close(results)
	allowed := 0
	for ok := range results {
		if ok {
			allowed++
		}
	}
	if allowed != 5 {
		t.Fatal("non atomic rate limit", allowed)
	}
	original := b.csrf.Value
	b.csrf.Value = randomToken()
	if r := b.call("POST", "/v1/auth/refresh", "{}"); r.Code != 403 {
		t.Fatal("unknown CSRF token accepted")
	}
	b.csrf.Value = original
	s.Guard.Redis.Close()
	if r := b.call("POST", "/v1/auth/login", duplicate); r.Code != 503 {
		t.Fatal("Redis outage must fail closed", r.Code)
	}
}
func TestIntegrationExpiredRefresh(t *testing.T) {
	s := fixture(t)
	b := newBrowser(t, s)
	registerAndLogin(t, b)
	_, err := s.Store.DB.Exec(context.Background(), "UPDATE refresh_tokens SET expires_at=now()-interval '1 second'")
	if err != nil {
		t.Fatal(err)
	}
	if r := b.call("POST", "/v1/auth/refresh", "{}"); r.Code != 401 {
		t.Fatal(fmt.Sprint("expired refresh accepted: ", r.Code))
	}
}
