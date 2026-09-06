# Tranche A auth — raccordement formulaires, vérification email, récupération — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Brancher les formulaires React sur le service Go/Chi et livrer vérification email + récupération de mot de passe (jetons à usage unique, mailer « log » en dev).

**Architecture:** Quatre routes POST ajoutées au service Go existant (`verify/request`, `verify/confirm`, `reset/request`, `reset/confirm`) adossées à une table `verification_tokens` (hash SHA-256 uniquement) et à une interface `Mailer` (impl dev : journal). Frontend : client `auth-api.ts` (CSRF + Bearer en mémoire, refresh à promesse unique), trois pages publiques (`/mot-de-passe-oublie`, `/reinitialiser`, `/verifier-email`), bandeau « confirmez votre adresse » dans l'espace.

**Tech Stack:** Go 1.26 / chi / pgx / go-redis (existant) ; React 19 / Vite / Vitest (existant). Aucune nouvelle dépendance.

**Spec:** `docs/superpowers/specs/2026-09-06-auth-email-tranche-a-design.md`

## Global Constraints

- Toutes les commandes Go s'exécutent depuis `cekarna_website/services/auth` ; npm depuis `cekarna_website/web` sauf mention contraire.
- Réponses neutres : `reset/request` et `verify/request` retournent toujours 202 ; jeton invalide/expiré/consommé/mauvais purpose → **même 401 `invalid_token`**.
- Jamais de jeton, mot de passe, email ou IP en clair dans les logs et audits.
- Mot de passe : 15 caractères minimum (règle `validPassword` du service, inchangée), 128 octets max ; le frontend s'aligne.
- Access token jamais dans localStorage ; cookie refresh HttpOnly uniquement.
- TypeScript strict frontend : aucun `any`.
- Le service Go n'envoie aucun email réel : `AUTH_MAILER=log` seul accepté dans cette tranche.
- Commits git dans le dépôt `cekarna_website` (racine du repo = ce dossier).
- Vérifications finales par tâche Go : `go test ./... -count=1 && go vet ./...` ; frontend : `npm test` et `npm run build`.

---

### Task 1 : Migration `002_email_tokens.sql` + embed dans migrate.go

**Files:**
- Create: `services/auth/migrations/002_email_tokens.sql`
- Modify: `services/auth/migrations/migrate.go`

**Interfaces:**
- Consumes: table `users(id)` de la migration 001.
- Produces: table `verification_tokens(token_hash text PK, user_id text FK→users ON DELETE CASCADE, purpose text CHECK IN ('verify_email','password_reset'), expires_at timestamptz, consumed_at timestamptz, created_at timestamptz)` — consommée par Task 3.

- [ ] **Step 1 : exécution idempotente déjà couverte par la fixture d'intégration**

`fixture(t)` dans `internal/auth/integration_test.go` appelle `migrations.Apply` deux fois et échoue si non rejouable — ce test existant est le test de cette tâche.

- [ ] **Step 2 : écrire `services/auth/migrations/002_email_tokens.sql`**

```sql
CREATE TABLE IF NOT EXISTS verification_tokens (
  token_hash  text PRIMARY KEY,
  user_id     text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose     text NOT NULL CHECK (purpose IN ('verify_email', 'password_reset')),
  expires_at  timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS verification_tokens_user_idx ON verification_tokens(user_id);
```

- [ ] **Step 3 : modifier `services/auth/migrations/migrate.go`**

```go
package migrations

import (
	"context"
	_ "embed"

	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed 001_auth.sql
var schema001 string

//go:embed 002_email_tokens.sql
var schema002 string

// Apply is an explicit deployment command, never run by the HTTP process.
func Apply(ctx context.Context, db *pgxpool.Pool) error {
	tx, err := db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, "SELECT pg_advisory_xact_lock(746283019)"); err != nil {
		return err
	}
	for _, migration := range []string{schema001, schema002} {
		if _, err = tx.Exec(ctx, migration); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}
```

- [ ] **Step 4 : vérifier compilation + tests d'intégration existants**

```sh
cd services/auth
go vet ./...
docker compose -f compose.yaml -f compose.test.yaml run --build --rm tests
```

Attendu : vet OK ; tests d'intégration verts (fixture applique deux fois les deux migrations dans le schéma aléatoire → `CREATE TABLE IF NOT EXISTS` + `CREATE INDEX IF NOT EXISTS` rejouables).

- [ ] **Step 5 : commit**

```sh
git add services/auth/migrations/002_email_tokens.sql services/auth/migrations/migrate.go
git commit -m "feat(auth): add verification_tokens table for one-time email tokens"
```

---

### Task 2 : Interface `Mailer`, `LogMailer`, messages, configuration `AUTH_MAILER`

**Files:**
- Create: `services/auth/internal/auth/mailer.go`
- Create: `services/auth/internal/auth/mailer_test.go`
- Modify: `services/auth/internal/auth/config.go` (champ `Mailer`, validation `AUTH_MAILER`)
- Modify: `services/auth/internal/auth/config_test.go` (entrées `AUTH_MAILER`)

**Interfaces:**
- Consumes: `Config.Origin` pour construire les liens.
- Produces:
  - `type Mailer interface { Send(ctx context.Context, to, subject, text string) error }`
  - `type LogMailer struct{}` (implémente `Mailer`)
  - `func verificationMessage(origin, token string) (subject, text string)`
  - `func resetMessage(origin, token string) (subject, text string)`
  - `Config.Mailer Mailer` — consommé par Task 4.

- [ ] **Step 1 : écrire le test qui échoue `mailer_test.go`**

```go
package auth

import (
	"context"
	"strings"
	"testing"
)

func TestLogMailerAndMessages(t *testing.T) {
	if err := (LogMailer{}).Send(context.Background(), "person@example.test", "sujet", "corps"); err != nil {
		t.Fatal("log mailer must never fail", err)
	}
	subject, text := verificationMessage("https://app.test", "tok_123")
	if !strings.Contains(text, "https://app.test/verifier-email?token=tok_123") || subject == "" {
		t.Fatal("verification message must contain the confirmation link")
	}
	subject, text = resetMessage("https://app.test", "tok_456")
	if !strings.Contains(text, "https://app.test/reinitialiser?token=tok_456") || subject == "" {
		t.Fatal("reset message must contain the recovery link")
	}
}
```

- [ ] **Step 2 : lancer le test, constater l'échec**

```sh
go test ./internal/auth/ -run TestLogMailerAndMessages -count=1
```

Attendu : FAIL compilation (`LogMailer`, `verificationMessage`, `resetMessage` indéfinis).

- [ ] **Step 3 : écrire `mailer.go`**

```go
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
```

- [ ] **Step 4 : ajouter `AUTH_MAILER` à la config**

Dans `config.go` : ajouter le champ `Mailer Mailer` à `Config`, et dans `LoadConfig`, avant `return c, nil` :

```go
	switch os.Getenv("AUTH_MAILER") {
	case "", "log":
		c.Mailer = LogMailer{}
	default:
		return Config{}, errors.New("AUTH_MAILER must be log (the only available transport)")
	}
```

- [ ] **Step 5 : étendre `config_test.go`**

Dans la map `values` de `TestProductionConfiguration`, ajouter la ligne :

```go
		"APP_ENV":                     "production",
		"AUTH_MAILER":                 "log",
```

et dans la map des valeurs invalides, ajouter :

```go
		"AUTH_MAILER":                 "smtp",
```

(vérifier à la lecture du fichier les noms exacts des deux maps et le style d'alignement en place.)

- [ ] **Step 6 : lancer les tests**

```sh
go test ./internal/auth/ -run 'TestLogMailerAndMessages|TestProductionConfiguration' -count=1
```

Attendu : PASS.

- [ ] **Step 7 : commit**

```sh
git add services/auth/internal/auth/mailer.go services/auth/internal/auth/mailer_test.go services/auth/internal/auth/config.go services/auth/internal/auth/config_test.go
git commit -m "feat(auth): add Mailer interface with log transport and email message builders"
```

---

### Task 3 : Store des jetons à usage unique (`tokens.go`)

**Files:**
- Create: `services/auth/internal/auth/tokens.go`
- Test: `services/auth/internal/auth/email_flows_test.go` (créé ici, rempli aussi en Task 4)

**Interfaces:**
- Consumes: migration 002 (Task 1), `randomToken`, `digest`, `auditTx`, `ErrDenied`.
- Produces (consommés par Task 4) :
  - `const PurposeVerifyEmail = "verify_email"`, `const PurposePasswordReset = "password_reset"`
  - `const verifyEmailTTL = 24 * time.Hour`, `const passwordResetTTL = 30 * time.Minute`
  - `func (s Store) IssueEmailToken(ctx context.Context, uid, purpose string, ttl time.Duration) (string, error)`
  - `func (s Store) VerifyEmail(ctx context.Context, tokenHash, actor string) error`
  - `func (s Store) ResetPassword(ctx context.Context, tokenHash, passwordHash, actor string) ([]string, error)`
  - `type captureMailer struct` (helper de test, réutilisé Task 4)

- [ ] **Step 1 : écrire le test d'intégration qui échoue**

Créer `services/auth/internal/auth/email_flows_test.go` :

```go
package auth

import (
	"context"
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
	if _, err := s.Store.DB.Exec(ctx, "INSERT INTO users(id,email,first_name) VALUES($1,$2,'Test')", uid, uid+"@example.test"); err != nil {
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
```

(Le test suppose les noms de colonnes de la migration 001 : vérifier `users(id,email,first_name)` et `credentials(user_id,password_hash)` dans `001_auth.sql` et ajuster si les noms diffèrent.)

- [ ] **Step 2 : lancer, constater l'échec de compilation**

```sh
go test ./internal/auth/ -run TestStoreTokenLifecycle -count=1
```

Attendu : FAIL compilation (`IssueEmailToken`, `VerifyEmail`, `ResetPassword`, constantes indéfinis).

- [ ] **Step 3 : écrire `tokens.go`**

```go
package auth

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
)

const (
	PurposeVerifyEmail   = "verify_email"
	PurposePasswordReset = "password_reset"

	verifyEmailTTL   = 24 * time.Hour
	passwordResetTTL = 30 * time.Minute
)

// IssueEmailToken returns the raw one-time token; only its SHA-256 digest is stored.
func (s Store) IssueEmailToken(ctx context.Context, uid, purpose string, ttl time.Duration) (string, error) {
	token := randomToken()
	_, err := s.DB.Exec(ctx,
		"INSERT INTO verification_tokens(token_hash,user_id,purpose,expires_at) VALUES($1,$2,$3,$4)",
		digest(token), uid, purpose, time.Now().Add(ttl))
	if err != nil {
		return "", err
	}
	return token, nil
}

// consumeEmailToken atomically marks the token used. Invalid, expired, consumed
// or wrong-purpose tokens all yield ErrDenied, indistinguishable to callers.
func consumeEmailToken(ctx context.Context, tx pgx.Tx, tokenHash, purpose string) (string, error) {
	var uid string
	err := tx.QueryRow(ctx,
		`UPDATE verification_tokens SET consumed_at=now()
		 WHERE token_hash=$1 AND purpose=$2 AND consumed_at IS NULL AND expires_at>now()
		 RETURNING user_id`, tokenHash, purpose).Scan(&uid)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrDenied
	}
	return uid, err
}

func (s Store) VerifyEmail(ctx context.Context, tokenHash, actor string) error {
	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	uid, err := consumeEmailToken(ctx, tx, tokenHash, PurposeVerifyEmail)
	if err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, "UPDATE users SET email_verified=true WHERE id=$1", uid); err != nil {
		return err
	}
	if err = auditTx(ctx, tx, "email_verified", uid, "", actor); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// ResetPassword consumes the token, replaces the credential and revokes every
// session of the user. Returned session ids let the handler block the cache.
func (s Store) ResetPassword(ctx context.Context, tokenHash, passwordHash, actor string) ([]string, error) {
	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	uid, err := consumeEmailToken(ctx, tx, tokenHash, PurposePasswordReset)
	if err != nil {
		return nil, err
	}
	if _, err = tx.Exec(ctx, "UPDATE credentials SET password_hash=$1,updated_at=now() WHERE user_id=$2", passwordHash, uid); err != nil {
		return nil, err
	}
	rows, err := tx.Query(ctx,
		"UPDATE sessions SET revoked_at=COALESCE(revoked_at,now()) WHERE user_id=$1 AND revoked_at IS NULL RETURNING id", uid)
	if err != nil {
		return nil, err
	}
	var revoked []string
	for rows.Next() {
		var id string
		if err = rows.Scan(&id); err != nil {
			rows.Close()
			return nil, err
		}
		revoked = append(revoked, id)
	}
	rows.Close()
	if rows.Err() != nil {
		return nil, rows.Err()
	}
	if err = auditTx(ctx, tx, "password_reset_done", uid, "", actor); err != nil {
		return nil, err
	}
	if err = tx.Commit(ctx); err != nil {
		return nil, err
	}
	return revoked, nil
}
```

(Vérifier dans la migration 001 que `credentials` a bien `updated_at` et `sessions` bien `revoked_at` ; si `credentials.updated_at` n'existe pas, retirer `,updated_at=now()` de l'UPDATE.)

- [ ] **Step 4 : relancer via compose (PostgreSQL/Redis réels requis)**

```sh
docker compose -f compose.yaml -f compose.test.yaml run --build --rm tests
```

Attendu : `TestStoreTokenLifecycle` PASS, suite existante verte. Sans TEST_* les tests sont ignorés — d'où compose.

- [ ] **Step 5 : commit**

```sh
git add services/auth/internal/auth/tokens.go services/auth/internal/auth/email_flows_test.go
git commit -m "feat(auth): one-time email token store with atomic consumption"
```

---

### Task 4 : Routes HTTP verify/reset + envoi à l'inscription

**Files:**
- Create: `services/auth/internal/auth/email.go`
- Modify: `services/auth/internal/auth/http.go` (struct Server, NewServer, routes, helper `authenticatedUser`, hook register, `me` refactor)
- Modify: `services/auth/internal/auth/store.go` (signature `Register`)
- Modify: `services/auth/cmd/auth/main.go` (passer `config.Mailer` à `NewServer`)
- Modify: `services/auth/internal/auth/integration_test.go` (fixture : 4e paramètre NewServer)
- Test: `services/auth/internal/auth/email_flows_test.go` (ajouts)

**Interfaces:**
- Consumes: Task 3 (`IssueEmailToken`, `VerifyEmail`, `ResetPassword`, TTLs, `captureMailer`), Task 2 (`Config.Mailer`, `verificationMessage`, `resetMessage`).
- Produces:
  - `func NewServer(c Config, s Store, g Guard, m Mailer) *Server`
  - `func (s *Server) authenticatedUser(w http.ResponseWriter, r *http.Request) (User, bool)`
  - routes POST `/v1/auth/verify/request|verify/confirm|reset/request|reset/confirm`

- [ ] **Step 1 : étendre les tests d'intégration (ajouter à `email_flows_test.go`)**

```go
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
```

Ajouter `"encoding/json"` aux imports du fichier.

Mettre à jour `fixture` dans `integration_test.go` (ligne `return NewServer(...)`) :

```go
	return NewServer(Config{Origin: "https://app.test", Secure: true, Signer: testSigner()}, Store{DB: db}, Guard{Redis: cache, Key: []byte(randomToken())}, LogMailer{})
```

(Vérifier les arguments exacts construits dans la fixture actuelle — adapter la ligne de retour uniquement pour ajouter le 4e paramètre.)

- [ ] **Step 2 : lancer, constater l'échec de compilation**

```sh
go test ./internal/auth/ -count=1
```

Attendu : FAIL compilation (`NewServer` 3 args vs fixture 4 args, `s.Mailer` inconnu, routes inexistantes).

- [ ] **Step 3 : modifier `http.go`**

- Struct `Server` : insérer le champ `Mailer Mailer` entre `Guard` et `hashSlots` ; `NewServer` devient :

```go
func NewServer(c Config, s Store, g Guard, m Mailer) *Server {
	return &Server{c, s, g, m, make(chan struct{}, 4), hashPassword(randomToken())}
}
```

- Dans `Routes()`, dans le groupe protégé CSRF, ajouter :

```go
			r.Post("/verify/request", s.verifyRequest)
			r.Post("/verify/confirm", s.verifyConfirm)
			r.Post("/reset/request", s.resetRequest)
			r.Post("/reset/confirm", s.resetConfirm)
```

- Extraire l'authentification Bearer commune et réécrire `me` :

```go
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
```

- Hook inscription : dans le handler `register`, remplacer l'appel `s.Store.Register(...)` par :

```go
	uid, err := s.Store.Register(r.Context(), email, name, hashPassword(in.Password), s.Guard.Identity(peer(r)))
	if err != nil {
		problem(w, 503, "unavailable")
		return
	}
	if uid != "" {
		s.deliverVerification(r, uid, email)
	}
	respond(w, 202, map[string]string{"message": "Si l’adresse est disponible, le compte a été créé. Vous pouvez vous connecter."})
```

- [ ] **Step 4 : modifier `store.go` — `Register` retourne l'id créé**

```go
// Register records the account when the address is free. It returns the new
// user id, or an empty string when the email was already taken — the handler
// must keep the response identical in both cases.
func (s Store) Register(ctx context.Context, email, name, passwordHash, actor string) (string, error) {
	// même corps de transaction qu'avant ; INSERT ... ON CONFLICT DO NOTHING RETURNING id
	// dans une variable id string ; audit registration_requested inchangé ;
	// retours d'erreur : return "", err ; succès : return id, tx.Commit(ctx)
}
```

(Repenser le corps exact à partir du code existant : l'INSERT actuel utilise probablement un pattern `ON CONFLICT DO NOTHING` sans RETURNING ; ajouter `RETURNING id` nécessite `QueryRow`+`pgx.ErrNoRows` au lieu de `Exec` — ou garder `Exec` + vérifier `RowsAffected()==1` puis faire un SELECT de l'id. Choisir `QueryRow` avec `errors.Is(err, pgx.ErrNoRows)` → `id=""`.)

- [ ] **Step 5 : écrire `email.go`**

```go
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
```

(`cacheRevocation` existe déjà dans http.go, utilisé par refresh/logout : réutilisé ici.)

- [ ] **Step 6 : passer le mailer dans `main.go`**

```go
	app := auth.NewServer(config, auth.Store{DB: db}, auth.Guard{Redis: cache, Key: config.AuditKey}, config.Mailer)
```

- [ ] **Step 7 : corriger les autres appelants**

```sh
grep -rn "\.Register(" services/auth --include="*.go"
grep -rn "NewServer(" services/auth --include="*.go"
```

Ajuster toute occurrence restante (attendu : seulement fixture + main.go, déjà traités).

- [ ] **Step 8 : lancer la suite complète**

```sh
go vet ./...
docker compose -f compose.yaml -f compose.test.yaml run --build --rm tests
```

Attendu : tout vert, y compris `TestIntegrationVerificationCycle` et `TestIntegrationResetCycle`.

- [ ] **Step 9 : commit**

```sh
git add services/auth/internal/auth/email.go services/auth/internal/auth/http.go services/auth/internal/auth/store.go services/auth/internal/auth/email_flows_test.go services/auth/internal/auth/integration_test.go services/auth/cmd/auth/main.go
git commit -m "feat(auth): email verification and password reset routes"
```

---

### Task 5 : Client API frontend `auth-api.ts`

**Files:**
- Create: `web/src/auth-api.ts`
- Test: `web/src/auth-api.test.ts`
- Modify: `web/src/vite-env.d.ts`

**Interfaces:**
- Consumes: routes du service Go (Task 4).
- Produces (consommés par Tasks 6-8) :
  - `interface Account { id: string; email: string; first_name: string; email_verified: boolean }`
  - `class AuthError extends Error { readonly status: number; readonly code: string }`
  - `registerAccount(email, password, firstName): Promise<void>`
  - `login(email, password): Promise<Account>`
  - `bootstrapAuth(): Promise<void>` ; `hasSession(): boolean` ; `fetchAccount(): Promise<Account>` ; `logout(): Promise<void>`
  - `requestVerificationEmail(): Promise<void>` ; `confirmEmailVerification(token): Promise<void>`
  - `requestPasswordReset(email): Promise<void>` ; `confirmPasswordReset(token, newPassword): Promise<void>`
  - `describeAuthError(error: unknown): string`

- [ ] **Step 1 : écrire le test qui échoue `web/src/auth-api.test.ts`**

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
const empty = (status: number) => new Response(null, { status });

async function loadApi() {
  return import('./auth-api');
}

describe('auth-api', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it('logs in with CSRF then fetches the account with the bearer token', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { csrf_token: 'csrf-1' }))
      .mockResolvedValueOnce(jsonResponse(200, { access_token: 'at-1', token_type: 'Bearer', expires_in: 300 }))
      .mockResolvedValueOnce(jsonResponse(200, { id: 'u1', email: 'a@b.test', first_name: 'Camille', email_verified: false }));
    vi.stubGlobal('fetch', fetchMock);
    const api = await loadApi();
    const account = await api.login('a@b.test', 'une longue phrase');
    expect(account.first_name).toBe('Camille');
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const loginHeaders = new Headers((fetchMock.mock.calls[1][1] as RequestInit).headers);
    expect(loginHeaders.get('X-CSRF-Token')).toBe('csrf-1');
    const meHeaders = new Headers((fetchMock.mock.calls[2][1] as RequestInit).headers);
    expect(meHeaders.get('Authorization')).toBe('Bearer at-1');
  });

  it('rejects a refused login with status 401', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { csrf_token: 'csrf-1' }))
      .mockResolvedValueOnce(jsonResponse(401, { error: 'invalid_credentials' }));
    vi.stubGlobal('fetch', fetchMock);
    const api = await loadApi();
    await expect(api.login('a@b.test', 'x'.repeat(15))).rejects.toMatchObject({ status: 401 });
  });

  it('renews CSRF once on 403 and retries', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { csrf_token: 'csrf-1' }))
      .mockResolvedValueOnce(jsonResponse(403, { error: 'csrf_expired' }))
      .mockResolvedValueOnce(jsonResponse(200, { csrf_token: 'csrf-2' }))
      .mockResolvedValueOnce(empty(204));
    vi.stubGlobal('fetch', fetchMock);
    const api = await loadApi();
    await api.confirmEmailVerification('tok');
    expect(fetchMock).toHaveBeenCalledTimes(4);
    const lastInit = fetchMock.mock.calls[3][1] as RequestInit;
    expect(new Headers(lastInit.headers).get('X-CSRF-Token')).toBe('csrf-2');
  });

  it('shares one in-flight refresh between concurrent bootstraps', async () => {
    let resolveRefresh: (r: Response) => void = () => {};
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { csrf_token: 'csrf-1' }))
      .mockImplementationOnce(
        () => new Promise<Response>((resolve) => { resolveRefresh = resolve; }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const api = await loadApi();
    const first = api.bootstrapAuth();
    const second = api.bootstrapAuth();
    resolveRefresh(jsonResponse(401, { error: 'invalid_session' }));
    await Promise.all([first, second]);
    const refreshCalls = fetchMock.mock.calls.filter((c) => String(c[0]).endsWith('/v1/auth/refresh'));
    expect(refreshCalls).toHaveLength(1);
  });

  it('maps errors to French user-facing copy', async () => {
    const api = await loadApi();
    expect(api.describeAuthError(new api.AuthError(429, 'too_many_attempts'))).toContain('Trop de tentatives');
    expect(api.describeAuthError(new api.AuthError(400, 'invalid_input'))).toContain('Vérifiez vos informations');
    expect(api.describeAuthError(new Error('network'))).toContain('indisponible');
  });
});
```

- [ ] **Step 2 : lancer, constater l'échec**

```sh
cd web && npm test -- auth-api
```

Attendu : FAIL (`./auth-api` inexistant).

- [ ] **Step 3 : écrire `web/src/auth-api.ts`**

```ts
export interface Account {
  id: string;
  email: string;
  first_name: string;
  email_verified: boolean;
}

export class AuthError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string) {
    super(code);
    this.name = 'AuthError';
    this.status = status;
    this.code = code;
  }
}

const BASE: string =
  (import.meta.env.VITE_AUTH_BASE_URL as string | undefined)?.replace(/\/$/, '') ||
  'http://127.0.0.1:8081';

let csrfToken = '';
let accessToken = '';
let ongoingRefresh: Promise<void> | null = null;

async function toError(response: Response): Promise<AuthError> {
  let code = 'request_failed';
  try {
    const body = (await response.json()) as { error?: string };
    if (typeof body.error === 'string' && body.error) code = body.error;
  } catch {
    // non-JSON error body: keep the generic code
  }
  return new AuthError(response.status, code);
}

async function ensureCsrf(force: boolean): Promise<string> {
  if (csrfToken && !force) return csrfToken;
  const response = await fetch(`${BASE}/v1/auth/csrf`, { credentials: 'include' });
  if (!response.ok) throw await toError(response);
  const body = (await response.json()) as { csrf_token?: string };
  if (typeof body.csrf_token !== 'string' || !body.csrf_token)
    throw new AuthError(503, 'csrf_unavailable');
  csrfToken = body.csrf_token;
  return csrfToken;
}

async function mutate(
  path: string,
  body: Record<string, string>,
  bearer: boolean,
): Promise<Response> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-CSRF-Token': await ensureCsrf(attempt > 0),
    };
    if (bearer) headers.Authorization = `Bearer ${accessToken}`;
    const response = await fetch(`${BASE}${path}`, {
      method: 'POST',
      credentials: 'include',
      headers,
      body: JSON.stringify(body),
    });
    if (response.status !== 403 || attempt === 1) return response;
  }
  throw new AuthError(0, 'unreachable');
}

async function storeAccessToken(response: Response): Promise<void> {
  const body = (await response.json()) as { access_token?: string };
  if (typeof body.access_token !== 'string' || !body.access_token)
    throw new AuthError(503, 'token_missing');
  accessToken = body.access_token;
}

export async function registerAccount(
  email: string,
  password: string,
  firstName: string,
): Promise<void> {
  const response = await mutate(
    '/v1/auth/register',
    { email, password, first_name: firstName },
    false,
  );
  if (response.status !== 202) throw await toError(response);
}

export async function fetchAccount(): Promise<Account> {
  const response = await fetch(`${BASE}/v1/auth/me`, {
    credentials: 'include',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw await toError(response);
  return (await response.json()) as Account;
}

export async function login(email: string, password: string): Promise<Account> {
  const response = await mutate('/v1/auth/login', { email, password }, false);
  if (!response.ok) throw await toError(response);
  await storeAccessToken(response);
  return fetchAccount();
}

// bootstrapAuth shares a single in-flight refresh: replaying a lost refresh
// would revoke the whole session family server-side.
export function bootstrapAuth(): Promise<void> {
  ongoingRefresh ??= (async () => {
    const response = await mutate('/v1/auth/refresh', {}, false);
    if (!response.ok) {
      accessToken = '';
      return;
    }
    await storeAccessToken(response);
  })().finally(() => {
    ongoingRefresh = null;
  });
  return ongoingRefresh;
}

export function hasSession(): boolean {
  return accessToken !== '';
}

export async function logout(): Promise<void> {
  try {
    await mutate('/v1/auth/logout', {}, false);
  } finally {
    accessToken = '';
  }
}

export async function requestVerificationEmail(): Promise<void> {
  const response = await mutate('/v1/auth/verify/request', {}, true);
  if (response.status !== 202) throw await toError(response);
}

export async function confirmEmailVerification(token: string): Promise<void> {
  const response = await mutate('/v1/auth/verify/confirm', { token }, false);
  if (response.status !== 204) throw await toError(response);
}

export async function requestPasswordReset(email: string): Promise<void> {
  const response = await mutate('/v1/auth/reset/request', { email }, false);
  if (response.status !== 202) throw await toError(response);
}

export async function confirmPasswordReset(
  token: string,
  newPassword: string,
): Promise<void> {
  const response = await mutate(
    '/v1/auth/reset/confirm',
    { token, new_password: newPassword },
    false,
  );
  if (response.status !== 204) throw await toError(response);
}

export function describeAuthError(error: unknown): string {
  if (error instanceof AuthError) {
    if (error.status === 400) return 'Vérifiez vos informations et réessayez.';
    if (error.status === 429)
      return 'Trop de tentatives. Réessayez dans quelques minutes.';
  }
  return 'Le service d’identité est indisponible. Réessayez dans un instant.';
}
```

- [ ] **Step 4 : typer la variable d'environnement — `web/src/vite-env.d.ts`**

```ts
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_AUTH_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
```

- [ ] **Step 5 : lancer tests + build**

```sh
cd web && npm test && npm run build
```

Attendu : tests `auth-api` verts ; `tsc` propre.

- [ ] **Step 6 : commit**

```sh
git add web/src/auth-api.ts web/src/auth-api.test.ts web/src/vite-env.d.ts
git commit -m "feat(web): auth API client with CSRF handling and shared refresh"
```

---

### Task 6 : Raccordement de `Auth.tsx` (inscription/connexion réelles)

**Files:**
- Modify: `web/src/Auth.tsx`
- Modify: `web/src/style.css` (classe `.auth-feedback.error`)

**Interfaces:**
- Consumes: `registerAccount`, `login`, `describeAuthError`, `AuthError` (Task 5).
- Produces: inchangé — export default `Auth({ mode })`.

- [ ] **Step 1 : modifier `Auth.tsx`**

Changements précis (édit par édit, sur la base du fichier actuel) :

1. Imports : ajouter

```ts
import {
  AuthError,
  describeAuthError,
  login,
  registerAccount,
} from './auth-api';
```

2. Règle mot de passe alignée sur le service — remplacer `passwordError` :

```ts
function passwordError(password: string): string | undefined {
  if (password.length < 15) return 'Utilisez au moins 15 caractères.';
  return undefined;
}
```

3. États : ajouter

```ts
  const [busy, setBusy] = useState(false);
  const [signedUp, setSignedUp] = useState(false);
  const [serverError, setServerError] = useState('');
```

et supprimer l'état/usage de `feedback` (le message « …sera activée avec le service d'identité » disparaît).

4. `submit` devient async :

```ts
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setServerError('');
    const form = new FormData(event.currentTarget);
    const firstName = String(form.get('firstName') ?? '').trim();
    const email = String(form.get('email') ?? '').trim();
    const password = String(form.get('password') ?? '');
    const nextErrors: FieldErrors = {};

    if (isSignup && firstName.length < 2)
      nextErrors.firstName = 'Indiquez votre prénom.';
    if (!emailPattern.test(email))
      nextErrors.email = 'Saisissez une adresse email valide.';
    if (isSignup) nextErrors.password = passwordError(password);
    else if (!password) nextErrors.password = 'Saisissez votre mot de passe.';
    if (isSignup && form.get('terms') !== 'accepted')
      nextErrors.terms = 'Votre accord est nécessaire pour créer le compte.';

    setErrors(nextErrors);
    if (Object.values(nextErrors).some(Boolean)) return;

    setBusy(true);
    try {
      if (isSignup) {
        await registerAccount(email, password, firstName);
        setSignedUp(true);
      } else {
        await login(email, password);
        window.location.assign('/app');
      }
    } catch (error) {
      if (error instanceof AuthError && error.status === 401 && !isSignup) {
        setServerError('Adresse ou mot de passe incorrect.');
      } else {
        setServerError(describeAuthError(error));
      }
    } finally {
      setBusy(false);
    }
  }
```

(Conserver les helpers `FieldErrors`/`emailPattern` existants s'ils portent ces noms dans le fichier ; sinon s'aligner sur les noms réels.)

5. Placeholder du champ mot de passe : `'10 caractères minimum'` → `'15 caractères minimum'` ; ajouter `minLength={15}` sur l'input password.

6. « Mot de passe oublié ? » devient un lien — remplacer le bouton à classe `forgot-link` :

```tsx
            {!isSignup && (
              <a className="forgot-link" href="/mot-de-passe-oublie">
                Mot de passe oublié ?
              </a>
            )}
```

7. Supprimer l'encart `auth-preview-note` (« Version de préparation… ») entièrement.

8. Bouton submit : `disabled={busy}` ; libellé `'Création…'` / `'Connexion…'` pendant `busy`.

9. Écran post-inscription — juste après `return (`, avant le rendu principal :

```tsx
  if (signedUp) {
    return (
      <div className="auth-page">
        <main className="auth-main">
          <section className="auth-card" aria-label="Inscription">
            <div className="auth-card-heading">
              <span className="auth-lock"><Check size={19} /></span>
              <div>
                <h2>Consultez votre boîte email</h2>
                <p>
                  Si l’adresse est disponible, un email de confirmation vient de
                  partir. Suivez son lien pour activer votre espace.
                </p>
              </div>
            </div>
            <p className="auth-local-access">
              <a href="/connexion">Aller à la connexion</a>
            </p>
          </section>
        </main>
      </div>
    );
  }
```

10. Remplacer le bloc de rendu `{feedback && ...}` par :

```tsx
            {serverError && (
              <div className="auth-feedback error" role="alert">
                <span>{serverError}</span>
              </div>
            )}
```

- [ ] **Step 2 : ajouter la classe d'erreur dans `web/src/style.css`**

Vérifier d'abord si une variable danger existe : `grep -n "danger" web/src/style.css | head -5`. Puis ajouter, près des règles `.auth-feedback` existantes :

```css
.auth-feedback.error {
  color: #b3261e;
}
```

(Si le projet définit déjà une variable de couleur danger, l'utiliser à la place du littéral.)

- [ ] **Step 3 : vérifier**

```sh
cd web && npm test && npm run build
```

Attendu : build vert (TypeScript strict valide la compilation ; les tests DOM sont hors périmètre vitest actuel — pas de jsdom installé).

- [ ] **Step 4 : commit**

```sh
git add web/src/Auth.tsx web/src/style.css
git commit -m "feat(web): wire signup and login forms to the auth service"
```

---

### Task 7 : Pages `/mot-de-passe-oublie`, `/reinitialiser`, `/verifier-email` + routage

**Files:**
- Create: `web/src/Recover.tsx`
- Create: `web/src/PasswordReset.tsx`
- Create: `web/src/VerifyEmail.tsx`
- Modify: `web/src/main.tsx`

**Interfaces:**
- Consumes: `requestPasswordReset`, `confirmPasswordReset`, `confirmEmailVerification`, `describeAuthError` (Task 5) ; classes CSS existantes (`auth-page`, `auth-card`, `auth-form`, `auth-submit`, `auth-feedback`, `auth-local-access`, `auth-lock`, `auth-header`, `landing-brand`, `landing-brand-icon`, `auth-back`).
- Produces: trois pages publiques routées par chemin dans `main.tsx`.

- [ ] **Step 1 : écrire `web/src/Recover.tsx`**

```tsx
import { FormEvent, useEffect, useState } from 'react';
import { ArrowLeft, Compass, MailCheck } from 'lucide-react';
import { describeAuthError, requestPasswordReset } from './auth-api';

export default function Recover() {
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    document.title = 'Mot de passe oublié — Cekarna';
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    const email = String(new FormData(event.currentTarget).get('email') ?? '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError('Saisissez une adresse email valide.');
      return;
    }
    setBusy(true);
    try {
      await requestPasswordReset(email);
      setSent(true);
    } catch (err) {
      setError(describeAuthError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-page">
      <header className="auth-header">
        <a className="landing-brand" href="/" aria-label="Accueil Cekarna">
          <span className="landing-brand-icon">
            <Compass size={22} strokeWidth={2.3} />
          </span>
          cekarna<span>.</span>
        </a>
        <a className="auth-back" href="/connexion">
          <ArrowLeft size={16} /> Retour à la connexion
        </a>
      </header>
      <main className="auth-main">
        <section className="auth-card" aria-label="Récupération du compte">
          <div className="auth-card-heading">
            <span className="auth-lock"><MailCheck size={19} /></span>
            <div>
              <h2>Récupérer l’accès</h2>
              <p>Nous vous enverrons un lien pour choisir un nouveau mot de passe.</p>
            </div>
          </div>
          {sent ? (
            <div className="auth-feedback" role="status">
              <MailCheck size={18} />
              <span>
                Si un compte existe pour cette adresse, un email de récupération
                a été envoyé. Le lien expire dans 30 minutes.
              </span>
            </div>
          ) : (
            <form className="auth-form" noValidate onSubmit={submit}>
              <label>
                Adresse email
                <input
                  name="email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  maxLength={254}
                  placeholder="vous@exemple.fr"
                />
              </label>
              <button className="auth-submit" type="submit" disabled={busy}>
                {busy ? 'Envoi…' : 'Envoyer le lien'}
              </button>
              {error && (
                <div className="auth-feedback error" role="alert">
                  <span>{error}</span>
                </div>
              )}
            </form>
          )}
        </section>
      </main>
    </div>
  );
}
```

- [ ] **Step 2 : écrire `web/src/PasswordReset.tsx`**

```tsx
import { FormEvent, useEffect, useState } from 'react';
import { ArrowLeft, Compass, KeyRound } from 'lucide-react';
import { AuthError, confirmPasswordReset, describeAuthError } from './auth-api';

export default function PasswordReset() {
  const token = new URLSearchParams(window.location.search).get('token') ?? '';
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState(token ? '' : 'Ce lien de récupération est incomplet.');

  useEffect(() => {
    document.title = 'Nouveau mot de passe — Cekarna';
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    const password = String(new FormData(event.currentTarget).get('password') ?? '');
    if (password.length < 15) {
      setError('Utilisez au moins 15 caractères.');
      return;
    }
    setBusy(true);
    try {
      await confirmPasswordReset(token, password);
      setDone(true);
    } catch (err) {
      setError(
        err instanceof AuthError && err.status === 401
          ? 'Ce lien est expiré ou déjà utilisé. Demandez un nouveau lien.'
          : describeAuthError(err),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-page">
      <header className="auth-header">
        <a className="landing-brand" href="/" aria-label="Accueil Cekarna">
          <span className="landing-brand-icon">
            <Compass size={22} strokeWidth={2.3} />
          </span>
          cekarna<span>.</span>
        </a>
        <a className="auth-back" href="/connexion">
          <ArrowLeft size={16} /> Retour à la connexion
        </a>
      </header>
      <main className="auth-main">
        <section className="auth-card" aria-label="Nouveau mot de passe">
          <div className="auth-card-heading">
            <span className="auth-lock"><KeyRound size={19} /></span>
            <div>
              <h2>Choisir un nouveau mot de passe</h2>
              <p>Toutes vos sessions actives seront déconnectées.</p>
            </div>
          </div>
          {done ? (
            <div className="auth-feedback" role="status">
              <KeyRound size={18} />
              <span>
                Mot de passe enregistré.{' '}
                <a href="/connexion">Connectez-vous avec votre nouveau mot de passe.</a>
              </span>
            </div>
          ) : (
            <form className="auth-form" noValidate onSubmit={submit}>
              <label>
                Nouveau mot de passe
                <input
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  minLength={15}
                  maxLength={128}
                  placeholder="15 caractères minimum"
                />
              </label>
              <button className="auth-submit" type="submit" disabled={busy || !token}>
                {busy ? 'Enregistrement…' : 'Enregistrer le mot de passe'}
              </button>
              {error && (
                <div className="auth-feedback error" role="alert">
                  <span>{error}</span>
                </div>
              )}
            </form>
          )}
        </section>
      </main>
    </div>
  );
}
```

- [ ] **Step 3 : écrire `web/src/VerifyEmail.tsx`**

StrictMode invoque les effets deux fois en dev : un `useRef` empêche de consommer le jeton deux fois (le POST n'est pas idempotent).

```tsx
import { useEffect, useRef, useState } from 'react';
import { Compass, ShieldCheck } from 'lucide-react';
import { confirmEmailVerification } from './auth-api';

export default function VerifyEmail() {
  const [state, setState] = useState<'pending' | 'ok' | 'error'>('pending');
  const started = useRef(false);

  useEffect(() => {
    document.title = 'Confirmation de votre adresse — Cekarna';
    if (started.current) return;
    started.current = true;
    const token = new URLSearchParams(window.location.search).get('token') ?? '';
    if (!token) {
      setState('error');
      return;
    }
    confirmEmailVerification(token)
      .then(() => setState('ok'))
      .catch(() => setState('error'));
  }, []);

  return (
    <div className="auth-page">
      <header className="auth-header">
        <a className="landing-brand" href="/" aria-label="Accueil Cekarna">
          <span className="landing-brand-icon">
            <Compass size={22} strokeWidth={2.3} />
          </span>
          cekarna<span>.</span>
        </a>
      </header>
      <main className="auth-main">
        <section className="auth-card" aria-label="Confirmation de l’adresse email">
          <div className="auth-card-heading">
            <span className="auth-lock"><ShieldCheck size={19} /></span>
            <div>
              <h2>Confirmation de votre adresse</h2>
              <p aria-live="polite">
                {state === 'pending' && 'Vérification en cours…'}
                {state === 'ok' &&
                  'Votre adresse est confirmée. Merci ! Vous pouvez fermer cet onglet.'}
                {state === 'error' &&
                  'Ce lien est invalide, expiré ou déjà utilisé. Connectez-vous pour demander un nouveau lien.'}
              </p>
            </div>
          </div>
          <p className="auth-local-access">
            <a href="/connexion">Aller à la connexion</a>
          </p>
        </section>
      </main>
    </div>
  );
}
```

- [ ] **Step 4 : routage dans `web/src/main.tsx`**

Remplacer la sélection d'écran actuelle par :

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/dm-sans';
import App from './App';
import Auth from './Auth';
import Landing from './Landing';
import PasswordReset from './PasswordReset';
import Recover from './Recover';
import VerifyEmail from './VerifyEmail';
import './style.css';

const path = window.location.pathname.replace(/\/$/, '') || '/';
const params = new URLSearchParams(window.location.search);
const isCandidateSpace = path === '/app' || params.get('workspace') === 'candidate';

let screen: React.ReactElement;
if (path === '/inscription') screen = <Auth mode="signup" />;
else if (path === '/connexion') screen = <Auth mode="login" />;
else if (path === '/mot-de-passe-oublie') screen = <Recover />;
else if (path === '/reinitialiser') screen = <PasswordReset />;
else if (path === '/verifier-email') screen = <VerifyEmail />;
else screen = isCandidateSpace ? <App /> : <Landing />;

createRoot(document.getElementById('root')!).render(
  <StrictMode>{screen}</StrictMode>,
);
```

(Préserver les imports existants du fichier s'ils diffèrent — vérifier notamment la fonte et les noms d'import.)

- [ ] **Step 5 : vérifier**

```sh
cd web && npm test && npm run build
```

- [ ] **Step 6 : commit**

```sh
git add web/src/Recover.tsx web/src/PasswordReset.tsx web/src/VerifyEmail.tsx web/src/main.tsx
git commit -m "feat(web): password recovery, reset and email verification pages"
```

---

### Task 8 : Bandeau « confirmez votre adresse » dans l'espace candidat

**Files:**
- Modify: `web/src/App.tsx`

**Interfaces:**
- Consumes: `bootstrapAuth`, `fetchAccount`, `requestVerificationEmail`, `describeAuthError`, `Account` (Task 5) ; classe CSS `warning-banner` existante ; helper de toast existant (`setToast` — vérifier le nom réel dans le fichier).
- Produces: rien de nouveau consommé ailleurs.

- [ ] **Step 1 : modifier `App.tsx`**

1. Imports : ajouter à l'import lucide existant `MailWarning`, et :

```tsx
import {
  bootstrapAuth,
  describeAuthError,
  fetchAccount,
  requestVerificationEmail,
  type Account,
} from './auth-api';
```

2. Dans `App()`, état + bootstrap (l'espace reste utilisable hors connexion — données locales ; l'absence de session reste silencieuse) :

```tsx
  const [account, setAccount] = useState<Account | null>(null);
  useEffect(() => {
    let cancelled = false;
    bootstrapAuth()
      .then(() => fetchAccount().catch(() => null))
      .then((me) => {
        if (!cancelled && me) setAccount(me);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
```

StrictMode : `cancelled` protège le setState ; le refresh lui-même est dédupliqué par la promesse partagée du module `auth-api`.

3. Renvoi de l'email (adapter au helper de toast réel du fichier) :

```tsx
  function resendVerification() {
    requestVerificationEmail()
      .then(() => setToast('Si nécessaire, un email de confirmation a été envoyé.'))
      .catch((err: unknown) => setToast(describeAuthError(err)));
  }
```

4. Bandeau, rendu juste avant le bandeau `demo` existant :

```tsx
          {account && !account.email_verified && (
            <div role="status" className="warning-banner">
              <MailWarning size={17} />
              Confirmez votre adresse email ({account.email}) pour sécuriser votre compte.
              <button onClick={resendVerification}>Renvoyer l’email</button>
            </div>
          )}
```

(Vérifier la structure exacte du bandeau `demo` — order/attributs — et copier le même markup si le `warning-banner` attend un pattern précis.)

- [ ] **Step 2 : vérifier**

```sh
cd web && npm test && npm run build
```

- [ ] **Step 3 : commit**

```sh
git add web/src/App.tsx
git commit -m "feat(web): show unverified-email banner with resend in candidate space"
```

---

### Task 9 : Documentation (README service, env files, PROJECT.md)

**Files:**
- Modify: `services/auth/README.md`
- Modify: `services/auth/.env.example`
- Modify: `docs/PROJECT.md`
- Create: `web/.env.example`

**Interfaces:** aucune (documentation uniquement).

- [ ] **Step 1 : `services/auth/.env.example` — ajouter**

```
# AUTH_MAILER=log
```

(Seule valeur acceptée dans cette tranche ; `log` est aussi la valeur par défaut.)

- [ ] **Step 2 : créer `web/.env.example`**

```
# Base URL of the auth service (Go/Chi). Default: http://127.0.0.1:8081
# Keep the SAME loopback host as the frontend origin (127.0.0.1, not localhost):
# SameSite treats localhost and 127.0.0.1 as different sites.
VITE_AUTH_BASE_URL=http://127.0.0.1:8081
```

- [ ] **Step 3 : `services/auth/README.md`**

- Table « API navigateur » : ajouter quatre lignes

```
| POST | `/v1/auth/verify/request` | Bearer requis ; renvoie l'email de vérification si nécessaire ; 202 neutre |
| POST | `/v1/auth/verify/confirm` | `{token}` ; consomme le jeton, `email_verified=true` ; 204 |
| POST | `/v1/auth/reset/request` | `{email}` ; toujours 202, email envoyé seulement si le compte existe |
| POST | `/v1/auth/reset/confirm` | `{token, new_password}` ; nouveau credential Argon2id, toutes les sessions révoquées ; 204 |
```

- Section « Garanties » : ajouter

```
- Jetons email à usage unique (vérification 24 h, récupération 30 min) : 256 bits
  aléatoires, seul le SHA-256 en base, consommation atomique dans la transaction
  métier ; rejeu, expiration et confusion de purpose refusés avec le même 401.
  `reset/confirm` paie le hachage Argon2id avant le contrôle du jeton afin que le
  timing d'un refus ne révèle pas son existence ; la réinitialisation révoque
  toutes les sessions du compte.
```

- Section « limites de cette livraison » : réécrire le paragraphe concerné — vérification email et récupération livrées avec transport `log` ; reste : SMTP réel + supervision mailer avant ouverture publique, suppression de compte, notifications, « déconnecter tous les appareils » explicite, MFA/passkeys (tranche B).

- [ ] **Step 4 : `docs/PROJECT.md` — mettre à jour la section du service d'authentification**

```
Formulaires web raccordés le 6 septembre 2026 ; vérification email et
récupération de mot de passe livrées (transport mailer `log` en développement,
SMTP à brancher avant ouverture publique). MFA/passkeys : tranche B à spécifier.
Les données du candidat restent locales au navigateur.
```

- [ ] **Step 5 : vérification finale globale**

```sh
cd services/auth && go vet ./... && docker compose -f compose.yaml -f compose.test.yaml run --build --rm tests
cd ../../web && npm test && npm run build
cd .. && npm run check
```

Attendu : tout vert (la vérification NestJS `npm run check`, depuis la racine `cekarna_website`, ne touche pas les nouveaux fichiers mais reste la porte projet).

- [ ] **Step 6 : commit**

```sh
git add services/auth/README.md services/auth/.env.example docs/PROJECT.md web/.env.example
git commit -m "docs: document email verification and recovery tranche"
```

---

## Self-review effectué

- Couverture spec : routes (T4), table jetons (T1), limites (T4), audit (T4), Mailer + config (T2, T9), frontend client/écrans/bandeau (T5-T8), règle 15 caractères (T6), tests Go+web (T3, T4, T5). Aucun trou.
- Pas de placeholder : chaque étape de code contient le code complet. Les seuls points « vérifier à la lecture » sont des alignements sur le code existant (noms de colonnes migration 001, helpers Auth.tsx/App.tsx, maps config_test) — inévitables sans recopier les fichiers entiers ; à résoudre par l'exécuteur à la lecture du fichier.
- Cohérence des types : `NewServer(c, s, g, m)` identique en T2 (config), T4 (http.go, main.go, fixture) ; `Account`/`AuthError`/fonctions `auth-api` nommés à l'identique en T5→T8 ; `PurposeVerifyEmail`/`PurposePasswordReset` cohérents T3↔T4 ; `captureMailer` défini T3, réutilisé T4 — même package, même fichier de test.
