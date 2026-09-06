package auth

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

func testSigner() Signer {
	_, key, _ := ed25519.GenerateKey(rand.Reader)
	return Signer{Key: key, Issuer: "https://auth.example.test", Audience: "cekarna-api", TTL: 5 * time.Minute}
}
func TestPassword(t *testing.T) {
	password := "une longue phrase secrète"
	first, second := hashPassword(password), hashPassword(password)
	if first == second {
		t.Fatal("salts must differ")
	}
	if !verifyPassword(password, first) || verifyPassword("incorrect", first) {
		t.Fatal("password verification")
	}
	for _, bad := range []string{"", strings.Replace(first, "65536", "9999999999", 1), "$argon2id$v=19$m=65536,t=3,p=1$AA$AA"} {
		if verifyPassword(password, bad) {
			t.Fatal("malformed hash accepted")
		}
	}
	if validPassword("short") || validPassword(strings.Repeat("x", 129)) || !validPassword(password) {
		t.Fatal("password bounds")
	}
}
func TestAccessToken(t *testing.T) {
	signer := testSigner()
	raw, err := signer.Issue("user", "session")
	if err != nil {
		t.Fatal(err)
	}
	claims, err := signer.Verify(raw)
	if err != nil || claims.SessionID != "session" {
		t.Fatal("valid token rejected", err)
	}
	for name, mutate := range map[string]func(*jwt.Token){
		"wrong audience": func(t *jwt.Token) { t.Claims.(*AccessClaims).Audience = jwt.ClaimStrings{"other"} },
		"wrong issuer":   func(t *jwt.Token) { t.Claims.(*AccessClaims).Issuer = "https://evil.test" },
		"expired": func(t *jwt.Token) {
			t.Claims.(*AccessClaims).ExpiresAt = jwt.NewNumericDate(time.Now().Add(-time.Minute))
		},
		"missing expiry":  func(t *jwt.Token) { t.Claims.(*AccessClaims).ExpiresAt = nil },
		"missing session": func(t *jwt.Token) { t.Claims.(*AccessClaims).SessionID = "" },
		"long lifetime":   func(t *jwt.Token) { t.Claims.(*AccessClaims).ExpiresAt = jwt.NewNumericDate(time.Now().Add(time.Hour)) },
		"wrong type":      func(t *jwt.Token) { t.Header["typ"] = "JWT" },
		"unknown key":     func(t *jwt.Token) { t.Header["kid"] = "unknown" },
	} {
		t.Run(name, func(t *testing.T) {
			c := *claims
			c.RegisteredClaims = claims.RegisteredClaims
			token := jwt.NewWithClaims(jwt.SigningMethodEdDSA, &c)
			token.Header["kid"] = keyID(signer.Key.Public().(ed25519.PublicKey))
			token.Header["typ"] = "at+jwt"
			mutate(token)
			v, e := token.SignedString(signer.Key)
			if e != nil {
				t.Fatal(e)
			}
			if _, e = signer.Verify(v); e == nil {
				t.Fatal("accepted invalid JWT")
			}
		})
	}
	bad := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	bad.Header["kid"] = keyID(signer.Key.Public().(ed25519.PublicKey))
	bad.Header["typ"] = "at+jwt"
	v, _ := bad.SignedString([]byte("not-an-ed25519-key"))
	if _, err = signer.Verify(v); err == nil {
		t.Fatal("algorithm confusion")
	}
	jwks, _ := json.Marshal(signer.JWKS())
	if strings.Contains(string(jwks), `"d":`) {
		t.Fatal("private key in JWKS")
	}
	replacement := testSigner()
	replacement.Previous = []ed25519.PublicKey{signer.Key.Public().(ed25519.PublicKey)}
	if _, err = replacement.Verify(raw); err != nil {
		t.Fatal("key overlap failed", err)
	}
}
func TestHTTPRejectsBeforeDependencies(t *testing.T) {
	s := &Server{Config: Config{Origin: "https://app.test", Secure: true}}
	handler := s.boundary(s.csrfProtection(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { t.Fatal("untrusted request reached handler") })))
	for _, origin := range []string{"", "https://evil.test", "https://app.test"} {
		req := httptest.NewRequest("POST", "/v1/auth/login", nil)
		req.Header.Set("Origin", origin)
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if rec.Code != 403 {
			t.Fatalf("origin %s: %d", origin, rec.Code)
		}
	}
	rec := httptest.NewRecorder()
	s.cookie(rec, "refresh", randomToken(), 60)
	cookie := rec.Result().Cookies()[0]
	if !cookie.HttpOnly || !cookie.Secure || cookie.Domain != "" || cookie.Path != "/" || cookie.SameSite != http.SameSiteStrictMode || !strings.HasPrefix(cookie.Name, "__Host-") {
		t.Fatal("unsafe cookie")
	}
}
func TestInputBoundaries(t *testing.T) {
	for _, body := range []string{`{"email":"x","password":"y","unexpected":true}`, `{"email":"x"} {}`, `{"email":5}`} {
		r := httptest.NewRequest("POST", "/", strings.NewReader(body))
		r.Header.Set("Content-Type", "application/json")
		if decode(r, new(loginInput)) == nil {
			t.Fatal("invalid JSON accepted")
		}
	}
	for _, email := range []string{"Name <a@b.test>", "bad", "a@b.test\nInjected"} {
		if _, ok := normalizedEmail(email); ok {
			t.Fatal("invalid email", email)
		}
	}
	if got, ok := normalizedEmail(" A@B.test "); !ok || got != "a@b.test" {
		t.Fatal("normalization")
	}
	r := httptest.NewRequest("GET", "/", nil)
	r.RemoteAddr = "192.0.2.1:1234"
	r.Header.Set("X-Forwarded-For", "1.2.3.4")
	if peer(r) != "192.0.2.1" {
		t.Fatal("spoofed proxy headers trusted")
	}
}
