# Design — Tranche B : passkeys WebAuthn comme second facteur

Date : 2026-09-06. Statut : approuvé en conversation.
Portée : `cekarna_website/services/auth` (Go/Chi) et `cekarna_website/web` (React/Vite).
Suite directe de la tranche A (fusionnée : vérification email, récupération de compte).

## Décisions prises avec le porteur

- Passkey = **second facteur optionnel** : l'utilisateur l'active depuis son espace ;
  la connexion demande la passkey uniquement si le compte en a une.
- Connexion en deux étapes via un **jeton de transition** (`mfa_token`) : aucune
  session exploitable avant le second facteur.
- Perte de la passkey : le flux **mot de passe oublié existant supprime toutes les
  passkeys** du compte (l'email est la racine de confiance, comme en tranche A).
- **Plusieurs passkeys nommées** par compte (téléphone, Windows Hello, clé USB…).
- Bibliothèque **`go-webauthn/webauthn`** (référence Go) ; attestation `none`,
  `userVerification: preferred`, compteur de signature suivi (anti-clone).

## Architecture

### Routes ajoutées au service Go

Toutes sous `/v1/auth` avec les garde-fous existants : `Origin` exact, cookie
CSRF + `X-CSRF-Token`, corps JSON strict 4 Kio, limites Redis.

**Enrôlement et gestion (session complète requise, Bearer) :**

| Méthode | Route | Comportement |
| --- | --- | --- |
| POST | `/v1/auth/mfa/register/begin` | Challenge d'attestation (Redis, 5 min, usage unique) + `PublicKeyCredentialCreationOptions`. 200. |
| POST | `/v1/auth/mfa/register/finish` | Vérifie l'attestation contre le challenge, stocke la passkey. Corps : attestation + `name`. 201. |
| GET | `/v1/auth/mfa/passkeys` | Liste des passkeys du compte (id, nom, dates). 200. |
| DELETE | `/v1/auth/mfa/passkeys/{id}` | Supprime une passkey du compte. 204. |

**Connexion (publique) :**

| Méthode | Route | Comportement |
| --- | --- | --- |
| POST | `/v1/auth/login` | *Modifiée* : compte avec ≥1 passkey → 202 `{mfa_required: true, mfa_token}`, **sans** créer de session. Compte sans passkey : comportement inchangé. |
| POST | `/v1/auth/mfa/login/begin` | Corps `{mfa_token}`. Valide le jeton (sans le consommer), génère le challenge d'assertion (Redis, 5 min) + options. 200. |
| POST | `/v1/auth/mfa/login/finish` | Corps `{mfa_token, assertion}`. Consomme jeton et challenge, met à jour le `signCount`, crée la session complète (cookie refresh comme un login normal). 200. |

Règle de sécurité majeure : le `mfa_token` ne permet **que** de terminer la
connexion. L'enrôlement (`register/*`) exige une session complète — un mot de
passe volé ne suffit pas à ajouter une passkey.

Codes d'erreur homogènes : 401 `invalid_token` identique pour jeton de
transition ou challenge absent/expiré/consommé ; 400 entrée invalide ou
attestation rejetée ; 429 quota ; 503 dépendance indisponible.

### Jeton de transition et challenges (Redis)

- `mfa_token` : 256 bits aléatoires ; clé `mfa:pending:<sha256(token)> →
  user_id`, TTL 5 min. `login/begin` le lit sans le consommer (l'utilisateur peut
  régénérer un challenge dans les 5 min) ; `login/finish` le supprime. Expiration
  → nouvelle saisie du mot de passe.
- Challenges : `mfa:challenge:<id>` → données de cérémonie sérialisées, TTL 5 min,
  usage unique (`GETDEL`), distincts selon attestation ou assertion.
- Aucun coût d'infrastructure nouveau : même Redis, quelques clés éphémères de
  plus (à noter dans `docs/PROJECT.md`).

### Migration `004_passkeys.sql`

Idempotente, verrou consultatif comme 001/002 (003 étant prise par
`003_candidate_workspaces.sql`) :

```sql
CREATE TABLE IF NOT EXISTS passkeys (
  id            text PRIMARY KEY,
  user_id       text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credential_id bytea NOT NULL UNIQUE,
  public_key    bytea NOT NULL,
  sign_count    bigint NOT NULL DEFAULT 0,
  name          text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_used_at  timestamptz
);
CREATE INDEX IF NOT EXISTS passkeys_user_idx ON passkeys(user_id);
```

`ResetPassword` (tranche A) gagne un `DELETE FROM passkeys WHERE user_id = …`
dans la même transaction que la révocation des sessions.

`credential_id` et `public_key` sont publics par construction WebAuthn, mais
restent hors des journaux par discipline ; seuls les ids internes apparaissent
dans l'audit.

### Paramètres WebAuthn figés

- `RP ID` = domaine de `WEB_ORIGIN` (variable `AUTH_RP_ID` si les domaines
  doivent diverger un jour) ; `Origin` exigée = `WEB_ORIGIN` exacte.
- `attestation: none`, `userVerification: preferred`, `residentKey: preferred`
  (le login liste les `credential_id` du compte : pas besoin de clés
  découvrables).
- Algorithmes : ES256 et EdDSA. Timeout cérémonie navigateur : 5 min (aligné
  sur le TTL Redis).
- Compteur de signature : `signCount` reçu ≤ stocké **et** > 0 → audit
  `passkey_clone_suspected` (les clés qui renvoient toujours 0 ne sont pas
  pénalisées).

### Limites et audit

Limites Redis atomiques (primitives existantes) :

- `mfa-login:mfa-token` : 10 essais `login/begin|finish` par jeton de transition ;
- `mfa-register:uid` : 5 enrôlements/heure/compte ;
- les routes publiques restent sous la limite globale 60/min/IP ; `login` garde
  ses limites (le mot de passe reste le facteur attaquable en force brute).

Événements d'audit ajoutés : `passkey_registered`, `passkey_deleted`,
`mfa_challenge_issued`, `mfa_login_succeeded`, `mfa_login_failed`,
`passkey_clone_suspected`. Mêmes règles de pseudonymisation HMAC et de
regroupement des refus de quota. `password_reset_done` documenté comme
impliquant la suppression des passkeys.

### Configuration

- `AUTH_RP_ID` : optionnel (défaut : domaine de `WEB_ORIGIN`), validé au
  démarrage, documenté dans `.env.example` sans secret.
- Nouvelle dépendance Go `github.com/go-webauthn/webauthn` : à noter dans
  `docs/PROJECT.md`.

## Frontend

### Client API (`web/src/auth-api.ts`)

- `login` : retour étendu `LoginResult = { kind: 'session' } | { kind: 'mfa',
  token: string }`. Seul point d'impact sur le socle tranche A.
- Ajouts : `beginPasskeyLogin` / `finishPasskeyLogin`,
  `beginPasskeyEnrollment` / `finishPasskeyEnrollment`, `listPasskeys`,
  `deletePasskey`.
- Adaptateur `web/src/webauthn.ts` (nouveau, isolé) : conversions
  base64url ↔ `ArrayBuffer` entre le JSON du service et
  `navigator.credentials.create/get`. Les pages n'y touchent pas.

### Parcours

- **Connexion** : mot de passe validé → 202 `mfa_required` → écran
  intermédiaire « Confirmez avec votre passkey » (état local de `Auth.tsx`,
  pas de route) → cérémonie navigateur → session complète → `/app`. Bouton
  « Annuler » → retour formulaire. Expiration du jeton → « délai dépassé » et
  retour formulaire. Compte sans passkey : aucun changement visible.
- **Sécurité** : nouvelle route `/app/securite`. Liste des passkeys (nom,
  « ajoutée le », « utilisée le », suppression avec confirmation) ; ajout :
  champ nom + cérémonie navigateur. Navigateur sans WebAuthn : section masquée
  avec note explicative, le compte reste utilisable au mot de passe.
- **Incitation** : bandeau discret dans `/app` pour les comptes sans passkey,
  « Renforcez votre compte avec une passkey » + lien, fermable et mémorisé en
  `localStorage`.

### Gestion des erreurs

- Assertion refusée, challenge expiré, passkey inconnue → même message
  générique « La passkey n'a pas été reconnue » / « délai dépassé ».
  Aucun détail technique à l'écran.
- `navigator.credentials.*` annulé par l'utilisateur → retour silencieux à
  l'écran précédent, pas d'erreur.
- Aucun log de challenge, attestation ou assertion côté web comme côté Go.

## Tests

### Service Go

- Unitaires : émission/validation/expiration/usage unique du `mfa_token` et des
  challenges ; règle « mfa_token ≠ enrôlement » ; refus d'enrôlement sans
  session complète.
- Intégration (vecteurs de cérémonie enregistrés) : cycle complet enrôlement
  → login avec passkey → session ; compte sans passkey inchangé ;
  `mfa_required` sans session créée ; reset mot de passe → passkeys supprimées
  → connexion au nouveau mot de passe sans second facteur ; signCount régressif
  → audit clone ; neutralité des 401 ; quotas.
- `go test ./... -count=1`, `go vet ./...`, suite docker existante.

### Frontend

- `webauthn.ts` et le branchement login testés avec `navigator.credentials`
  moqué (vitest) ; pages testées sur API simulée (états succès/erreur/expiration/
  annulation, état local de l'écran intermédiaire).
- `npm run check` vert.

## Hors portée

- Passkey en première étape (passwordless) ou « sign-in with passkey » sans
  mot de passe.
- Codes de récupération imprimables.
- Vérification d'attestation des fabricants de clés (FIDO MDS).
- Politique « 2FA obligatoire » (commutateur produit futur), blocage de
  fonctions sur email non vérifié, transport SMTP réel.
