package auth

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"mime"
	"net"
	"net/http"
	"net/mail"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/go-chi/chi/v5"
)

type Server struct {
	Config    Config
	Store     Store
	Guard     Guard
	Mailer    Mailer
	hashSlots chan struct{}
	dummyHash string
}

func NewServer(c Config, s Store, g Guard, m Mailer) *Server {
	return &Server{c, s, g, m, make(chan struct{}, 4), hashPassword(randomToken())}
}
func respond(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if v != nil {
		_ = json.NewEncoder(w).Encode(v)
	}
}
func problem(w http.ResponseWriter, status int, code string) {
	respond(w, status, map[string]string{"error": code})
}
func peer(r *http.Request) string {
	ip, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return ip
}
func (s *Server) cookieName(kind string) string {
	if s.Config.Secure {
		return "__Host-cekarna_" + kind
	}
	return "cekarna_" + kind
}
func (s *Server) cookie(w http.ResponseWriter, kind, value string, age int) {
	http.SetCookie(w, &http.Cookie{Name: s.cookieName(kind), Value: value, Path: "/", HttpOnly: true, Secure: s.Config.Secure, SameSite: http.SameSiteStrictMode, MaxAge: age})
}
func (s *Server) Routes() http.Handler {
	r := chi.NewRouter()
	r.Use(s.boundary)
	r.Get("/health/live", func(w http.ResponseWriter, r *http.Request) { respond(w, 200, map[string]string{"status": "ok"}) })
	r.Get("/health/ready", func(w http.ResponseWriter, r *http.Request) {
		if s.Store.DB.Ping(r.Context()) != nil || s.Guard.Redis.Ping(r.Context()).Err() != nil {
			problem(w, 503, "unavailable")
			return
		}
		respond(w, 200, map[string]string{"status": "ready"})
	})
	r.Get("/.well-known/jwks.json", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "public, max-age=60")
		respond(w, 200, s.Config.Signer.JWKS())
	})
	r.Route("/v1/auth", func(r chi.Router) {
		r.Use(s.limitIP)
		r.Get("/csrf", s.csrf)
		r.Get("/me", s.me)
		r.Group(func(r chi.Router) {
			r.Use(s.csrfProtection)
			r.Post("/register", s.register)
			r.Post("/login", s.login)
			r.Post("/refresh", s.refresh)
			r.Post("/logout", s.logout)
			r.Post("/logout-all", s.logoutAll)
			r.Post("/delete", s.deleteAccount)
			r.Post("/verify/request", s.verifyRequest)
			r.Post("/verify/confirm", s.verifyConfirm)
			r.Post("/reset/request", s.resetRequest)
			r.Post("/reset/confirm", s.resetConfirm)
		})
	})
	r.Route("/v1/candidate", func(r chi.Router) {
		r.Use(s.limitIP)
		r.Get("/workspace", s.candidateWorkspace)
		r.With(s.csrfProtection).Put("/workspace", s.saveCandidateWorkspace)
	})
	return r
}
func (s *Server) boundary(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("X-Request-ID", randomToken())
		defer func() {
			if recover() != nil {
				slog.Error("auth request panic")
				problem(w, 500, "internal_error")
			}
		}()
		ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
		defer cancel()
		r = r.WithContext(ctx)
		origin := r.Header.Get("Origin")
		if origin != "" && origin != s.Config.Origin {
			problem(w, 403, "origin_denied")
			return
		}
		w.Header().Add("Vary", "Origin")
		if origin == s.Config.Origin {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Access-Control-Allow-Credentials", "true")
		}
		if r.Method == http.MethodOptions {
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, X-CSRF-Token, Authorization")
			w.WriteHeader(204)
			return
		}
		bodyLimit := int64(4096)
		if r.URL.Path == "/v1/candidate/workspace" {
			bodyLimit = 5_100_000
		}
		r.Body = http.MaxBytesReader(w, r.Body, bodyLimit)
		next.ServeHTTP(w, r)
	})
}

func (s *Server) candidateWorkspace(w http.ResponseWriter, r *http.Request) {
	u, ok := s.authenticatedUser(w, r)
	if !ok {
		return
	}
	workspace, updated, revision, err := s.Store.CandidateWorkspace(r.Context(), u.ID)
	if err != nil {
		problem(w, 503, "unavailable")
		return
	}
	if workspace == nil {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	respond(w, 200, map[string]any{"workspace": workspace, "updated_at": updated, "revision": revision})
}

func (s *Server) saveCandidateWorkspace(w http.ResponseWriter, r *http.Request) {
	u, ok := s.authenticatedUser(w, r)
	if !ok {
		return
	}
	var input struct {
		Workspace json.RawMessage `json:"workspace"`
		Revision  int64           `json:"revision"`
		Overwrite bool            `json:"overwrite"`
	}
	if decode(r, &input) != nil || input.Revision < 0 || len(input.Workspace) == 0 || len(input.Workspace) > 5_000_000 || !json.Valid(input.Workspace) {
		problem(w, 400, "invalid_input")
		return
	}
	updated, revision, err := s.Store.SaveCandidateWorkspace(r.Context(), u.ID, input.Workspace, input.Revision, input.Overwrite)
	if errors.Is(err, ErrConflict) {
		problem(w, 409, "workspace_conflict")
		return
	}
	if err != nil {
		problem(w, 503, "unavailable")
		return
	}
	respond(w, 200, map[string]any{"updated_at": updated, "revision": revision})
}
func (s *Server) limit(w http.ResponseWriter, r *http.Request, bucket string, max int, window time.Duration) bool {
	ok, err := s.Guard.Allow(r.Context(), bucket, max, window)
	if err != nil {
		problem(w, 503, "unavailable")
		return false
	}
	if !ok {
		// Bound audit amplification during an attack: one event per bucket/window.
		logEvent, auditErr := s.Guard.Allow(r.Context(), "audit:"+bucket, 1, window)
		if auditErr != nil {
			problem(w, 503, "unavailable")
			return false
		}
		if logEvent {
			err = s.Store.Audit(r.Context(), "rate_limited", "", "", s.Guard.Identity(peer(r)))
		}
		if err != nil {
			problem(w, 503, "unavailable")
			return false
		}
		w.Header().Set("Retry-After", strconv.Itoa(int(window.Seconds())))
		problem(w, 429, "too_many_attempts")
		return false
	}
	return true
}
func (s *Server) limitIP(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if s.limit(w, r, "ip:"+peer(r), 60, time.Minute) {
			next.ServeHTTP(w, r)
		}
	})
}
func (s *Server) csrf(w http.ResponseWriter, r *http.Request) {
	if r.Header.Get("Origin") != s.Config.Origin {
		problem(w, 403, "origin_required")
		return
	}
	token := randomToken()
	if s.Guard.Redis.Set(r.Context(), "auth:csrf:"+digest(token), "1", 15*time.Minute).Err() != nil {
		problem(w, 503, "unavailable")
		return
	}
	s.cookie(w, "csrf", token, 900)
	respond(w, 200, map[string]string{"csrf_token": token})
}
func (s *Server) csrfProtection(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Origin") != s.Config.Origin {
			problem(w, 403, "origin_required")
			return
		}
		c, err := r.Cookie(s.cookieName("csrf"))
		header := r.Header.Get("X-CSRF-Token")
		if err != nil || len(header) != 43 || subtle.ConstantTimeCompare([]byte(c.Value), []byte(header)) != 1 {
			problem(w, 403, "csrf_invalid")
			return
		}
		n, err := s.Guard.Redis.Exists(r.Context(), "auth:csrf:"+digest(header)).Result()
		if err != nil {
			problem(w, 503, "unavailable")
			return
		}
		if n == 0 {
			problem(w, 403, "csrf_expired")
			return
		}
		next.ServeHTTP(w, r)
	})
}

type loginInput struct {
	Email     string `json:"email"`
	Password  string `json:"password"`
	FirstName string `json:"first_name,omitempty"`
}

func decode(r *http.Request, v any) error {
	kind, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || kind != "application/json" {
		return errors.New("json required")
	}
	d := json.NewDecoder(r.Body)
	d.DisallowUnknownFields()
	if err = d.Decode(v); err != nil {
		return err
	}
	if d.Decode(new(any)) != io.EOF {
		return errors.New("trailing body")
	}
	return nil
}
func normalizedEmail(value string) (string, bool) {
	v := strings.ToLower(strings.TrimSpace(value))
	a, err := mail.ParseAddress(v)
	return v, err == nil && a.Address == v && len(v) <= 254 && !strings.ContainsAny(v, "\r\n")
}
func (s *Server) acquire(w http.ResponseWriter) bool {
	select {
	case s.hashSlots <- struct{}{}:
		return true
	default:
		problem(w, 503, "busy")
		return false
	}
}
func (s *Server) register(w http.ResponseWriter, r *http.Request) {
	var in loginInput
	if decode(r, &in) != nil {
		problem(w, 400, "invalid_input")
		return
	}
	email, ok := normalizedEmail(in.Email)
	name := strings.TrimSpace(in.FirstName)
	if !ok || !validPassword(in.Password) || name == "" || !utf8.ValidString(name) || utf8.RuneCountInString(name) > 60 {
		problem(w, 400, "invalid_input")
		return
	}
	if !s.limit(w, r, "register:"+peer(r), 5, time.Hour) || !s.acquire(w) {
		return
	}
	defer func() { <-s.hashSlots }()
	uid, err := s.Store.Register(r.Context(), email, name, hashPassword(in.Password), s.Guard.Identity(peer(r)))
	if err != nil {
		problem(w, 503, "unavailable")
		return
	}
	if uid != "" {
		s.deliverVerification(r, uid, email)
	}
	respond(w, 202, map[string]string{"message": "Si l’adresse est disponible, le compte a été créé. Vous pouvez vous connecter."})
}
func (s *Server) login(w http.ResponseWriter, r *http.Request) {
	var in loginInput
	if decode(r, &in) != nil {
		problem(w, 400, "invalid_input")
		return
	}
	email, ok := normalizedEmail(in.Email)
	if !ok || len(in.Password) > 128 || in.Password == "" {
		problem(w, 400, "invalid_input")
		return
	}
	if !s.limit(w, r, "login-ip:"+peer(r), 20, 15*time.Minute) || !s.limit(w, r, "login-account:"+email, 5, 15*time.Minute) || !s.acquire(w) {
		return
	}
	defer func() { <-s.hashSlots }()
	user, hash, err := s.Store.Credential(r.Context(), email)
	if err != nil && !errors.Is(err, ErrDenied) {
		problem(w, 503, "unavailable")
		return
	}
	if hash == "" {
		hash = s.dummyHash
	}
	valid := verifyPassword(in.Password, hash)
	actor := s.Guard.Identity(peer(r))
	if !valid || err != nil {
		if s.Store.Audit(r.Context(), "login_failed", "", "", actor) != nil {
			problem(w, 503, "unavailable")
			return
		}
		problem(w, 401, "invalid_credentials")
		return
	}
	token := randomToken()
	session, err := s.Store.NewSession(r.Context(), user.ID, digest(token), actor)
	if err != nil {
		problem(w, 503, "unavailable")
		return
	}
	s.issue(w, session, token)
}
func (s *Server) issue(w http.ResponseWriter, session Session, refresh string) {
	access, err := s.Config.Signer.Issue(session.UserID, session.ID)
	if err != nil {
		problem(w, 503, "unavailable")
		return
	}
	age := int(time.Until(session.Expires).Seconds())
	if age > 7*86400 {
		age = 7 * 86400
	}
	if age < 1 {
		problem(w, 401, "invalid_session")
		return
	}
	s.cookie(w, "refresh", refresh, age)
	respond(w, 200, map[string]any{"access_token": access, "token_type": "Bearer", "expires_in": int(s.Config.Signer.TTL.Seconds())})
}
func (s *Server) refresh(w http.ResponseWriter, r *http.Request) {
	c, err := r.Cookie(s.cookieName("refresh"))
	if err != nil || len(c.Value) != 43 {
		problem(w, 401, "invalid_session")
		return
	}
	token := randomToken()
	session, err := s.Store.Rotate(r.Context(), digest(c.Value), digest(token), s.Guard.Identity(peer(r)))
	if errors.Is(err, ErrReuse) {
		s.cacheRevocation(r.Context(), session.ID)
	}
	if errors.Is(err, ErrReuse) || errors.Is(err, ErrDenied) {
		s.cookie(w, "refresh", "", -1)
		problem(w, 401, "invalid_session")
		return
	}
	if err != nil {
		problem(w, 503, "unavailable")
		return
	}
	s.issue(w, session, token)
}
func (s *Server) cacheRevocation(ctx context.Context, sid string) {
	if s.Guard.Block(ctx, sid) != nil {
		slog.Warn("revocation cache unavailable; PostgreSQL remains authoritative")
	}
}
func (s *Server) logout(w http.ResponseWriter, r *http.Request) {
	c, err := r.Cookie(s.cookieName("refresh"))
	if err == nil {
		session, err := s.Store.Revoke(r.Context(), digest(c.Value), s.Guard.Identity(peer(r)))
		if err != nil {
			problem(w, 503, "unavailable")
			return
		}
		s.cacheRevocation(r.Context(), session.ID)
	}
	s.cookie(w, "refresh", "", -1)
	respond(w, 204, nil)
}

func (s *Server) logoutAll(w http.ResponseWriter, r *http.Request) {
	u, ok := s.authenticatedUser(w, r)
	if !ok {
		return
	}
	sessionIDs, err := s.Store.RevokeAll(r.Context(), u.ID, s.Guard.Identity(peer(r)))
	if err != nil {
		problem(w, 503, "unavailable")
		return
	}
	for _, sessionID := range sessionIDs {
		s.cacheRevocation(r.Context(), sessionID)
	}
	s.cookie(w, "refresh", "", -1)
	respond(w, 204, nil)
}

func (s *Server) deleteAccount(w http.ResponseWriter, r *http.Request) {
	u, ok := s.authenticatedUser(w, r)
	if !ok {
		return
	}
	var input struct {
		Password string `json:"password"`
	}
	if decode(r, &input) != nil || len(input.Password) > 128 || input.Password == "" || !s.acquire(w) {
		if input.Password == "" || len(input.Password) > 128 {
			problem(w, 400, "invalid_input")
		}
		return
	}
	defer func() { <-s.hashSlots }()
	_, hash, err := s.Store.Credential(r.Context(), u.Email)
	if err != nil || !verifyPassword(input.Password, hash) {
		if err != nil && !errors.Is(err, ErrDenied) {
			problem(w, 503, "unavailable")
			return
		}
		problem(w, 401, "invalid_credentials")
		return
	}
	if err = s.Store.DeleteUser(r.Context(), u.ID); err != nil {
		if errors.Is(err, ErrDenied) {
			problem(w, 401, "invalid_session")
			return
		}
		problem(w, 503, "unavailable")
		return
	}
	s.cookie(w, "refresh", "", -1)
	respond(w, 204, nil)
}
func (s *Server) authenticatedUser(w http.ResponseWriter, r *http.Request) (User, bool) {
	header := r.Header.Get("Authorization")
	if !strings.HasPrefix(header, "Bearer ") {
		problem(w, 401, "invalid_token")
		return User{}, false
	}
	claims, err := s.Config.Signer.Verify(strings.TrimPrefix(header, "Bearer "))
	if err != nil {
		problem(w, 401, "invalid_token")
		return User{}, false
	}
	blocked, err := s.Guard.Blocked(r.Context(), claims.SessionID)
	if err != nil {
		problem(w, 503, "unavailable")
		return User{}, false
	}
	if blocked {
		problem(w, 401, "invalid_session")
		return User{}, false
	}
	u, err := s.Store.ActiveUser(r.Context(), claims.Subject, claims.SessionID)
	if errors.Is(err, ErrDenied) {
		problem(w, 401, "invalid_session")
		return User{}, false
	}
	if err != nil {
		problem(w, 503, "unavailable")
		return User{}, false
	}
	return u, true
}

func (s *Server) me(w http.ResponseWriter, r *http.Request) {
	if u, ok := s.authenticatedUser(w, r); ok {
		respond(w, 200, u)
	}
}
