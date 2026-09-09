# Cekarna Offers — Rust / axum

Service interne de collecte et déduplication des offres publiques. Il écoute par
défaut sur `127.0.0.1:8083`; le navigateur passe toujours par l'API NestJS.

## Sources et absence d'invention

`sources.toml` est la liste blanche. Une source absente ou désactivée n'est jamais
interrogée. La fixture `file` est réservée aux tests. France Travail est désactivé
par défaut : accepter ses conditions, l'activer, puis injecter
`OFFERS_FRANCE_TRAVAIL_CLIENT_ID` et `OFFERS_FRANCE_TRAVAIL_CLIENT_SECRET` hors
dépôt. Le connecteur `feed` accepte seulement les URL HTTPS écrites dans la liste
blanche, refuse les redirections et ne découvre aucun lien. La collecte est
limitée par `min_interval_seconds`.

Chaque réponse brute est conservée octet pour octet avec son SHA-256. Toute offre
normalisée référence ce document et un chemin JSON pour chaque valeur disponible.
Un champ absent reste vide. Une charge invalide reste conservée avec un code
d'erreur générique.

## Commandes

```sh
cp .env.example .env
cargo run -- migrate
cargo run -- collect --source france-travail
cargo run -- serve
```

Routes internes protégées par `OFFERS_INTERNAL_TOKEN` : `GET /v1/offers`,
`GET /v1/offers/{id}`, `GET /v1/sources`, `POST /v1/collect` et
`POST /v1/recommendations/shortlist`. Cette dernière route reçoit uniquement un
profil professionnel compact, examine au plus 500 offres et renvoie au plus six
candidates. Son cache de quinze minutes conserve seulement une empreinte et des
identifiants d'offres ; le CV brut et les coordonnées sont refusés. Les routes santé
`/health` et `/health/ready` sont publiques en boucle locale. La liste accepte
`q`, `location`, `contract`, `cursor`, `limit` et `duplicates=include`.

Une collecte complète et valide marque comme retirées les offres de la source qui
ne sont plus présentes. Une réponse invalide est conservée pour diagnostic sans
retirer les dernières offres valides. Les offres retirées restent en base pour
l'historique mais disparaissent de la liste active. Les doublons gardent tous
leurs membres ; l'offre canonique est la plus ancienne du groupe. La décision
`identifiant-source` ou `empreinte-normalisee` est conservée.

## Vérification

```sh
cargo fmt --check
cargo test
cargo clippy --all-targets -- -D warnings
```

Les tests n'effectuent aucun appel réseau et n'utilisent que des annonces
explicitement synthétiques. La configuration de production, les quotas et les
conditions de France Travail doivent être revérifiés avant activation réelle.
