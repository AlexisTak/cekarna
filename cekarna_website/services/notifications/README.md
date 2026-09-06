# Cekarna Notifications — Rust

Microservice interne de notifications transactionnelles. Il garde une demande dans
PostgreSQL avant l'envoi : une indisponibilité SMTP ne fait donc pas perdre la
notification. Un worker livre les emails via SMTP avec STARTTLS, réessaie les
erreurs jusqu'à `NOTIFICATIONS_MAX_ATTEMPTS`, puis marque l'élément `failed`.

Le service est volontairement séparé de `services/auth/`. L'authentification
continue d'émettre directement ses emails tant qu'un appelateur interne n'a pas
été ajouté et validé. Le contrat ci-dessous est celui à utiliser pour ce raccord.

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

Il répond `200` avec l'identifiant et `pending`. `GET
/v1/notifications/{id}` expose le statut, le nombre de tentatives, l'heure de
livraison et le dernier message d'erreur. Cette route est prévue pour la
supervision applicative; elle ne doit jamais être rendue publique.

`GET /health/live` indique que le processus répond. `GET /health/ready` vérifie
PostgreSQL. Les journaux structurés indiquent une livraison, un nouvel essai ou
un échec final, sans écrire le destinataire ni le corps du message.

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
