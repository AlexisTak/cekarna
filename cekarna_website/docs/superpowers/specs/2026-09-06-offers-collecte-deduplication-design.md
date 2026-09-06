# Design — Collecte d'offres et déduplication (service Rust)

Date : 2026-09-06. Statut : approuvé en conversation.
Portée : nouveau service `cekarna_website/services/offers` (Rust), plus un module
de lecture mince dans l'API NestJS.
Couvre la première moitié de la tranche 4 de `docs/B2C.md`.

## Périmètre

Cette spec couvre **la collecte depuis des sources autorisées et la
déduplication**. Elle ne couvre pas la comparaison profil/offre évaluée sur
corpus, ni les brouillons de candidature : ce sont deux tranches distinctes, avec
leurs propres critères de recette et leurs propres specs.

Raison du découpage : sans offres réelles en base, ni la comparaison ni les
brouillons ne peuvent être évalués sérieusement. La collecte est le socle.

## Décisions prises avec le porteur

- **Rust assumé** malgré la réserve de `docs/PROJECT.md` (« Évaluer un besoin réel
  avant microservices Rust/Go »). Cette spec lève la réserve explicitement et en
  inscrit le coût ; `PROJECT.md` sera mis à jour à l'implémentation.
- **Quatre familles de sources autorisées** : API France Travail, flux publiés par
  les employeurs, agrégateurs commerciaux sous contrat, dépôt manuel de fichiers.
  Ordre de construction : `file` d'abord (aucune dépendance externe, rend tout le
  reste testable hors ligne), puis `france_travail`, `feed`, `aggregator`.
- **SQLite embarquée**, mode WAL, un seul écrivain. Pas de serveur de base
  supplémentaire à exploiter à ce stade. Une collecte prend un verrou nommé en
  base : lancer `offers collect` pendant qu'une collecte tourne déjà (CLI ou
  `POST /v1/collect`) échoue immédiatement avec un message explicite, au lieu de
  buter sur `SQLITE_BUSY`. `busy_timeout` est réglé pour les lectures.
- **API HTTP en boucle locale, consommée par NestJS uniquement.** NestJS reste la
  seule façade que le navigateur appelle. Le service Rust n'est jamais exposé au
  web et n'a aucune configuration CORS.
- **Déduplication déterministe à deux règles**, chaque regroupement traçable. Pas
  de similarité floue : elle appartient à la tranche « comparaison évaluée ».
- **Aucun planificateur interne** (YAGNI) : la collecte se déclenche par la CLI ou
  par un appel. La planification viendra si un besoin réel apparaît.
- **Crate unique à modules cloisonnés**, pas de workspace multi-crates : les
  frontières d'un workspace ne servent qu'avec plusieurs consommateurs du cœur.
  Passer au workspace plus tard est mécanique ; l'inverse ne l'est pas.

## Principe directeur : brut d'abord, normalisé ensuite

La charge renvoyée par une source est stockée **octet pour octet et jamais
modifiée**. La projection normalisée en est toujours dérivée, et chaque champ
normalisé enregistre le chemin de son origine dans la charge brute.

Deux bénéfices : rejouer la déduplication sans réinterroger la source, et prouver
qu'aucun contenu n'a été inventé. C'est le même invariant que `excerptOf()` dans
l'import de CV — une valeur ne peut pas exister sans son origine. Un champ que la
source ne fournit pas reste vide ; il n'est jamais comblé.

## Architecture

```
services/offers/
  Cargo.toml
  README.md
  sources.toml          # liste blanche des sources autorisées
  migrations/001_offers.sql
  src/
    main.rs             # démarrage : CLI ou serveur HTTP
    config.rs           # environnement + chargement/validation de la liste blanche
    sources/mod.rs      # trait Source + registre
    sources/file.rs
    sources/france_travail.rs
    sources/feed.rs
    sources/aggregator.rs
    normalize.rs        # charge brute -> offre normalisée + origines
    dedup.rs            # règles de regroupement
    store/mod.rs        # SQLite : migrations, requêtes
    http.rs             # API de lecture + déclenchement
  tests/
    fixtures/           # charges synthétiques, identifiées comme telles
```

Bibliothèques : `tokio` et `axum` (HTTP), `sqlx` en mode SQLite (requêtes
vérifiées à la compilation), `reqwest` (connecteurs distants), `serde`, `clap`
(CLI), `thiserror` et `anyhow` (erreurs).

## Modèle de données

Dates en texte ISO 8601 UTC, comme partout ailleurs dans le projet.

```sql
-- Ce que la source a répondu, octet pour octet. Jamais modifié.
CREATE TABLE raw_documents (
  id             TEXT PRIMARY KEY,
  source_id      TEXT NOT NULL,
  external_id    TEXT,
  fetched_at     TEXT NOT NULL,
  content_type   TEXT NOT NULL,
  payload        BLOB NOT NULL,
  payload_sha256 TEXT NOT NULL
);
CREATE INDEX raw_documents_source ON raw_documents(source_id, fetched_at);

-- Projection normalisée, toujours dérivée d'un raw_document.
CREATE TABLE offers (
  id              TEXT PRIMARY KEY,
  raw_document_id TEXT NOT NULL REFERENCES raw_documents(id),
  source_id       TEXT NOT NULL,
  external_id     TEXT,
  title           TEXT NOT NULL,
  company         TEXT NOT NULL,
  location        TEXT NOT NULL,
  contract        TEXT,
  url             TEXT,
  description     TEXT NOT NULL,
  published_at    TEXT,
  fingerprint     TEXT NOT NULL,
  group_id        TEXT NOT NULL,
  origins         TEXT NOT NULL,   -- JSON : champ -> chemin dans la charge brute
  first_seen_at   TEXT NOT NULL,
  last_seen_at    TEXT NOT NULL
);
CREATE UNIQUE INDEX offers_source_external
  ON offers(source_id, external_id) WHERE external_id IS NOT NULL;
CREATE INDEX offers_fingerprint ON offers(fingerprint);
CREATE INDEX offers_group ON offers(group_id);

-- Pourquoi telle offre a rejoint tel groupe. Auditable.
CREATE TABLE duplicate_decisions (
  offer_id   TEXT NOT NULL REFERENCES offers(id),
  group_id   TEXT NOT NULL,
  rule       TEXT NOT NULL,   -- 'identifiant-source' | 'empreinte-normalisee'
  compared   TEXT NOT NULL,   -- JSON : valeurs qui ont fondé la décision
  decided_at TEXT NOT NULL
);
CREATE INDEX duplicate_decisions_offer ON duplicate_decisions(offer_id);
```

Exemple de `origins` (valeurs synthétiques) :

```json
{ "title": "/resultats/3/intitule", "company": "/resultats/3/entreprise/nom" }
```

## Le contrat de source

```rust
#[async_trait]
trait Source {
    fn id(&self) -> &str;
    /// Récupère les documents bruts. Aucune source ne suit de lien ni n'explore :
    /// elle interroge exactement ce que sa configuration déclare.
    async fn fetch(&self, since: Option<&str>) -> Result<Vec<RawDocument>, SourceError>;
    /// Extrait les champs d'un document brut, avec le chemin d'origine de chacun.
    fn normalize(&self, raw: &RawDocument) -> Result<Vec<NormalizedOffer>, NormalizeError>;
}
```

### L'autorisation est une donnée, pas du code

Une source n'est interrogée que si elle figure dans `sources.toml`. Le registre
refuse de démarrer si une entrée est incomplète.

```toml
[[source]]
id       = "france-travail"
kind     = "france_travail"
terms    = "https://francetravail.io/data/api/offres-emploi"  # conditions acceptées
enabled  = true
min_interval_seconds = 900
```

Un connecteur dont le code existe mais qui n'est pas déclaré n'est jamais appelé.

Le connecteur `feed` ne récupère que les URL listées : il ne parcourt aucun lien,
ne découvre aucune page et ne contourne aucun `robots.txt`, parce qu'il ne se
déplace jamais. Les identifiants OAuth viennent de l'environnement et ne sont
jamais journalisés.

`min_interval_seconds` est respecté par source, par attente et non par abandon.

## Déduplication

**Règle 1 — `identifiant-source`.** Même `(source_id, external_id)` : la même
annonce est recollectée. On enregistre le nouveau document brut, on met à jour
`last_seen_at`, le groupe ne change pas. Si `payload_sha256` est identique au
dernier document de cette offre, on s'arrête là sans renormaliser.

**Règle 2 — `empreinte-normalisee`.** Pour la même annonce vue sur une autre
source :

```
fingerprint = sha256( norm(title) ⧺ "|" ⧺ norm(company) ⧺ "|" ⧺ norm(location) )
```

`norm()` : minuscules, diacritiques retirés, espaces réduits, ponctuation de
bordure retirée, plus deux retraits spécifiques au marché français, assumés comme
des choix de conception :

- mentions de mixité dans l'intitulé (`H/F`, `(F/H)`, `H-F`), qui séparent
  artificiellement des annonces identiques ;
- formes juridiques en fin de nom d'entreprise (`SAS`, `SARL`, `SA`, `SASU`).

Empreinte identique → l'offre rejoint le groupe existant. L'offre canonique d'un
groupe est celle dont `first_seen_at` est le plus ancien ; à égalité de date, le
plus petit `id` tranche, pour que le choix soit reproductible. **Les autres
membres ne sont jamais supprimés** : ils restent consultables.

Si une recollecte modifie les champs au point de changer l'empreinte, la règle 1
prime : l'empreinte est recalculée et stockée, mais le groupe ne bouge pas. Une
offre ne change jamais de groupe en cours de vie ; sinon l'historique des
décisions déjà écrites deviendrait faux.

Chaque regroupement écrit une ligne dans `duplicate_decisions`. On peut donc
toujours répondre à « pourquoi ces deux offres n'en font-elles qu'une ? ».

**Ce que ces règles ne font pas** : rapprocher deux annonces reformulées. C'est
délibéré. Un seuil de similarité produirait des regroupements injustifiables sans
corpus annoté pour le régler ; cette question appartient à la tranche
« comparaison évaluée ».

## Interface

### API HTTP — `127.0.0.1:8082` (8081 est déjà l'authentification)

| Méthode | Route | Comportement |
| --- | --- | --- |
| GET | `/health` | Disponibilité du processus. |
| GET | `/health/ready` | Vérifie SQLite. Même convention que le service Go. |
| GET | `/v1/offers` | Offres canoniques. Filtres `q`, `location`, `contract` ; pagination par curseur. `?duplicates=include` pour voir les membres non canoniques. |
| GET | `/v1/offers/{id}` | Une offre, ses `origins`, les membres de son groupe et les décisions qui les ont réunis. |
| GET | `/v1/sources` | Liste blanche déclarée : identifiant, type, conditions, état, dernière exécution. |
| POST | `/v1/collect` | Déclenche une collecte (corps optionnel `{source_id}`), renvoie le rapport d'exécution. |

Le service n'écoute que sur la boucle locale et **n'a aucune configuration
CORS** : aucun navigateur ne l'appelle. NestJS est son seul client et
s'authentifie par un secret partagé en en-tête.

### Côté NestJS

Module `src/offers/` mince, exposant au frontend `GET /v1/offers` et
`GET /v1/offers/:id`. `POST /v1/collect` **n'est pas proxifié** : la collecte est
une opération d'exploitation.

### CLI

`offers migrate`, `offers collect [--source X]`, `offers import --file <chemin>`,
`offers serve`.

## Erreurs : l'échec partiel est le cas normal

- **Une source en échec n'interrompt pas les autres.** Le rapport détaille par
  source : documents récupérés, offres nouvelles, mises à jour, regroupées,
  ignorées, et l'erreur le cas échéant. Code de sortie non nul seulement si
  *toutes* les sources ont échoué.
- **Un document non normalisable est conservé en brut avec la raison
  enregistrée** : jamais abandonné en silence, jamais complété au jugé. C'est le
  pendant du PDF sans couche texte, refusé plutôt que deviné.
- `thiserror` pour les erreurs typées par domaine, `anyhow` aux frontières. Aucun
  `unwrap()` sur le chemin des requêtes.

## Tests

- **Unitaires, tables de cas** : `norm()` (accents, `H/F`, formes juridiques),
  calcul d'empreinte, application des deux règles.
- **Intégration, SQLite temporaire** :
  - collecter deux fois la même source ne crée aucun doublon ;
  - la même annonce fournie par deux sources forme un seul groupe, avec deux
    membres et deux décisions tracées ;
  - un document illisible est conservé sans bloquer le reste de la collecte ;
  - une source absente de `sources.toml` n'est jamais interrogée.
- **HTTP** : client de test `axum`, sans serveur réel.
- **Aucun appel réseau en test.** Les connecteurs distants sont testés sur des
  charges enregistrées dans `tests/fixtures/`, **synthétiques et identifiées comme
  telles**. Aucune offre réelle ni donnée personnelle n'est versionnée.

Vérification : `cargo fmt --check && cargo clippy -- -D warnings && cargo test`,
documentés dans `services/offers/README.md` et ajoutés à la CI.

## Coût, à inscrire dans `PROJECT.md`

Rust devient le troisième langage du dépôt : une chaîne de build, un écosystème de
tests et une cible de déploiement de plus, plus le temps d'apprentissage pour
quiconque reprend le projet.

En échange : un binaire unique sans runtime, une empreinte mémoire faible pour un
collecteur destiné à tourner en continu, et des erreurs traitées à la compilation.
La décision revient au porteur du projet et est assumée ici ; `PROJECT.md` doit
cesser de la contredire.

## Hors périmètre

- Comparaison profil/offre et son harnais d'évaluation sur corpus annoté.
- Brouillons de candidature, leur correction et leur export.
- Similarité floue entre annonces reformulées.
- Planification automatique des collectes.
- Exposition du service au web ou appel direct depuis le navigateur.
