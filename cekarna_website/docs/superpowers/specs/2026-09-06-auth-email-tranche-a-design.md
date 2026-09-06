# Design — Tranche A : raccordement auth, vérification email, récupération de compte

Date : 2026-09-06. Statut : approuvé en conversation.
Portée : `cekarna_website/services/auth` (Go/Chi) et `cekarna_website/web` (React/Vite).
Les passkeys/WebAuthn (second facteur) sont la tranche B, hors portée ici.

## Contexte

Le service d'authentification Go/Chi existe déjà : inscription, connexion,
rotation de refresh tokens, logout, `/me`, JWKS, mots de passe Argon2id,
limites Redis, audit PostgreSQL. Mais :

- les formulaires React (`web/src/Auth.tsx`) affichent un message « le service
  sécurisé sera activé » au lieu d'appeler l'API ;
- aucun email n'est envoyé ; `email_verified` reste `false` ;
- la récupération de mot de passe n'existe pas.

Décisions prises avec le porteur : envoi email via interface `Mailer` avec
implémentation journal en développement (SMTP abstrait pour plus tard) ;
travail découpé en deux tranches (email d'abord, passkeys ensuite).

## Architecture

### Routes ajoutées au service Go

Toutes sous `/v1/auth` avec les garde-fous existants : `Origin` exact,
cookie CSRF + en-tête `X-CSRF-Token`, corps JSON strict 4 Kio, limites Redis.

| Méthode | Route | Comportement |
| --- | --- | --- |
| POST | `/v1/auth/verify/request` | Session requise (Bearer, sinon 401). Envoie l'email de vérification si le compte n'est pas vérifié. Réponse 202 neutre, identique que l'email soit déjà vérifié ou non. |
| POST | `/v1/auth/verify/confirm` | Corps `{token}`. Consomme le jeton et passe `email_verified=true`. 204. |
| POST | `/v1/auth/reset/request` | Corps `{email}`. Toujours 202, que le compte existe ou non (pas d'énumération). |
| POST | `/v1/auth/reset/confirm` | Corps `{token, new_password}`. Réécrit le credential Argon2id, révoque toutes les sessions de l'utilisateur, audit. 204. |

`/v1/auth/register` déclenche en plus l'envoi de l'email de vérification
(comportement ajouté au handler existant, réponse inchangée).

Codes d'erreur homogènes au service : 400 entrée invalide ; 401 jeton
invalide/expiré/consommé (réponse identique pour les trois cas) ; 403 origine
ou CSRF ; 429 quota ; 503 dépendance indisponible. Les réponses de demande
(`reset/request`, `verify/request`) sont toujours 202 pour ne pas révéler
l'existence d'un compte ni son état de vérification.

### Jetons à usage unique

Migration `002_email_tokens.sql` (idempotente, verrou consultatif comme 001) :

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

- Jeton : 256 bits aléatoires, transmis dans l'URL de l'email ; seul son
  SHA-256 est stocké (le hash suffit : pas d'attaque par dictionnaire
  possible sur 256 bits aléatoires, et une fuite SQL ne livre pas de jeton).
- Durées : vérification 24 h ; récupération 30 minutes.
- Consommation : dans la même transaction que l'effet métier (UPDATE users ou
  UPDATE credentials + révocations), marquée `consumed_at`. Tout rejeu,
  expiration ou purpose inattendu → 401 identique. Le pattern est celui déjà
  utilisé pour les refresh tokens (consommation atomique, historique conservé).
- Une nouvelle demande pour le même (user_id, purpose) n'invalide pas les
  jetons précédents non expirés : simplicité et robustesse aux emails retardés.
- Purge : les lignes expirées depuis plus de 7 jours peuvent être supprimées
  lors d'une maintenance ; non automatique dans cette tranche.

### Limites et audit

Limites Redis atomiques ajoutées (mêmes primitives que l'existant) :

- `reset/request` : 3/heure/adresse email (clé dérivée HMAC) et 10/heure/IP ;
- `verify/request` : 3/heure/compte ;
- les essais sur `*/confirm` restent couverts par la limite globale 60/min/IP.

Événements d'audit ajoutés : `email_verification_sent`, `email_verified`,
`password_reset_requested` (compte existant uniquement), `password_reset_done`,
`password_reset_rejected`. Aucun jeton, email ni IP en clair ; mêmes règles de
pseudonymisation HMAC et de regroupement des refus de quota que l'existant.

### Envoi email

```go
type Mailer interface {
    Send(ctx context.Context, to, subject, text string) error
}
```

- `LogMailer` : journalise destinataire, sujet et lien d'action ; retenu par
  `AUTH_MAILER=log` (défaut dev). Un échec du mailer ne bloque pas le flux
  métier : sur `register` et `*/request` il est journalisé et la réponse 202
  est conservée ; le jeton existe en base, le journal permet de retrouver le
  lien en dev. Un vrai transport (tranche ultérieure) rendra ce point
  mesurable par supervision des erreurs mailer.
- Les liens sont construits sur `WEB_ORIGIN` :
  `{WEB_ORIGIN}/verifier-email?token=…` et `{WEB_ORIGIN}/reinitialiser?token=…`.
- Le contrat `Mailer` est dimensionné pour un `SMTPMailer` ultérieur sans
  changement des handlers.

### Configuration

- `AUTH_MAILER` : `log` (défaut) ; valeurs futures : `smtp`.
- Durées (24 h / 30 min) : constantes de configuration internes, non exposées
  dans cette tranche.
- `.env.example` documenté sans secret ; validation au démarrage avec refus
  de démarrer sur valeur invalide, comme le socle existant.

## Frontend

### Client API (`web/src/auth-api.ts`, nouveau)

- `fetch` avec `credentials: 'include'`, `Content-Type: application/json` et
  en-tête CSRF obtenu via `GET /v1/auth/csrf` (renouvelé si 403 CSRF).
- Access token conservé **en mémoire** (variable de module), jamais dans
  localStorage ; refresh token uniquement en cookie HttpOnly.
- `bootstrapAuth()` : au chargement, tente `POST /v1/auth/refresh` puis
  `GET /v1/auth/me` ; silencieux en cas d'absence de session.
- Multi-onglets : pas de réessai automatique d'un refresh dont la réponse a
  été perdue (révocation stricte côté service) ; un seul refresh en vol grâce
  à une promesse partagée de module.

### Écrans et parcours (`web/`)

- `Auth.tsx` : inscription et connexion réelles. Règle mot de passe alignée
  sur le service : **15 caractères minimum** (au lieu de 10), sans règles de
  composition (le service accepte Unicode et espaces ; le frontend cesse
  d'exiger minuscule/majuscule/chiffre et délègue la validation finale au
  serveur).
  - Après inscription : écran « vérifiez votre boîte » + lien vers l'espace.
  - Après connexion : accès à l'espace candidat.
- `/mot-de-passe-oublie` : formulaire email unique ; confirmation neutre
  « si un compte existe, un email a été envoyé ».
- `/reinitialiser?token=…` : nouveau mot de passe (même règle 15+), succès →
  lien de connexion. Token absent/invalide → message d'erreur générique.
- `/verifier-email?token=…` : confirmation automatique au chargement, états
  succès / erreur générique.
- Bandeau « confirmez votre adresse » visible quand `email_verified=false`,
  avec bouton de renvoi (`verify/request`). **Aucune fonction n'est bloquée**
  tant que l'email n'est pas vérifié dans cette tranche.
- Le bouton « Mot de passe oublié ? » devient un lien vers
  `/mot-de-passe-oublie`. L'encart « Version de préparation » et les messages
  « sera activée avec le service d'identité » disparaissent.
- Routage : les nouvelles pages s'ajoutent au routage par chemin existant
  dans `App.tsx` (pas de nouvelle dépendance de routeur).
- L'URL de base du service vient d'une variable `VITE_AUTH_BASE_URL`
  (défaut `http://127.0.0.1:8081`, documentée).

## Gestion des erreurs

- Token de confirmation absent, malformé, expiré ou déjà consommé → même
  réponse 401 côté API, même message générique côté UI.
- Réinitialisation réussie → toutes les sessions révoquées ; les autres
  onglets/appareils sont déconnectés au prochain refresh (échec → retour
  à l'écran de connexion).
- Panne Redis ou PostgreSQL sur les nouvelles routes → 503 comme l'existant.
- Aucun log de jeton, mot de passe, email en clair, côté Go comme côté web.

## Tests

### Service Go

- Unitaires : génération/hachage de jeton, expiration, usage unique, refus
  de confusion de `purpose` (un jeton de vérification ne réinitialise pas
  un mot de passe), sélection du mailer.
- Intégration (compose réel) : cycle complet vérification puis `/me` montre
  `email_verified=true` ; cycle reset → ancien mot de passe refusé, sessions
  révoquées (refresh rejoué refusé) ; neutralité des 202 (compte inexistant,
  déjà vérifié) ; quotas.
- `go test ./... -count=1`, `go vet ./...`, cible compose de tests existante.

### Frontend

- `auth-api.ts` testé avec fetch simulé : ajout CSRF, gestion 401/429,
  promesse de refresh unique.
- Pages : redirections et messages neutres avec API simulée.
- `npm run check` vert.

## Hors portée (tranche B ou ultérieur)

- Passkeys/WebAuthn (second facteur), y compris enrôlement et récupération
  associée.
- `SMTPMailer` réel, notifications diverses, suppression de compte,
  « déconnecter tous les appareils » explicite, blocage de fonctions sur
  email non vérifié.
- Migration des données locales du candidat vers le serveur.
