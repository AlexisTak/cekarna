# Cekarna Auth — Go / Chi

Service autonome demandé le 6 septembre 2026. PostgreSQL conserve utilisateurs,
credentials Argon2id, sessions, historique des refresh tokens et audit. Redis
conserve limites de tentatives, sessions CSRF temporaires et cache de révocation.
L’API NestJS reste indépendante. Le frontend React de `web/` est raccordé à ce
service (inscription, connexion, vérification email, récupération du mot de
passe) et au stockage privé du dossier candidat. Une copie locale reste utilisée
pour le mode sans compte et comme repli temporaire en cas d’échec réseau.

## Démarrage local

Prérequis : Go 1.26.6+ (téléchargement automatique du toolchain autorisé par Go),
Docker Desktop démarré. Depuis ce dossier :

```sh
go run ./cmd/auth init-dev
docker compose up --build -d
```

`init-dev` génère des secrets aléatoires dans `.env` et `.secrets/ed25519.key`,
ignorés par Git et exclus du contexte Docker. Il refuse de remplacer un fichier
existant. Les secrets sont propres à ce poste. Sous Unix, si le montage refuse
l’accès à la clé, donner au seul UID du conteneur (65532) le droit de la lire ;
ne pas la rendre lisible à tous. En production, utiliser un gestionnaire de secrets.

Le service écoute sur `http://127.0.0.1:8081`, PostgreSQL sur le port 55432 et Redis
sur 56379, uniquement en boucle locale. `/health/ready` contrôle les deux bases.
Compose est un environnement **de développement** avec cookies non Secure et
connexions internes sans TLS. Les volumes persistent après `docker compose stop`.
Le service ne migre pas au démarrage : le conteneur `migrate` exécute la migration
idempotente 001 dans une transaction protégée par verrou consultatif.

## API navigateur

Toutes les mutations exigent `Origin` exactement égal à `WEB_ORIGIN`, le cookie
CSRF et le même jeton dans `X-CSRF-Token`. CORS autorise cette seule origine.
Le navigateur envoie `credentials: 'include'`. Les corps métier sont JSON strict,
sans champs inconnus et limités à 4 Kio. Les POST sans corps peuvent envoyer `{}`.

| Méthode | Route | Résultat |
| --- | --- | --- |
| GET | `/v1/auth/csrf` | Jeton CSRF + cookie HttpOnly, valables 15 min ; Origin obligatoire |
| POST | `/v1/auth/register` | `{email, password, first_name}` ; 202 identique si adresse déjà utilisée |
| POST | `/v1/auth/login` | `{email, password}` ; access token JSON + refresh token en cookie HttpOnly |
| POST | `/v1/auth/refresh` | Cookie refresh ; rotation et nouvel access token |
| POST | `/v1/auth/logout` | Révocation de la session/famille, suppression du cookie ; 204 |
| POST | `/v1/auth/logout-all` | Bearer + CSRF ; révoque toutes les sessions du compte ; 204 |
| POST | `/v1/auth/delete` | Bearer + CSRF + `{password}` ; efface le compte et ses données ; 204 |
| POST | `/v1/auth/verify/request` | Bearer requis ; renvoie l'email de vérification si nécessaire ; 202 neutre |
| POST | `/v1/auth/verify/confirm` | `{token}` ; consomme le jeton, `email_verified=true` ; 204 |
| POST | `/v1/auth/reset/request` | `{email}` ; toujours 202, email envoyé seulement si le compte existe |
| POST | `/v1/auth/reset/confirm` | `{token, new_password}` ; nouveau credential Argon2id, toutes les sessions révoquées ; 204 |
| GET | `/v1/auth/me` | Bearer access token ; utilisateur après contrôle de révocation |
| GET | `/v1/candidate/workspace` | Bearer requis ; dossier candidat privé, sa révision, ou 204 s’il est vide |
| PUT | `/v1/candidate/workspace` | Bearer + CSRF ; `{workspace, revision}` (5 Mo) ; refuse avec 409 une révision obsolète. `{overwrite:true}` remplace explicitement une copie distante. |
| GET | `/.well-known/jwks.json` | Clés publiques Ed25519, `kid`, `alg=EdDSA`, cache 60 s |
| GET | `/health/live`, `/health/ready` | Vie du processus / disponibilité des dépendances |

Erreurs : 400 entrée invalide ; 401 identifiants/token/session refusés ; 403 origine
ou CSRF ; 429 quota de tentatives ; 503 dépendance indisponible ou hachage saturé.
Une réponse 202 ne vaut pas validation de propriété de l’adresse email. Une réponse 409 signifie qu’un autre appareil a enregistré une version plus récente du dossier : le frontend doit proposer de charger cette copie ou de confirmer l’écrasement.

Exemple d’intégration à adapter dans le frontend (le JWT reste en mémoire) :

```js
const base = 'http://127.0.0.1:8081';
const csrfResponse = await fetch(`${base}/v1/auth/csrf`, { credentials: 'include' });
if (!csrfResponse.ok) throw new Error('Authentification indisponible');
const { csrf_token } = await csrfResponse.json();
// values provient du formulaire ; ne jamais journaliser ses champs.
const response = await fetch(`${base}/v1/auth/login`, {
  method: 'POST', credentials: 'include',
  headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf_token },
  body: JSON.stringify({ email: values.email, password: values.password }),
});
if (!response.ok) throw new Error('Connexion refusée');
const { access_token } = await response.json();
```

Ne jamais mettre access/refresh tokens dans localStorage. Le cookie de refresh ne
figure pas dans le JSON. Utiliser le même hôte local (127.0.0.1) pour le frontend et
l’API ; `localhost` et `127.0.0.1` sont des sites différents pour SameSite. En
production, placer l’API sous le même site que le frontend, via un proxy HTTPS.
Le site statique ChatGPT existant ne doit pas recevoir ce service Go tel quel.

## Garanties et paramètres

- Argon2id version 19 : 64 Mio, 3 passes, parallélisme 1, sel 16 octets, sortie
  32 octets. Paramètres enregistrés au format PHC ; comparaison constante.
  Maximum 4 hachages simultanés par processus (environ 256 Mio hors serveur).
  Mot de passe : 15 caractères minimum, 128 octets maximum, espaces et Unicode
  acceptés, aucune troncature ni règle artificielle de composition. Le frontend
  raccordé applique le même minimum de 15 caractères, sans règle de composition.
- Access JWT Ed25519 : 5 minutes, `iss`, `aud`, `sub`, `sid`, `jti`, `iat`, `nbf`,
  `exp`, `typ=at+jwt`, `kid`. Aucun email ou profil dans le JWT. Vérification avec
  algorithme, issuer, audience et type imposés. Les endpoints n’acceptent pas de
  JWT comme refresh token.
- Refresh opaque : 256 bits aléatoires, seul son SHA-256 en base. Expiration
  glissante de 7 jours, plafond absolu de session de 30 jours. Historique des
  tokens consommés conservé jusqu’à expiration de la famille pour détecter le rejeu.
- Jetons email à usage unique (vérification 24 h, récupération 30 min) : 256 bits
  aléatoires, seul le SHA-256 en base, consommation atomique dans la transaction
  métier ; rejeu, expiration et confusion de purpose refusés avec le même 401.
  `reset/confirm` paie le hachage Argon2id avant le contrôle du jeton afin que le
  timing d'un refus ne révèle pas son existence ; la réinitialisation révoque
  toutes les sessions du compte.
- Verrou PostgreSQL sur la session : consommation du token, insertion du suivant
  et audit atomiques. Rejeu : révocation de toute la famille persistée avant refus.
  Deux refresh simultanés provoquent une révocation stricte : coordonner les onglets
  et ne pas réessayer automatiquement un refresh dont la réponse a été perdue.
- Cookies production `__Host-`, Secure, HttpOnly, SameSite=Strict, Path=/, aucun
  Domain. Contrôle d’origine + cookie/header CSRF + présence Redis obligatoire.
- Limites Redis atomiques : 60 requêtes/minute/IP sur l’auth, 20 connexions/15 min/IP,
  5 connexions/15 min/adresse, 5 inscriptions/heure/IP. Les essais réussis comptent
  aussi ; les compteurs expirent automatiquement. Une panne Redis ferme l’accès.
- Audit : inscriptions, connexions acceptées/refusées, rotation, rejeu, déconnexion,
  quotas. Pas de mots de passe, tokens, emails ou IP en clair dans ces événements.
  Les refus de quota sont regroupés à un événement par compteur/fenêtre pour ne
  pas amplifier une attaque en écritures d’audit.
  Identité réseau pseudonymisée par HMAC avec un secret distinct de la clé JWT.
  Les erreurs internes retournées ne divulguent pas les DSN ou requêtes SQL.
- Les en-têtes IP transférés sont ignorés. Derrière un proxy, l’IP observée est
  celle du proxy : configurer des limites réseau à l’entrée, puis ajouter une
  politique explicite de proxies de confiance avant d’utiliser X-Forwarded-For.

## Vérification interservices et révocation

Les autres services récupèrent le JWKS depuis l’URL configurée et le mettent en
cache. Ils imposent EdDSA, issuer, audience, `typ`, expiration et `kid` ; aucune
URL provenant du token ne doit sélectionner la source de confiance. Un `kid`
inconnu nécessite un rafraîchissement borné du cache puis un refus s’il reste inconnu.
Seules les clés publiques sont partagées, jamais la clé privée.

**La signature hors ligne ne vérifie pas la révocation.** Sans autre contrôle,
un access token émis avant logout/rejeu reste vérifiable jusqu’à expiration
(5 minutes maximum). Pour une action sensible, consulter `/me` ou vérifier la
session auprès d’une autorité serveur. `/me` consulte le cache Redis puis
PostgreSQL ; PostgreSQL reste autoritaire même après perte du cache. Les entrées
`auth:revoked:<sid>` expirent après 15 minutes et ne constituent pas à elles
seules un registre durable. L’échec du cache n’annule jamais une révocation SQL.

Rotation de clé : fournir la nouvelle graine dans `AUTH_SIGNING_KEY_FILE` et les
anciennes clés **publiques** base64url dans `AUTH_PREVIOUS_PUBLIC_KEYS` (séparées
par espaces). Déployer les deux clés publiques avant de changer de signataire,
puis conserver l’ancienne au moins 5 minutes + durée de cache JWKS après la
dernière émission. Les clés de vérification configurées apparaissent au JWKS.

`go run ./cmd/auth keygen CHEMIN` crée une clé privée sans l’afficher et refuse
d’écraser un fichier. `go run ./cmd/auth public-key CHEMIN` affiche uniquement sa
clé publique base64url, utilisable pour préparer le chevauchement de rotation.

## Production et exploitation

Le mode par défaut exige HTTPS pour issuer/origine, PostgreSQL `sslmode=verify-full`
et Redis `rediss://`. Le serveur HTTP est à placer derrière un proxy TLS de
confiance ; le réseau doit en empêcher le contournement. Ne pas utiliser le
Compose local comme manifeste de production.

Séparer compte de migration et compte SQL runtime. Le runtime nécessite SELECT
sur users/credentials/sessions/refresh_tokens/candidate_workspaces, INSERT sur ces tables et audit_events,
UPDATE sur sessions/refresh_tokens/candidate_workspaces, USAGE sur la séquence audit_events. Il ne doit
pas être propriétaire du schéma ni pouvoir modifier/supprimer les audits. Redis
doit être privé, authentifié, avec ACL limitée au préfixe auth et aux commandes
utilisées (PING, GET/SET, EXISTS, INCR, PEXPIRE, EVAL/EVALSHA/SCRIPT LOAD).

Prévoir sauvegardes PostgreSQL testées, secrets injectés, synchronisation horaire,
supervision des refus/503/rejeux et rétention des audits. Purger les sessions
seulement après leur expiration absolue ; les refresh tokens sont supprimés par
cascade. Définir et appliquer une rétention adaptée pour les audits avant lancement.
Dimensionner au départ le processus Go à au moins 512 Mio, à mesurer en charge ;
PostgreSQL et Redis ont des besoins séparés. Redis local est limité à 128 Mio,
avec politique noeviction : saturation = refus, jamais effacement silencieux des
compteurs de sécurité. Aucune estimation mensuelle n’est acquise sans hébergeur,
trafic, sauvegardes et disponibilité choisis.

## MFA / passkeys et limites de cette livraison

Passkeys/WebAuthn/MFA ne sont **pas implémentés**. Pour ce premier espace candidat
sans rôle administrateur ni paiement, la tranche couvre une authentification par
mot de passe. Ajouter une bibliothèque WebAuthn reconnue, vérification RP ID/origin,
challenge à usage unique stocké dans Redis, enrôlement après réauthentification,
révocation et récupération avant activation. Les accès administrateurs futurs
devront exiger un second facteur ; ne pas les ouvrir avec cette seule tranche.

Vérification email et récupération du mot de passe sont livrées avec le transport
`log` (`AUTH_MAILER=log`, valeur par défaut) : le message est journalisé, aucun
email réel n’est envoyé. Restent à construire avant ouverture publique : un
transport SMTP réel et la supervision du mailer. Restent aussi : notifications
et MFA/passkeys (tranche B).

Les comptes créés ont `email_verified=false` jusqu'à confirmation par jeton ;
ne jamais traiter un email non vérifié comme vérifié ni l’utiliser pour rattacher
un compte tiers. L’inscription déclenche l’envoi de l’email de vérification ;
l’échec de livraison n’échoue jamais la requête : le lien reste visible dans le
journal de développement et une nouvelle demande émet un jeton frais.

## Tests

```sh
go test ./... -count=1
go vet ./...
go run golang.org/x/vuln/cmd/govulncheck@latest ./...
docker compose -f compose.yaml -f compose.test.yaml run --build --rm tests
```

La dernière commande teste PostgreSQL et Redis réels avec le détecteur de courses
Go. Les fixtures utilisent un schéma SQL aléatoire par scénario, supprimé après
test ; elles ne suppriment aucune base et ne font pas de FLUSHDB. Sans variables
TEST_DATABASE_URL / TEST_REDIS_URL, `go test` signale les intégrations comme ignorées.
Les tests couvrent crypto, confusion d’algorithme, claims invalides, CSRF/origines,
cookies, rejeu/descendants, refresh concurrent, logout, expiration et quotas atomiques.

Références : [stockage des mots de passe OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html),
[rotation des refresh tokens — RFC 9700](https://www.rfc-editor.org/rfc/rfc9700.html).
