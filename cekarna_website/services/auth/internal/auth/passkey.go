package auth

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/go-chi/chi/v5"
	"github.com/go-webauthn/webauthn/protocol"
	"github.com/go-webauthn/webauthn/webauthn"
	"github.com/redis/go-redis/v9"
)

const mfaTTL = 5 * time.Minute

type ceremony struct {
	UserID  string               `json:"user_id"`
	Session webauthn.SessionData `json:"session"`
}

func newWebAuthn(config Config) *webauthn.WebAuthn {
	rpID := config.RPID
	if rpID == "" {
		parsed, _ := url.Parse(config.Origin)
		rpID = parsed.Hostname()
	}
	timeout := webauthn.TimeoutConfig{Enforce: true, Timeout: mfaTTL, TimeoutUVD: mfaTTL}
	instance, err := webauthn.New(&webauthn.Config{
		RPID: rpID, RPDisplayName: "Cekarna", RPOrigins: []string{config.Origin},
		AttestationPreference: protocol.PreferNoAttestation,
		AuthenticatorSelection: protocol.AuthenticatorSelection{
			ResidentKey:      protocol.ResidentKeyRequirementPreferred,
			UserVerification: protocol.VerificationPreferred,
		},
		Timeouts: webauthn.TimeoutsConfig{Login: timeout, Registration: timeout},
	})
	if err != nil {
		panic("invalid WebAuthn configuration")
	}
	return instance
}

func (s *Server) putCeremony(r *http.Request, kind, id string, value ceremony) error {
	raw, err := json.Marshal(value)
	if err != nil {
		return err
	}
	return s.Guard.Redis.Set(r.Context(), "auth:mfa:challenge:"+kind+":"+digest(id), raw, mfaTTL).Err()
}

func (s *Server) takeCeremony(r *http.Request, kind, id string) (ceremony, error) {
	var value ceremony
	raw, err := s.Guard.Redis.GetDel(r.Context(), "auth:mfa:challenge:"+kind+":"+digest(id)).Bytes()
	if err != nil {
		return value, err
	}
	err = json.Unmarshal(raw, &value)
	return value, err
}

func (s *Server) listPasskeys(w http.ResponseWriter, r *http.Request) {
	u, ok := s.authenticatedUser(w, r)
	if !ok {
		return
	}
	items, err := s.Store.ListPasskeys(r.Context(), u.ID)
	if err != nil {
		problem(w, 503, "unavailable")
		return
	}
	respond(w, 200, map[string]any{"passkeys": items})
}

func (s *Server) mfaRegisterBegin(w http.ResponseWriter, r *http.Request) {
	u, ok := s.authenticatedUser(w, r)
	if !ok {
		return
	}
	var input struct {
		Password string `json:"password"`
	}
	if decode(r, &input) != nil || input.Password == "" || len(input.Password) > 128 {
		problem(w, 400, "invalid_input")
		return
	}
	if !s.limit(w, r, "mfa-register:"+u.ID, 5, time.Hour) || !s.acquire(w) {
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
	user, err := s.Store.PasskeyUser(r.Context(), u.ID)
	if err != nil {
		problem(w, 503, "unavailable")
		return
	}
	options, session, err := s.WebAuthn.BeginRegistration(user)
	if err != nil {
		problem(w, 503, "unavailable")
		return
	}
	id := randomToken()
	if s.putCeremony(r, "register", id, ceremony{UserID: u.ID, Session: *session}) != nil {
		problem(w, 503, "unavailable")
		return
	}
	respond(w, 200, map[string]any{"challenge_id": id, "options": options})
}

func (s *Server) mfaRegisterFinish(w http.ResponseWriter, r *http.Request) {
	u, ok := s.authenticatedUser(w, r)
	if !ok {
		return
	}
	var input struct {
		ChallengeID string          `json:"challenge_id"`
		Name        string          `json:"name"`
		Credential  json.RawMessage `json:"credential"`
	}
	if decode(r, &input) != nil || len(input.ChallengeID) != 43 || len(input.Credential) == 0 {
		problem(w, 400, "invalid_input")
		return
	}
	name := strings.TrimSpace(input.Name)
	if name == "" || !utf8.ValidString(name) || utf8.RuneCountInString(name) > 80 {
		problem(w, 400, "invalid_input")
		return
	}
	state, err := s.takeCeremony(r, "register", input.ChallengeID)
	if err != nil || state.UserID != u.ID {
		problem(w, 401, "invalid_token")
		return
	}
	parsed, err := protocol.ParseCredentialCreationResponseBody(bytes.NewReader(input.Credential))
	if err != nil {
		problem(w, 400, "passkey_rejected")
		return
	}
	user, err := s.Store.PasskeyUser(r.Context(), u.ID)
	if err != nil {
		problem(w, 503, "unavailable")
		return
	}
	credential, err := s.WebAuthn.CreateCredential(user, state.Session, parsed)
	if err != nil {
		problem(w, 400, "passkey_rejected")
		return
	}
	if err = s.Store.AddPasskey(r.Context(), u.ID, name, s.Guard.Identity(peer(r)), credential); err != nil {
		problem(w, 503, "unavailable")
		return
	}
	respond(w, 201, nil)
}

type mfaTokenInput struct {
	MFAToken string `json:"mfa_token"`
}

func (s *Server) pendingUser(r *http.Request, token string, consume bool) (string, error) {
	if len(token) != 43 {
		return "", redis.Nil
	}
	key := "auth:mfa:pending:" + digest(token)
	if consume {
		return s.Guard.Redis.GetDel(r.Context(), key).Result()
	}
	return s.Guard.Redis.Get(r.Context(), key).Result()
}

func (s *Server) mfaLoginBegin(w http.ResponseWriter, r *http.Request) {
	var input mfaTokenInput
	if decode(r, &input) != nil {
		problem(w, 400, "invalid_input")
		return
	}
	if !s.limit(w, r, "mfa-login:"+digest(input.MFAToken), 10, mfaTTL) {
		return
	}
	uid, err := s.pendingUser(r, input.MFAToken, false)
	if err != nil {
		problem(w, 401, "invalid_token")
		return
	}
	user, err := s.Store.PasskeyUser(r.Context(), uid)
	if err != nil || len(user.Credentials) == 0 {
		problem(w, 401, "invalid_token")
		return
	}
	options, session, err := s.WebAuthn.BeginLogin(user)
	if err != nil {
		problem(w, 503, "unavailable")
		return
	}
	id := randomToken()
	if s.putCeremony(r, "login", id, ceremony{UserID: uid, Session: *session}) != nil {
		problem(w, 503, "unavailable")
		return
	}
	_ = s.Store.Audit(r.Context(), "mfa_challenge_issued", uid, "", s.Guard.Identity(peer(r)))
	respond(w, 200, map[string]any{"challenge_id": id, "options": options})
}

func (s *Server) mfaLoginFinish(w http.ResponseWriter, r *http.Request) {
	var input struct {
		MFAToken    string          `json:"mfa_token"`
		ChallengeID string          `json:"challenge_id"`
		Credential  json.RawMessage `json:"credential"`
	}
	if decode(r, &input) != nil || len(input.Credential) == 0 {
		problem(w, 400, "invalid_input")
		return
	}
	if !s.limit(w, r, "mfa-login:"+digest(input.MFAToken), 10, mfaTTL) {
		return
	}
	state, err := s.takeCeremony(r, "login", input.ChallengeID)
	if err != nil {
		problem(w, 401, "invalid_token")
		return
	}
	uid, err := s.pendingUser(r, input.MFAToken, true)
	if err != nil || uid != state.UserID {
		problem(w, 401, "invalid_token")
		return
	}
	parsed, err := protocol.ParseCredentialRequestResponseBody(bytes.NewReader(input.Credential))
	if err != nil {
		s.mfaFailed(r, uid)
		problem(w, 400, "passkey_rejected")
		return
	}
	user, err := s.Store.PasskeyUser(r.Context(), uid)
	if err != nil {
		problem(w, 401, "invalid_token")
		return
	}
	credential, err := s.WebAuthn.ValidateLogin(user, state.Session, parsed)
	if err != nil {
		s.mfaFailed(r, uid)
		problem(w, 400, "passkey_rejected")
		return
	}
	actor := s.Guard.Identity(peer(r))
	if s.Store.UsePasskey(r.Context(), uid, actor, credential) != nil {
		problem(w, 503, "unavailable")
		return
	}
	refresh := randomToken()
	session, err := s.Store.NewSession(r.Context(), uid, digest(refresh), actor)
	if err != nil {
		problem(w, 503, "unavailable")
		return
	}
	s.issue(w, session, refresh)
}

func (s *Server) mfaFailed(r *http.Request, uid string) {
	_ = s.Store.Audit(r.Context(), "mfa_login_failed", uid, "", s.Guard.Identity(peer(r)))
}

func (s *Server) deletePasskey(w http.ResponseWriter, r *http.Request) {
	u, ok := s.authenticatedUser(w, r)
	if !ok {
		return
	}
	id := chi.URLParam(r, "id")
	if len(id) != 43 {
		problem(w, 404, "not_found")
		return
	}
	if err := s.Store.DeletePasskey(r.Context(), u.ID, id, s.Guard.Identity(peer(r))); err != nil {
		if errors.Is(err, ErrDenied) {
			problem(w, 404, "not_found")
			return
		}
		problem(w, 503, "unavailable")
		return
	}
	respond(w, 204, nil)
}
