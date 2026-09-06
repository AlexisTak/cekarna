package auth

import (
	"context"
	"log/slog"
	"net/url"
)

// Mailer abstracts email delivery. Only the log transport exists for now;
// an SMTP implementation plugs in without touching the handlers.
type Mailer interface {
	Send(ctx context.Context, to, subject, text string) error
}

// LogMailer is the development transport: the message is journaled so the
// action link can be followed manually. It never fails and never blocks a flow.
type LogMailer struct{}

func (LogMailer) Send(_ context.Context, to, subject, text string) error {
	slog.Info("dev email", "to", to, "subject", subject, "text", text)
	return nil
}

func verificationMessage(origin, token string) (string, string) {
	link := origin + "/verifier-email?token=" + url.QueryEscape(token)
	return "Confirmez votre adresse — Cekarna",
		"Bonjour,\n\nConfirmez votre adresse pour sécuriser votre espace Cekarna :\n" + link +
			"\n\nCe lien expire dans 24 heures. Si vous n'êtes pas à l'origine de cette demande, ignorez cet email."
}

func resetMessage(origin, token string) (string, string) {
	link := origin + "/reinitialiser?token=" + url.QueryEscape(token)
	return "Réinitialiser votre mot de passe — Cekarna",
		"Bonjour,\n\nChoisissez un nouveau mot de passe depuis ce lien :\n" + link +
			"\n\nCe lien expire dans 30 minutes et révoque vos sessions actives. Si vous n'êtes pas à l'origine de cette demande, ignorez cet email."
}
