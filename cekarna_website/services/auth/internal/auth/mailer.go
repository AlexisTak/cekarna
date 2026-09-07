package auth

import (
	"bytes"
	"context"
	"crypto/sha256"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"mime"
	"net"
	"net/http"
	"net/mail"
	"net/smtp"
	"net/url"
	"strings"
	"time"
)

// Mailer abstracts email delivery. Only the log transport exists for now;
// an SMTP implementation plugs in without touching the handlers.
type Mailer interface {
	Send(ctx context.Context, to, subject, text string) error
}

// NotificationMailer hands messages to the internal durable notification queue.
// It deliberately does not log recipient addresses, subjects, message contents or
// its bearer credential.
type NotificationMailer struct {
	URL    string
	Token  string
	Client *http.Client
}

func (m NotificationMailer) Send(ctx context.Context, to, subject, text string) error {
	body, err := json.Marshal(struct {
		Kind      string `json:"kind"`
		Recipient string `json:"recipient"`
		Subject   string `json:"subject"`
		TextBody  string `json:"text_body"`
	}{Kind: "auth.email", Recipient: to, Subject: subject, TextBody: text})
	if err != nil {
		return fmt.Errorf("encode notification: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, m.URL+"/v1/notifications/email", bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("create notification request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+m.Token)
	req.Header.Set("Content-Type", "application/json")
	digest := sha256.Sum256([]byte("auth.email\x00" + to + "\x00" + subject + "\x00" + text))
	req.Header.Set("Idempotency-Key", fmt.Sprintf("%x", digest))
	client := m.Client
	if client == nil {
		client = &http.Client{Timeout: 5 * time.Second}
	}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("notification request failed: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("notification service returned status %d", resp.StatusCode)
	}
	return nil
}

// SMTPMailer delivers transactional email through an SMTP server with STARTTLS.
// Its password must come from a secret manager or environment injection.
type SMTPMailer struct {
	Host, Port, Username, Password, From string
	Timeout                              time.Duration
}

func (m SMTPMailer) Send(ctx context.Context, to, subject, text string) error {
	from, err := mail.ParseAddress(m.From)
	if err != nil {
		return fmt.Errorf("invalid SMTP sender: %w", err)
	}
	recipient, err := mail.ParseAddress(to)
	if err != nil {
		return fmt.Errorf("invalid SMTP recipient: %w", err)
	}
	dialer := net.Dialer{Timeout: m.Timeout}
	conn, err := dialer.DialContext(ctx, "tcp", net.JoinHostPort(m.Host, m.Port))
	if err != nil {
		return fmt.Errorf("SMTP connection failed: %w", err)
	}
	defer conn.Close()
	if err = conn.SetDeadline(time.Now().Add(m.Timeout)); err != nil {
		return fmt.Errorf("SMTP deadline failed: %w", err)
	}
	client, err := smtp.NewClient(conn, m.Host)
	if err != nil {
		return fmt.Errorf("SMTP greeting failed: %w", err)
	}
	defer client.Quit()
	if ok, _ := client.Extension("STARTTLS"); !ok {
		return errors.New("SMTP server does not offer STARTTLS")
	}
	if err = client.StartTLS(&tls.Config{ServerName: m.Host, MinVersion: tls.VersionTLS12}); err != nil {
		return fmt.Errorf("SMTP STARTTLS failed: %w", err)
	}
	if err = client.Auth(smtp.PlainAuth("", m.Username, m.Password, m.Host)); err != nil {
		return fmt.Errorf("SMTP authentication failed: %w", err)
	}
	if err = client.Mail(from.Address); err != nil {
		return fmt.Errorf("SMTP sender rejected: %w", err)
	}
	if err = client.Rcpt(recipient.Address); err != nil {
		return fmt.Errorf("SMTP recipient rejected: %w", err)
	}
	writer, err := client.Data()
	if err != nil {
		return fmt.Errorf("SMTP data command failed: %w", err)
	}
	message := strings.Join([]string{
		"From: " + from.String(),
		"To: " + recipient.Address,
		"Subject: " + mime.BEncoding.Encode("UTF-8", subject),
		"MIME-Version: 1.0",
		"Content-Type: text/plain; charset=UTF-8",
		"Content-Transfer-Encoding: 8bit",
		"",
		text,
	}, "\r\n")
	if _, err = writer.Write([]byte(message)); err != nil {
		_ = writer.Close()
		return fmt.Errorf("SMTP message write failed: %w", err)
	}
	if err = writer.Close(); err != nil {
		return fmt.Errorf("SMTP message delivery failed: %w", err)
	}
	return nil
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
