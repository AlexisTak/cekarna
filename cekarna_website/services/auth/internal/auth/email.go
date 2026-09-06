package auth

import (
	"errors"
	"log/slog"
	"net/http"
	"time"
)

type tokenInput struct {
	Token string `json:"token"`
}
type resetInput struct {
	Token    string `json:"token"`
	Password string `json:"new_password"`
}

// deliverVerification issues a verify_email token and hands the message to the
// mailer. Delivery failure never fails the request: the link remains visible in
// the dev journal and a later verify/request issues a fresh token.
func (s *Server) deliverVerification(r *http.Request, uid, email string) {
	token, err := s.Store.IssueEmailToken(r.Context(), uid, PurposeVerifyEmail, verifyEmailTTL)
	if err != nil {
		slog.Error("verification token issue failed")
		return
	}
	subject, text := verificationMessage(s.Config.Origin, token)
	if err := s.Mailer.Send(r.Context(), email, subject, text); err != nil {
		slog.Error("verification email delivery failed")
		return
	}
	if err := s.Store.Audit(r.Context(), "email_verification_sent", uid, "", s.Guard.Identity(peer(r))); err != nil {
		slog.Error("verification audit failed")
	}
}

func (s *Server) verifyRequest(w http.ResponseWriter, r *http.Request) {
	u, ok := s.authenticatedUser(w, r)
	if !ok {
		return
	}
	if !s.limit(w, r, "verify:"+u.ID, 3, time.Hour) {
		return
	}
	if !u.EmailVerified {
		s.deliverVerification(r, u.ID, u.Email)
	}
	respond(w, 202, map[string]string{"message": "Si nécessaire, un email de confirmation a été envoyé."})
}

func (s *Server) verifyConfirm(w http.ResponseWriter, r *http.Request) {
	var in tokenInput
	if decode(r, &in) != nil || len(in.Token) != 43 {
		problem(w, 401, "invalid_token")
		return
	}
	err := s.Store.VerifyEmail(r.Context(), digest(in.Token), s.Guard.Identity(peer(r)))
	if errors.Is(err, ErrDenied) {
		problem(w, 401, "invalid_token")
		return
	}
	if err != nil {
		problem(w, 503, "unavailable")
		return
	}
	respond(w, 204, nil)
}

func (s *Server) resetRequest(w http.ResponseWriter, r *http.Request) {
	var in loginInput
	if decode(r, &in) != nil {
		problem(w, 400, "invalid_input")
		return
	}
	email, ok := normalizedEmail(in.Email)
	if !ok {
		problem(w, 400, "invalid_input")
		return
	}
	if !s.limit(w, r, "reset:"+email, 3, time.Hour) || !s.limit(w, r, "reset-ip:"+peer(r), 10, time.Hour) {
		return
	}
	user, _, err := s.Store.Credential(r.Context(), email)
	if err != nil && !errors.Is(err, ErrDenied) {
		problem(w, 503, "unavailable")
		return
	}
	if err == nil {
		actor := s.Guard.Identity(peer(r))
		token, terr := s.Store.IssueEmailToken(r.Context(), user.ID, PurposePasswordReset, passwordResetTTL)
		if terr != nil {
			problem(w, 503, "unavailable")
			return
		}
		subject, text := resetMessage(s.Config.Origin, token)
		if serr := s.Mailer.Send(r.Context(), user.Email, subject, text); serr != nil {
			slog.Error("reset email delivery failed")
		}
		if aerr := s.Store.Audit(r.Context(), "password_reset_requested", user.ID, "", actor); aerr != nil {
			slog.Error("reset audit failed")
		}
	}
	respond(w, 202, map[string]string{"message": "Si un compte existe pour cette adresse, un email de récupération a été envoyé."})
}

func (s *Server) resetConfirm(w http.ResponseWriter, r *http.Request) {
	var in resetInput
	if decode(r, &in) != nil || len(in.Token) != 43 {
		problem(w, 401, "invalid_token")
		return
	}
	if !validPassword(in.Password) {
		problem(w, 400, "invalid_input")
		return
	}
	if !s.acquire(w) {
		return
	}
	defer func() { <-s.hashSlots }()
	// Pay the hashing cost before the token check: the timing of a 401 must not
	// reveal whether the token existed.
	hash := hashPassword(in.Password)
	actor := s.Guard.Identity(peer(r))
	revoked, err := s.Store.ResetPassword(r.Context(), digest(in.Token), hash, actor)
	if errors.Is(err, ErrDenied) {
		if aerr := s.Store.Audit(r.Context(), "password_reset_rejected", "", "", actor); aerr != nil {
			problem(w, 503, "unavailable")
			return
		}
		problem(w, 401, "invalid_token")
		return
	}
	if err != nil {
		problem(w, 503, "unavailable")
		return
	}
	for _, sid := range revoked {
		s.cacheRevocation(r.Context(), sid)
	}
	respond(w, 204, nil)
}
