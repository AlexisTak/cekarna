# Cekarna Notifications — Rust

Microservice interne de notifications transactionnelles. Il garde une demande dans
PostgreSQL avant l'envoi : une indisponibilité SMTP ne fait donc pas perdre la
notification. Un worker livre les emails via SMTP avec STARTTLS, réessaie les
erreurs jusqu'à `NOTIFICATIONS_MAX_ATTEMPTS`, puis marque l'élément `failed`.

Le service est séparé de `services/auth/`. L'adaptateur Go existe : choisir
`AUTH_MAILER=notifications`, `NOTIFICATIONS_URL` et le même token interne.
Le Compose d'authentification conserve le transport de développement `log`.
Le raccord doit donc être configuré au déploiement ; aucun fournisseur réel
n'est activé par la présence de ce code.

## Démarrage local

```sh
cp .env.example .env
# renseigner les mots de passe, le token interne et le fournisseur SMTP
docker compose up --build
```

Le service écoute sur `127.0.0.1:8082`; PostgreSQL sur `127.0.0.1:55433`.
Utiliser des valeurs locales uniquement en développement. En production, injecter
les secrets depuis un gestionnaire dédié, utiliser PostgreSQL avec TLS et isoler
le port HTTP sur le réseau interne.

## Contrat interne

Toutes les routes sauf les contrôles de santé exigent `Authorization: Bearer
<NOTIFICATIONS_INTERNAL_TOKEN>`. Le token doit être unique par appelateur ou
remplacé par une authentification interservices (mTLS ou jeton signé) avant de
donner accès à plusieurs services.

`POST /v1/notifications/email` crée une demande durable :

```json
{
  "kind": "email_verification",
  "recipient": "candidate@example.com",
  "subject": "Vérifiez votre adresse",
  "text_body": "Votre lien de vérification : ..."
}
```

Il répond `200` avec l'identifiant et l’état courant. L’appelateur doit fournir
`Idempotency-Key`, une empreinte SHA-256 hexadécimale minuscule du message, pour
qu’une répétition de la même demande retourne la notification existante sans en
créer une seconde. `GET
/v1/notifications/{id}` expose le statut, le nombre de tentatives, l'heure de
livraison et le dernier message d'erreur. Cette route est prévue pour la
supervision applicative; elle ne doit jamais être rendue publique.

`GET /health/live` indique que le processus répond. `GET /health/ready` vérifie
PostgreSQL. Les journaux structurés indiquent une livraison, un nouvel essai ou
un échec final, sans écrire le destinataire ni le corps du message.

Un appel SMTP est borné à 30 secondes. Un envoi abandonné est repris après
cinq minutes ; la dernière tentative abandonnée devient `failed`. Le champ
`last_error` contient un code générique, jamais la réponse brute du fournisseur.
`delivered` signifie accepté par SMTP, pas réception confirmée en boîte email.
Une reprise après interruption peut envoyer un doublon si SMTP avait accepté
le message avant l'arrêt : l’idempotence évite les doublons de mise en file, pas
ce cas SMTP ambigu.

## Limites et prochaine tranche

Ce service ne gère que les notifications email transactionnelles. Il ne contient
ni MFA, ni passkeys/WebAuthn, ni abonnement/paiement, ni IA ou automatisations.
Ces sujets doivent suivre la validation du parcours principal : pour MFA/passkeys,
étendre le service d'authentification avec WebAuthn et des challenges Redis à usage
unique; pour un abonnement, créer un domaine de facturation isolé; pour l'IA,
obtenir une validation produit et des garde-fous de consentement avant automatiser
quoi que ce soit.

## Vérification

```sh
cargo fmt --check
cargo test
cargo clippy --all-targets -- -D warnings
```
