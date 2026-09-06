# Collecte d'offres et déduplication — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Livrer un service Rust `services/offers` qui collecte des offres depuis des sources explicitement autorisées, les déduplique de façon déterministe et traçable, et les expose en lecture à l'API NestJS.

**Architecture:** Un binaire unique à modules cloisonnés. La charge brute de chaque source est stockée telle quelle ; la projection normalisée en dérive et cite l'origine de chaque champ. La déduplication applique deux règles déterministes et écrit sa décision. SQLite embarquée, API HTTP en boucle locale dont NestJS est le seul client.

**Tech Stack:** Rust édition 2024, `tokio`, `axum` 0.8, `sqlx` 0.8 (SQLite), `serde`, `toml`, `thiserror`, `tracing`, `time`, `uuid` v7, `reqwest`, `clap`, `sha2`, `unicode-normalization`, `async-trait`.

**Spec:** `docs/superpowers/specs/2026-09-06-offers-collecte-deduplication-design.md`

## Global Constraints

- Paquet `cekarna-offers`, `edition = "2024"`, `rust-version = "1.85"` — identiques à `services/notifications`.
- Adresse par défaut `127.0.0.1:8083`. **8081 est pris par `services/auth`, 8082 par `services/notifications`.**
- Préfixe des variables d'environnement : `OFFERS_`.
- Authentification interne : en-tête `Authorization: Bearer <OFFERS_INTERNAL_TOKEN>`, jeton d'au moins 32 caractères, comparaison à temps constant, routes `/health/` exemptées — même règle que `services/notifications`.
- SQLite en mode WAL, `busy_timeout` réglé, `foreign_keys = ON`.
- API `sqlx` **d'exécution** (`sqlx::query`, `query_as`, `query_scalar`), jamais les macros à la compilation — `services/notifications` fait déjà ce choix, qui évite d'exiger une base au moment du build.
- Dates en texte ISO 8601 UTC. Identifiants en UUID v7.
- **Aucun appel réseau dans les tests.** Les connecteurs distants sont testés sur des charges enregistrées.
- **Aucune donnée réelle versionnée** : les fixtures sont synthétiques et nommées comme telles.
- Ne jamais journaliser d'identifiant, de jeton ni de contenu d'offre nominatif.
- Une source absente de `sources.toml` n'est jamais interrogée, même si son connecteur existe.
- Vérification, à faire passer avant chaque commit :
  `cargo fmt --check && cargo test && cargo clippy --all-targets -- -D warnings`

## Écarts assumés par rapport à la spec

Quatre points où ce plan corrige ou précise la spec. Chacun est justifié ; aucun ne change le comportement attendu.

1. **Port 8083 et non 8082.** La spec proposait 8082, déjà occupé par `services/notifications` (`NOTIFICATIONS_ADDR=127.0.0.1:8082`).
2. **Pas de `compose.yaml`.** La spec en prévoyait un « de même forme que `services/notifications` », mais celui-ci n'existe que pour lancer PostgreSQL. SQLite n'a aucun conteneur compagnon : un `compose.yaml` ne lancerait que le service lui-même, ce que `cargo run` fait déjà. Le `Dockerfile` est conservé.
3. **Ajout de `src/collect.rs`.** La spec ne donnait pas de foyer au pipeline de collecte. Le mettre dans `dedup.rs` ou `main.rs` mélangerait deux responsabilités.
4. **Connecteur `aggregator` reporté.** Il exige un contrat commercial et des identifiants dont nous ne disposons pas ; il ne peut être ni écrit ni testé honnêtement aujourd'hui. Les trois autres connecteurs sont livrés. Reprendre ce point quand un contrat existe.

## Structure des fichiers

| Fichier | Responsabilité |
| --- | --- |
| `services/offers/Cargo.toml` | Dépendances, métadonnées du paquet. |
| `services/offers/.env.example` | Variables documentées, sans secret. |
| `services/offers/.gitignore` | `/target`, `.env`, fichiers de base. |
| `services/offers/Dockerfile` | Image de production. |
| `services/offers/sources.toml` | Liste blanche des sources autorisées. |
| `services/offers/migrations/001_offers.sql` | Schéma initial. |
| `services/offers/src/main.rs` | Point d'entrée : analyse la CLI, lance serveur ou commande. |
| `services/offers/src/config.rs` | Lecture et validation de l'environnement. |
| `services/offers/src/store/mod.rs` | Connexion SQLite, migrations, requêtes. |
| `services/offers/src/normalize.rs` | `norm*()` et `fingerprint()`. Fonctions pures. |
| `services/offers/src/sources/mod.rs` | Trait `Source`, types partagés, registre de la liste blanche. |
| `services/offers/src/sources/file.rs` | Connecteur « dépôt manuel de fichiers ». |
| `services/offers/src/sources/france_travail.rs` | Connecteur API France Travail. |
| `services/offers/src/sources/feed.rs` | Connecteur flux employeurs. |
| `services/offers/src/dedup.rs` | Les deux règles de regroupement. |
| `services/offers/src/collect.rs` | Pipeline : récupérer, stocker le brut, normaliser, dédupliquer, rapporter. |
| `services/offers/src/http.rs` | Routes HTTP et garde d'authentification interne. |
| `services/offers/tests/` | Tests d'intégration et fixtures synthétiques. |
| `cekarna_website/src/offers/` | Module NestJS de lecture. |

---

### Task 1: Squelette du crate, configuration, `/health`

**Files:**
- Create: `services/offers/Cargo.toml`
- Create: `services/offers/.gitignore`
- Create: `services/offers/.env.example`
- Create: `services/offers/src/config.rs`
- Create: `services/offers/src/main.rs`

**Interfaces:**
- Consumes: rien.
- Produces: `config::Config { addr: SocketAddr, database_path: String, internal_token: String, sources_path: String }`, `Config::from_env() -> Result<Config, ConfigError>`, `Config::from_source(impl Fn(&'static str) -> Option<String>) -> Result<Config, ConfigError>`, `ConfigError::{Missing(&'static str), Invalid { name, reason }}`.

- [ ] **Step 1: Créer le manifeste et les fichiers d'accompagnement**

`services/offers/Cargo.toml` :

```toml
[package]
name = "cekarna-offers"
version = "0.1.0"
edition = "2024"
rust-version = "1.85"

[lib]
name = "cekarna_offers"
path = "src/lib.rs"

[[bin]]
name = "offers"
path = "src/main.rs"

[dependencies]
async-trait = "0.1"
axum = { version = "0.8", features = ["json"] }
clap = { version = "4", features = ["derive"] }
dotenvy = "0.15"
reqwest = { version = "0.12", default-features = false, features = ["json", "rustls-tls"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
sha2 = "0.10"
sqlx = { version = "0.8", default-features = false, features = ["macros", "migrate", "runtime-tokio-rustls", "sqlite", "time", "uuid"] }
thiserror = "2"
time = { version = "0.3", features = ["formatting", "parsing", "serde"] }
tokio = { version = "1", features = ["macros", "net", "rt-multi-thread", "signal", "time"] }
toml = "0.8"
tower-http = { version = "0.6", features = ["trace"] }
tracing = "0.1"
tracing-subscriber = { version = "0.3", features = ["env-filter"] }
unicode-normalization = "0.1"
uuid = { version = "1", features = ["serde", "v7"] }

[dev-dependencies]
tempfile = "3"
```

`services/offers/.gitignore` :

```
/target
.env
*.db
*.db-shm
*.db-wal
```

`services/offers/.env.example` :

```sh
# Copier vers .env. Ne jamais mettre de secret réel dans ce fichier exemple.
OFFERS_INTERNAL_TOKEN=replace-with-a-random-32-byte-secret

# Réglages optionnels.
OFFERS_ADDR=127.0.0.1:8083
OFFERS_DATABASE_PATH=offers.db
OFFERS_SOURCES_PATH=sources.toml
RUST_LOG=info
```

- [ ] **Step 2: Écrire les tests de configuration qui échouent**

Dans `services/offers/src/config.rs`, à la fin du fichier :

```rust
#[cfg(test)]
mod tests {
    use super::*;

    const JETON: &str = "0123456789abcdef0123456789abcdef";

    fn lecteur(paires: Vec<(&'static str, &'static str)>) -> impl Fn(&'static str) -> Option<String> {
        move |cle| {
            paires
                .iter()
                .find(|(nom, _)| *nom == cle)
                .map(|(_, valeur)| (*valeur).to_string())
        }
    }

    #[test]
    fn refuse_un_jeton_absent() {
        let erreur = Config::from_source(lecteur(vec![])).unwrap_err();
        assert!(matches!(erreur, ConfigError::Missing("OFFERS_INTERNAL_TOKEN")));
    }

    #[test]
    fn refuse_un_jeton_trop_court() {
        let erreur =
            Config::from_source(lecteur(vec![("OFFERS_INTERNAL_TOKEN", "trop-court")])).unwrap_err();
        assert!(matches!(
            erreur,
            ConfigError::Invalid { name: "OFFERS_INTERNAL_TOKEN", .. }
        ));
    }

    #[test]
    fn refuse_une_adresse_illisible() {
        let erreur = Config::from_source(lecteur(vec![
            ("OFFERS_INTERNAL_TOKEN", JETON),
            ("OFFERS_ADDR", "pas-une-adresse"),
        ]))
        .unwrap_err();
        assert!(matches!(erreur, ConfigError::Invalid { name: "OFFERS_ADDR", .. }));
    }

    #[test]
    fn applique_les_valeurs_par_defaut() {
        let config = Config::from_source(lecteur(vec![("OFFERS_INTERNAL_TOKEN", JETON)])).unwrap();
        assert_eq!(config.addr.to_string(), "127.0.0.1:8083");
        assert_eq!(config.database_path, "offers.db");
        assert_eq!(config.sources_path, "sources.toml");
    }
}
```

Note de conception : `from_source` prend un lecteur en paramètre au lieu de toucher `std::env`. Les tests Rust s'exécutent en parallèle dans le même processus ; muter l'environnement les rendrait dépendants les uns des autres.

- [ ] **Step 3: Lancer les tests pour vérifier qu'ils échouent**

Run: `cd services/offers && cargo test config`
Expected: FAIL — `cannot find type Config in this scope`.

- [ ] **Step 4: Écrire la configuration minimale**

Au début de `services/offers/src/config.rs` :

```rust
use std::{env, net::SocketAddr};

use thiserror::Error;

#[derive(Debug, Clone)]
pub struct Config {
    pub addr: SocketAddr,
    pub database_path: String,
    pub internal_token: String,
    pub sources_path: String,
}

#[derive(Debug, Error)]
pub enum ConfigError {
    #[error("variable d'environnement obligatoire absente : {0}")]
    Missing(&'static str),
    #[error("{name} invalide : {reason}")]
    Invalid { name: &'static str, reason: String },
}

impl Config {
    pub fn from_env() -> Result<Self, ConfigError> {
        Self::from_source(|cle| env::var(cle).ok())
    }

    pub fn from_source(read: impl Fn(&'static str) -> Option<String>) -> Result<Self, ConfigError> {
        let addr = read("OFFERS_ADDR")
            .unwrap_or_else(|| "127.0.0.1:8083".into())
            .parse()
            .map_err(|erreur| ConfigError::Invalid {
                name: "OFFERS_ADDR",
                reason: format!("{erreur}"),
            })?;
        let internal_token =
            read("OFFERS_INTERNAL_TOKEN").ok_or(ConfigError::Missing("OFFERS_INTERNAL_TOKEN"))?;
        if internal_token.len() < 32 {
            return Err(ConfigError::Invalid {
                name: "OFFERS_INTERNAL_TOKEN",
                reason: "doit faire au moins 32 caractères".into(),
            });
        }
        Ok(Self {
            addr,
            database_path: read("OFFERS_DATABASE_PATH").unwrap_or_else(|| "offers.db".into()),
            internal_token,
            sources_path: read("OFFERS_SOURCES_PATH").unwrap_or_else(|| "sources.toml".into()),
        })
    }
}
```

Créer aussi `services/offers/src/lib.rs` :

```rust
pub mod config;
```

- [ ] **Step 5: Écrire le point d'entrée avec `/health`**

`services/offers/src/main.rs` :

```rust
use axum::{Json, Router, routing::get, serve};
use cekarna_offers::config::Config;
use serde_json::json;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    dotenvy::dotenv().ok();
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    let config = Config::from_env()?;
    let app = Router::new().route("/health", get(|| async { Json(json!({ "status": "ok" })) }));
    let listener = tokio::net::TcpListener::bind(config.addr).await?;
    tracing::info!(addr = %config.addr, "service offres à l'écoute");
    serve(listener, app).await?;
    Ok(())
}
```

- [ ] **Step 6: Lancer les tests et la vérification complète**

Run: `cd services/offers && cargo test && cargo fmt --check && cargo clippy --all-targets -- -D warnings`
Expected: PASS, aucun avertissement.

- [ ] **Step 7: Vérifier le démarrage à la main**

Run:
```bash
cd services/offers
OFFERS_INTERNAL_TOKEN=0123456789abcdef0123456789abcdef cargo run &
curl -s http://127.0.0.1:8083/health
```
Expected: `{"status":"ok"}`. Arrêter le processus ensuite.

- [ ] **Step 8: Commit**

```bash
git add services/offers/Cargo.toml services/offers/Cargo.lock services/offers/.gitignore services/offers/.env.example services/offers/src
git commit -m "feat(offers): squelette du service, configuration validée et sonde de vie"
```

---

### Task 2: Base SQLite, migrations, `/health/ready`

**Files:**
- Create: `services/offers/migrations/001_offers.sql`
- Create: `services/offers/src/store/mod.rs`
- Create: `services/offers/tests/store.rs`
- Modify: `services/offers/src/lib.rs`
- Modify: `services/offers/src/main.rs`

**Interfaces:**
- Consumes: `cekarna_offers::config::Config`.
- Produces: `store::connect(path: &str) -> Result<SqlitePool, StoreError>`, `store::migrate(pool: &SqlitePool) -> Result<(), StoreError>`, `store::ping(pool: &SqlitePool) -> Result<(), StoreError>`, `store::StoreError`.

- [ ] **Step 1: Écrire la migration**

`services/offers/migrations/001_offers.sql` :

```sql
CREATE TABLE raw_documents (
    id             TEXT PRIMARY KEY,
    source_id      TEXT NOT NULL,
    external_id    TEXT,
    fetched_at     TEXT NOT NULL,
    content_type   TEXT NOT NULL,
    payload        BLOB NOT NULL,
    payload_sha256 TEXT NOT NULL
);
CREATE INDEX raw_documents_source ON raw_documents (source_id, fetched_at);

CREATE TABLE offers (
    id              TEXT PRIMARY KEY,
    raw_document_id TEXT NOT NULL REFERENCES raw_documents (id),
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
    origins         TEXT NOT NULL,
    first_seen_at   TEXT NOT NULL,
    last_seen_at    TEXT NOT NULL
);
CREATE UNIQUE INDEX offers_source_external
    ON offers (source_id, external_id) WHERE external_id IS NOT NULL;
CREATE INDEX offers_fingerprint ON offers (fingerprint);
CREATE INDEX offers_group ON offers (group_id);

CREATE TABLE duplicate_decisions (
    offer_id   TEXT NOT NULL REFERENCES offers (id),
    group_id   TEXT NOT NULL,
    rule       TEXT NOT NULL,
    compared   TEXT NOT NULL,
    decided_at TEXT NOT NULL
);
CREATE INDEX duplicate_decisions_offer ON duplicate_decisions (offer_id);

-- Documents qu'aucun connecteur n'a su normaliser. Conservés avec leur raison,
-- jamais abandonnés en silence.
CREATE TABLE normalization_failures (
    raw_document_id TEXT PRIMARY KEY REFERENCES raw_documents (id),
    reason          TEXT NOT NULL,
    failed_at       TEXT NOT NULL
);

-- Verrou de collecte : une seule collecte à la fois, quel que soit le déclencheur.
CREATE TABLE collection_lock (
    id          INTEGER PRIMARY KEY CHECK (id = 1),
    holder      TEXT NOT NULL,
    acquired_at TEXT NOT NULL
);
```

- [ ] **Step 2: Écrire le test d'intégration qui échoue**

`services/offers/tests/store.rs` :

```rust
use cekarna_offers::store;

#[tokio::test]
async fn applique_les_migrations_sur_une_base_neuve() {
    let dossier = tempfile::tempdir().unwrap();
    let chemin = dossier.path().join("test.db");
    let pool = store::connect(chemin.to_str().unwrap()).await.unwrap();
    store::migrate(&pool).await.unwrap();

    let tables: Vec<(String,)> =
        sqlx::query_as("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
            .fetch_all(&pool)
            .await
            .unwrap();
    let noms: Vec<String> = tables.into_iter().map(|(nom,)| nom).collect();
    for attendue in ["offers", "raw_documents", "duplicate_decisions", "collection_lock"] {
        assert!(noms.contains(&attendue.to_string()), "table absente : {attendue}");
    }
}

#[tokio::test]
async fn la_sonde_repond_apres_migration() {
    let dossier = tempfile::tempdir().unwrap();
    let chemin = dossier.path().join("test.db");
    let pool = store::connect(chemin.to_str().unwrap()).await.unwrap();
    store::migrate(&pool).await.unwrap();
    store::ping(&pool).await.unwrap();
}
```

Ajouter `sqlx` et `tokio` aux `[dev-dependencies]` si `cargo test` s'en plaint :

```toml
[dev-dependencies]
tempfile = "3"
```

`sqlx` et `tokio` sont déjà des dépendances normales, donc utilisables dans `tests/`.

- [ ] **Step 3: Lancer le test pour vérifier qu'il échoue**

Run: `cd services/offers && cargo test --test store`
Expected: FAIL — `unresolved import cekarna_offers::store`.

- [ ] **Step 4: Écrire le module de stockage**

`services/offers/src/store/mod.rs` :

```rust
use sqlx::{SqlitePool, sqlite::SqlitePoolOptions};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum StoreError {
    #[error("base de données : {0}")]
    Database(#[from] sqlx::Error),
    #[error("migration : {0}")]
    Migrate(#[from] sqlx::migrate::MigrateError),
}

/// Ouvre la base et applique les réglages SQLite attendus par le service.
pub async fn connect(path: &str) -> Result<SqlitePool, StoreError> {
    let pool = SqlitePoolOptions::new()
        .max_connections(4)
        .connect(&format!("sqlite://{path}?mode=rwc"))
        .await?;
    for pragma in [
        "PRAGMA journal_mode = WAL",
        "PRAGMA busy_timeout = 5000",
        "PRAGMA foreign_keys = ON",
    ] {
        sqlx::query(pragma).execute(&pool).await?;
    }
    Ok(pool)
}

pub async fn migrate(pool: &SqlitePool) -> Result<(), StoreError> {
    sqlx::migrate!("./migrations").run(pool).await?;
    Ok(())
}

pub async fn ping(pool: &SqlitePool) -> Result<(), StoreError> {
    sqlx::query_scalar::<_, i32>("SELECT 1").fetch_one(pool).await?;
    Ok(())
}
```

Ajouter `pub mod store;` dans `src/lib.rs`.

- [ ] **Step 5: Lancer le test pour vérifier qu'il passe**

Run: `cd services/offers && cargo test --test store`
Expected: PASS, 2 tests.

- [ ] **Step 6: Brancher `/health/ready`**

Remplacer `services/offers/src/main.rs` :

```rust
use std::sync::Arc;

use axum::{
    Json, Router, extract::State, http::StatusCode, response::IntoResponse, routing::get, serve,
};
use cekarna_offers::{config::Config, store};
use serde_json::json;
use sqlx::SqlitePool;

#[derive(Clone)]
struct AppState {
    pool: Arc<SqlitePool>,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    dotenvy::dotenv().ok();
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    let config = Config::from_env()?;
    let pool = store::connect(&config.database_path).await?;
    store::migrate(&pool).await?;
    let state = AppState { pool: Arc::new(pool) };

    let app = Router::new()
        .route("/health", get(|| async { Json(json!({ "status": "ok" })) }))
        .route("/health/ready", get(ready))
        .with_state(state);

    let listener = tokio::net::TcpListener::bind(config.addr).await?;
    tracing::info!(addr = %config.addr, "service offres à l'écoute");
    serve(listener, app).await?;
    Ok(())
}

async fn ready(State(state): State<AppState>) -> impl IntoResponse {
    match store::ping(&state.pool).await {
        Ok(()) => (StatusCode::OK, Json(json!({ "status": "ready" }))),
        Err(erreur) => {
            tracing::error!(error = %erreur, "base indisponible");
            (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(json!({ "status": "unavailable" })),
            )
        }
    }
}
```

- [ ] **Step 7: Vérification complète**

Run: `cd services/offers && cargo test && cargo fmt --check && cargo clippy --all-targets -- -D warnings`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add services/offers/migrations services/offers/src services/offers/tests services/offers/Cargo.toml services/offers/Cargo.lock
git commit -m "feat(offers): schéma SQLite, migrations et sonde de disponibilité"
```

---

### Task 3: Normalisation et empreinte

**Files:**
- Create: `services/offers/src/normalize.rs`
- Modify: `services/offers/src/lib.rs`

**Interfaces:**
- Consumes: rien.
- Produces: `normalize::norm(&str) -> String`, `normalize::norm_title(&str) -> String`, `normalize::norm_company(&str) -> String`, `normalize::fingerprint(title: &str, company: &str, location: &str) -> String`.

- [ ] **Step 1: Écrire les tests qui échouent**

`services/offers/src/normalize.rs`, à la fin :

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn retire_accents_et_casse() {
        assert_eq!(norm("Développeuse   WEB "), "developpeuse web");
    }

    #[test]
    fn ignore_les_mentions_de_mixite() {
        assert_eq!(norm_title("Développeur Web (H/F)"), norm_title("developpeur web"));
        assert_eq!(norm_title("Chef de projet F/H"), norm_title("chef de projet"));
        assert_eq!(norm_title("Analyste H-F"), norm_title("analyste"));
    }

    #[test]
    fn ne_retire_pas_une_sequence_qui_ressemble_a_une_mention() {
        assert_eq!(norm_title("Technicien H2S"), "technicien h2s");
    }

    #[test]
    fn ignore_la_forme_juridique_en_fin_de_nom() {
        assert_eq!(norm_company("Studio Exemple SAS"), "studio exemple");
        assert_eq!(norm_company("Exemple SARL"), "exemple");
    }

    #[test]
    fn conserve_une_forme_juridique_au_debut_du_nom() {
        assert_eq!(norm_company("SAS Exemple Conseil"), "sas exemple conseil");
    }

    #[test]
    fn deux_annonces_identiques_ont_la_meme_empreinte() {
        let gauche = fingerprint("Développeur Web (H/F)", "Studio Exemple SAS", "Paris");
        let droite = fingerprint("developpeur web", "studio exemple", "paris");
        assert_eq!(gauche, droite);
    }

    #[test]
    fn un_changement_de_ville_change_l_empreinte() {
        let gauche = fingerprint("Développeur Web", "Studio Exemple", "Paris");
        let droite = fingerprint("Développeur Web", "Studio Exemple", "Lyon");
        assert_ne!(gauche, droite);
    }

    #[test]
    fn l_empreinte_est_un_sha256_hexadecimal() {
        let valeur = fingerprint("a", "b", "c");
        assert_eq!(valeur.len(), 64);
        assert!(valeur.chars().all(|caractere| caractere.is_ascii_hexdigit()));
    }
}
```

- [ ] **Step 2: Lancer les tests pour vérifier qu'ils échouent**

Run: `cd services/offers && cargo test normalize`
Expected: FAIL — `cannot find function norm in this scope`.

- [ ] **Step 3: Écrire la normalisation**

Au début de `services/offers/src/normalize.rs` :

```rust
use sha2::{Digest, Sha256};
use unicode_normalization::UnicodeNormalization;

/// Formes juridiques retirées en fin de raison sociale. Choix de conception
/// assumé : « Studio Exemple » et « Studio Exemple SAS » désignent la même
/// entreprise dans une annonce.
const FORMES_JURIDIQUES: [&str; 4] = ["sas", "sasu", "sarl", "sa"];

/// Mentions de mixité retirées des intitulés. Elles séparent artificiellement
/// des annonces identiques.
const MENTIONS_MIXITE: [&str; 8] = [
    "(h/f)", "(f/h)", "(h-f)", "(f-h)", " h/f", " f/h", " h-f", " f-h",
];

fn est_diacritique(caractere: char) -> bool {
    ('\u{0300}'..='\u{036f}').contains(&caractere)
}

fn reduire_espaces(valeur: &str) -> String {
    valeur.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn rogner(valeur: &str) -> String {
    valeur
        .trim_matches(|caractere: char| !caractere.is_alphanumeric())
        .to_string()
}

/// Minuscules, diacritiques retirés, espaces réduits. La ponctuation est
/// conservée : `norm_title` en a besoin pour reconnaître « (h/f) ».
fn plier(valeur: &str) -> String {
    let sans_accents: String = valeur
        .to_lowercase()
        .nfd()
        .filter(|caractere| !est_diacritique(*caractere))
        .collect();
    reduire_espaces(&sans_accents)
}

/// Réduit une valeur à sa forme comparable. Ne modifie jamais la valeur stockée :
/// seule la clé de comparaison est normalisée.
pub fn norm(valeur: &str) -> String {
    rogner(&plier(valeur))
}

pub fn norm_title(titre: &str) -> String {
    // Retirer les mentions AVANT de rogner : rogner supprimerait la parenthèse
    // fermante de « (h/f) », et le motif ne correspondrait plus.
    let mut base = plier(titre);
    for mention in MENTIONS_MIXITE {
        base = base.replace(mention, " ");
    }
    rogner(&reduire_espaces(&base))
}

pub fn norm_company(entreprise: &str) -> String {
    let base = norm(entreprise);
    let mut mots: Vec<&str> = base.split(' ').filter(|mot| !mot.is_empty()).collect();
    // Uniquement en fin de nom : « SAS Exemple Conseil » garde son premier mot.
    while mots.len() > 1 && FORMES_JURIDIQUES.contains(mots.last().unwrap()) {
        mots.pop();
    }
    mots.join(" ")
}

/// Empreinte de regroupement. Deux annonces de même intitulé, même entreprise
/// et même lieu la partagent, quelle que soit la source qui les a publiées.
pub fn fingerprint(titre: &str, entreprise: &str, lieu: &str) -> String {
    let assemble = format!(
        "{}|{}|{}",
        norm_title(titre),
        norm_company(entreprise),
        norm(lieu)
    );
    Sha256::digest(assemble.as_bytes())
        .iter()
        .map(|octet| format!("{octet:02x}"))
        .collect()
}
```

Ajouter `pub mod normalize;` dans `src/lib.rs`.

- [ ] **Step 4: Lancer les tests pour vérifier qu'ils passent**

Run: `cd services/offers && cargo test normalize`
Expected: PASS, 8 tests.

- [ ] **Step 5: Vérification complète**

Run: `cd services/offers && cargo test && cargo fmt --check && cargo clippy --all-targets -- -D warnings`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add services/offers/src/normalize.rs services/offers/src/lib.rs
git commit -m "feat(offers): normalisation des champs et calcul d'empreinte"
```

---

### Task 4: Trait `Source`, types partagés et registre de la liste blanche

**Files:**
- Create: `services/offers/src/sources/mod.rs`
- Create: `services/offers/sources.toml`
- Modify: `services/offers/src/lib.rs`

**Interfaces:**
- Consumes: rien.
- Produces: `sources::{SourceKind, SourceEntry, RawDocument, NormalizedOffer, Source, SourceError, NormalizeError, Registry, RegistryError}`.
  - `RawDocument::new(source_id: &str, external_id: Option<String>, content_type: &str, payload: Vec<u8>) -> RawDocument`
  - `Registry::from_toml(contenu: &str) -> Result<Registry, RegistryError>`
  - `Registry::load(path: &Path) -> Result<Registry, RegistryError>`
  - `Registry::get(&self, id: &str) -> Option<&SourceEntry>`
  - `Registry::enabled(&self) -> Vec<&SourceEntry>`

- [ ] **Step 1: Écrire les tests qui échouent**

À la fin de `services/offers/src/sources/mod.rs` :

```rust
#[cfg(test)]
mod tests {
    use super::*;

    const VALIDE: &str = r#"
[[source]]
id = "depot-manuel"
kind = "file"
terms = "https://exemple.test/conditions"
enabled = true
min_interval_seconds = 1
"#;

    #[test]
    fn charge_une_entree_valide() {
        let registre = Registry::from_toml(VALIDE).unwrap();
        let entree = registre.get("depot-manuel").unwrap();
        assert_eq!(entree.kind, SourceKind::File);
        assert_eq!(registre.enabled().len(), 1);
    }

    #[test]
    fn une_source_non_declaree_est_introuvable() {
        let registre = Registry::from_toml(VALIDE).unwrap();
        assert!(registre.get("france-travail").is_none());
    }

    #[test]
    fn refuse_une_entree_sans_conditions() {
        let contenu = VALIDE.replace(
            "terms = \"https://exemple.test/conditions\"",
            "terms = \"   \"",
        );
        let erreur = Registry::from_toml(&contenu).unwrap_err();
        assert!(matches!(erreur, RegistryError::Entry { .. }));
    }

    #[test]
    fn refuse_un_identifiant_duplique() {
        let contenu = format!("{VALIDE}{VALIDE}");
        let erreur = Registry::from_toml(&contenu).unwrap_err();
        assert!(matches!(erreur, RegistryError::Duplicate(_)));
    }

    #[test]
    fn refuse_un_identifiant_hors_convention() {
        let contenu = VALIDE.replace("depot-manuel", "Depot Manuel");
        let erreur = Registry::from_toml(&contenu).unwrap_err();
        assert!(matches!(erreur, RegistryError::Entry { .. }));
    }

    #[test]
    fn une_source_desactivee_n_est_pas_collectee() {
        let contenu = VALIDE.replace("enabled = true", "enabled = false");
        let registre = Registry::from_toml(&contenu).unwrap();
        assert!(registre.get("depot-manuel").is_some());
        assert!(registre.enabled().is_empty());
    }

    #[test]
    fn le_document_brut_porte_son_empreinte() {
        let document = RawDocument::new("depot-manuel", None, "application/json", b"[]".to_vec());
        assert_eq!(document.payload_sha256.len(), 64);
        assert_eq!(document.source_id, "depot-manuel");
    }
}
```

- [ ] **Step 2: Lancer les tests pour vérifier qu'ils échouent**

Run: `cd services/offers && cargo test sources`
Expected: FAIL — `cannot find type Registry in this scope`.

- [ ] **Step 3: Écrire les types et le registre**

Au début de `services/offers/src/sources/mod.rs` :

```rust
use std::{collections::BTreeMap, path::Path};

use async_trait::async_trait;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use thiserror::Error;
use time::OffsetDateTime;
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SourceKind {
    File,
    FranceTravail,
    Feed,
}

/// Une entrée de la liste blanche. Une source absente de ce fichier n'est
/// jamais interrogée, même si son connecteur existe dans le code.
#[derive(Debug, Clone, Deserialize)]
pub struct SourceEntry {
    pub id: String,
    pub kind: SourceKind,
    /// Adresse des conditions d'utilisation acceptées pour cette source.
    pub terms: String,
    #[serde(default)]
    pub enabled: bool,
    pub min_interval_seconds: u64,
    /// Chemins de fichiers ou URL, selon le type de source.
    #[serde(default)]
    pub locations: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct RawDocument {
    pub id: Uuid,
    pub source_id: String,
    pub external_id: Option<String>,
    pub fetched_at: OffsetDateTime,
    pub content_type: String,
    pub payload: Vec<u8>,
    pub payload_sha256: String,
}

impl RawDocument {
    pub fn new(
        source_id: &str,
        external_id: Option<String>,
        content_type: &str,
        payload: Vec<u8>,
    ) -> Self {
        let payload_sha256 = Sha256::digest(&payload)
            .iter()
            .map(|octet| format!("{octet:02x}"))
            .collect();
        Self {
            id: Uuid::now_v7(),
            source_id: source_id.to_string(),
            external_id,
            fetched_at: OffsetDateTime::now_utc(),
            content_type: content_type.to_string(),
            payload,
            payload_sha256,
        }
    }
}

/// Projection normalisée. `origins` associe chaque champ au chemin d'où il vient
/// dans la charge brute : un champ sans origine n'a pas lieu d'exister.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NormalizedOffer {
    pub external_id: Option<String>,
    pub title: String,
    pub company: String,
    pub location: String,
    pub contract: Option<String>,
    pub url: Option<String>,
    pub description: String,
    pub published_at: Option<String>,
    pub origins: BTreeMap<String, String>,
}

#[derive(Debug, Error)]
pub enum SourceError {
    #[error("lecture impossible : {0}")]
    Read(String),
    #[error("réseau : {0}")]
    Network(String),
    #[error("authentification refusée par la source")]
    Unauthorized,
}

#[derive(Debug, Error)]
#[error("document non normalisable : {0}")]
pub struct NormalizeError(pub String);

#[async_trait]
pub trait Source: Send + Sync {
    fn id(&self) -> &str;
    /// Récupère les documents bruts. Aucune source ne suit de lien ni n'explore :
    /// elle interroge exactement ce que sa configuration déclare.
    async fn fetch(&self, since: Option<&str>) -> Result<Vec<RawDocument>, SourceError>;
    /// Extrait les champs d'un document brut, avec le chemin d'origine de chacun.
    fn normalize(&self, raw: &RawDocument) -> Result<Vec<NormalizedOffer>, NormalizeError>;
}

#[derive(Debug, Error)]
pub enum RegistryError {
    #[error("liste blanche illisible : {0}")]
    Read(#[from] std::io::Error),
    #[error("liste blanche invalide : {0}")]
    Parse(#[from] toml::de::Error),
    #[error("source {id} : {reason}")]
    Entry { id: String, reason: String },
    #[error("source déclarée deux fois : {0}")]
    Duplicate(String),
}

#[derive(Debug, Deserialize)]
struct SourcesFile {
    #[serde(default)]
    source: Vec<SourceEntry>,
}

pub struct Registry {
    entries: Vec<SourceEntry>,
}

fn identifiant_valide(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 80
        && id.chars().all(|caractere| {
            caractere.is_ascii_lowercase() || caractere.is_ascii_digit() || "_.-".contains(caractere)
        })
}

impl Registry {
    pub fn load(path: &Path) -> Result<Self, RegistryError> {
        Self::from_toml(&std::fs::read_to_string(path)?)
    }

    pub fn from_toml(contenu: &str) -> Result<Self, RegistryError> {
        let fichier: SourcesFile = toml::from_str(contenu)?;
        let mut vus: Vec<String> = Vec::new();
        for entree in &fichier.source {
            if !identifiant_valide(&entree.id) {
                return Err(RegistryError::Entry {
                    id: entree.id.clone(),
                    reason: "identifiant limité à [a-z0-9_.-], 80 caractères".into(),
                });
            }
            if entree.terms.trim().is_empty() {
                return Err(RegistryError::Entry {
                    id: entree.id.clone(),
                    reason: "les conditions d'utilisation acceptées sont obligatoires".into(),
                });
            }
            if entree.min_interval_seconds == 0 {
                return Err(RegistryError::Entry {
                    id: entree.id.clone(),
                    reason: "min_interval_seconds doit valoir au moins 1".into(),
                });
            }
            if vus.contains(&entree.id) {
                return Err(RegistryError::Duplicate(entree.id.clone()));
            }
            vus.push(entree.id.clone());
        }
        Ok(Self {
            entries: fichier.source,
        })
    }

    pub fn get(&self, id: &str) -> Option<&SourceEntry> {
        self.entries.iter().find(|entree| entree.id == id)
    }

    pub fn enabled(&self) -> Vec<&SourceEntry> {
        self.entries.iter().filter(|entree| entree.enabled).collect()
    }
}
```

Ajouter `pub mod sources;` dans `src/lib.rs`.

- [ ] **Step 4: Écrire la liste blanche livrée**

`services/offers/sources.toml` :

```toml
# Une source absente de ce fichier n'est jamais interrogée, même si son
# connecteur existe. `terms` doit pointer les conditions effectivement acceptées.

[[source]]
id = "depot-manuel"
kind = "file"
terms = "https://exemple.test/conditions-du-depot-manuel"
enabled = true
min_interval_seconds = 1
locations = ["./offres.json"]
```

- [ ] **Step 5: Lancer les tests pour vérifier qu'ils passent**

Run: `cd services/offers && cargo test sources`
Expected: PASS, 7 tests.

- [ ] **Step 6: Vérification complète**

Run: `cd services/offers && cargo test && cargo fmt --check && cargo clippy --all-targets -- -D warnings`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add services/offers/src/sources services/offers/src/lib.rs services/offers/sources.toml
git commit -m "feat(offers): contrat de source et liste blanche vérifiée au chargement"
```

---

### Task 5: Connecteur « dépôt manuel de fichiers »

**Files:**
- Create: `services/offers/src/sources/file.rs`
- Create: `services/offers/tests/fixtures/offres-synthetiques.json`

**Interfaces:**
- Consumes: `sources::{Source, RawDocument, NormalizedOffer, SourceError, NormalizeError}`.
- Produces: `sources::file::FileSource`, `FileSource::new(id: impl Into<String>, chemins: Vec<PathBuf>) -> FileSource`.

Format attendu, défini par nous puisque le dépôt est manuel : un tableau JSON
d'objets. Champs obligatoires `intitule`, `entreprise`, `lieu`, `description` ;
facultatifs `reference`, `contrat`, `url`, `publiee_le`.

- [ ] **Step 1: Écrire la fixture synthétique**

`services/offers/tests/fixtures/offres-synthetiques.json` :

```json
[
  {
    "reference": "SYNTH-001",
    "intitule": "Développeur Web (H/F)",
    "entreprise": "Studio Exemple SAS",
    "lieu": "Paris",
    "contrat": "CDI",
    "url": "https://exemple.test/offres/1",
    "description": "Poste synthétique utilisé uniquement pour les tests.",
    "publiee_le": "2026-09-01T08:00:00Z"
  },
  {
    "reference": "SYNTH-002",
    "intitule": "Chef de projet",
    "entreprise": "Exemple Conseil",
    "lieu": "Lyon",
    "description": "Poste synthétique utilisé uniquement pour les tests."
  }
]
```

- [ ] **Step 2: Écrire les tests qui échouent**

À la fin de `services/offers/src/sources/file.rs` :

```rust
#[cfg(test)]
mod tests {
    use super::*;

    fn document(contenu: &str) -> RawDocument {
        RawDocument::new(
            "depot-manuel",
            None,
            "application/json",
            contenu.as_bytes().to_vec(),
        )
    }

    #[tokio::test]
    async fn lit_le_fichier_declare_et_conserve_la_charge_brute() {
        let source = FileSource::new(
            "depot-manuel",
            vec![PathBuf::from("tests/fixtures/offres-synthetiques.json")],
        );
        let documents = source.fetch(None).await.unwrap();
        assert_eq!(documents.len(), 1);
        assert_eq!(documents[0].content_type, "application/json");
        assert!(documents[0].payload.starts_with(b"["));
    }

    #[test]
    fn normalise_chaque_element_avec_son_origine() {
        let source = FileSource::new("depot-manuel", vec![]);
        let brut = document(
            r#"[{"reference":"SYNTH-001","intitule":"Développeur Web (H/F)","entreprise":"Studio Exemple SAS","lieu":"Paris","description":"Texte."}]"#,
        );
        let offres = source.normalize(&brut).unwrap();
        assert_eq!(offres.len(), 1);
        assert_eq!(offres[0].title, "Développeur Web (H/F)");
        assert_eq!(offres[0].external_id.as_deref(), Some("SYNTH-001"));
        assert_eq!(offres[0].origins.get("title").unwrap(), "/0/intitule");
        assert_eq!(offres[0].origins.get("company").unwrap(), "/0/entreprise");
    }

    #[test]
    fn n_invente_aucun_champ_absent() {
        let source = FileSource::new("depot-manuel", vec![]);
        let brut = document(
            r#"[{"intitule":"Chef de projet","entreprise":"Exemple","lieu":"Lyon","description":"Texte."}]"#,
        );
        let offres = source.normalize(&brut).unwrap();
        assert!(offres[0].contract.is_none());
        assert!(offres[0].url.is_none());
        assert!(!offres[0].origins.contains_key("contract"));
    }

    #[test]
    fn refuse_un_element_auquel_manque_un_champ_obligatoire() {
        let source = FileSource::new("depot-manuel", vec![]);
        let brut =
            document(r#"[{"intitule":"Sans entreprise","lieu":"Paris","description":"Texte."}]"#);
        let erreur = source.normalize(&brut).unwrap_err();
        assert!(erreur.0.contains("entreprise"));
        assert!(erreur.0.contains("index 0"));
    }

    #[test]
    fn refuse_une_charge_qui_n_est_pas_un_tableau() {
        let source = FileSource::new("depot-manuel", vec![]);
        let erreur = source
            .normalize(&document(r#"{"intitule":"x"}"#))
            .unwrap_err();
        assert!(erreur.0.contains("tableau"));
    }
}
```

Choix assumé : un élément invalide fait échouer tout le document, avec son index
en clair dans le message. Le dépôt est manuel, donc la personne qui l'a déposé
peut corriger le fichier ; accepter les éléments valides en ignorant les autres
rendrait la perte silencieuse.

- [ ] **Step 3: Lancer les tests pour vérifier qu'ils échouent**

Run: `cd services/offers && cargo test file`
Expected: FAIL — `cannot find type FileSource in this scope`.

- [ ] **Step 4: Écrire le connecteur**

Au début de `services/offers/src/sources/file.rs` :

```rust
use std::{collections::BTreeMap, path::PathBuf};

use async_trait::async_trait;
use serde_json::Value;

use super::{NormalizeError, NormalizedOffer, RawDocument, Source, SourceError};

pub struct FileSource {
    id: String,
    chemins: Vec<PathBuf>,
}

impl FileSource {
    pub fn new(id: impl Into<String>, chemins: Vec<PathBuf>) -> Self {
        Self {
            id: id.into(),
            chemins,
        }
    }
}

fn texte_obligatoire(element: &Value, cle: &str, index: usize) -> Result<String, NormalizeError> {
    element
        .get(cle)
        .and_then(Value::as_str)
        .map(str::to_string)
        .filter(|valeur| !valeur.trim().is_empty())
        .ok_or_else(|| NormalizeError(format!("index {index} : champ « {cle} » absent ou vide")))
}

fn texte_facultatif(element: &Value, cle: &str) -> Option<String> {
    element
        .get(cle)
        .and_then(Value::as_str)
        .map(str::to_string)
        .filter(|valeur| !valeur.trim().is_empty())
}

#[async_trait]
impl Source for FileSource {
    fn id(&self) -> &str {
        &self.id
    }

    async fn fetch(&self, _since: Option<&str>) -> Result<Vec<RawDocument>, SourceError> {
        let mut documents = Vec::new();
        for chemin in &self.chemins {
            let contenu = std::fs::read(chemin)
                .map_err(|erreur| SourceError::Read(format!("{} : {erreur}", chemin.display())))?;
            documents.push(RawDocument::new(&self.id, None, "application/json", contenu));
        }
        Ok(documents)
    }

    fn normalize(&self, raw: &RawDocument) -> Result<Vec<NormalizedOffer>, NormalizeError> {
        let racine: Value = serde_json::from_slice(&raw.payload)
            .map_err(|erreur| NormalizeError(format!("JSON illisible : {erreur}")))?;
        let elements = racine
            .as_array()
            .ok_or_else(|| NormalizeError("la charge doit être un tableau JSON".into()))?;

        let mut offres = Vec::with_capacity(elements.len());
        for (index, element) in elements.iter().enumerate() {
            let mut origins = BTreeMap::new();
            let title = texte_obligatoire(element, "intitule", index)?;
            origins.insert("title".to_string(), format!("/{index}/intitule"));
            let company = texte_obligatoire(element, "entreprise", index)?;
            origins.insert("company".to_string(), format!("/{index}/entreprise"));
            let location = texte_obligatoire(element, "lieu", index)?;
            origins.insert("location".to_string(), format!("/{index}/lieu"));
            let description = texte_obligatoire(element, "description", index)?;
            origins.insert("description".to_string(), format!("/{index}/description"));

            let contract = texte_facultatif(element, "contrat");
            if contract.is_some() {
                origins.insert("contract".to_string(), format!("/{index}/contrat"));
            }
            let url = texte_facultatif(element, "url");
            if url.is_some() {
                origins.insert("url".to_string(), format!("/{index}/url"));
            }
            let published_at = texte_facultatif(element, "publiee_le");
            if published_at.is_some() {
                origins.insert("published_at".to_string(), format!("/{index}/publiee_le"));
            }

            offres.push(NormalizedOffer {
                external_id: texte_facultatif(element, "reference"),
                title,
                company,
                location,
                contract,
                url,
                description,
                published_at,
                origins,
            });
        }
        Ok(offres)
    }
}
```

- [ ] **Step 5: Déclarer le module**

Ajouter `pub mod file;` en première ligne de `services/offers/src/sources/mod.rs`.

- [ ] **Step 6: Lancer les tests pour vérifier qu'ils passent**

Run: `cd services/offers && cargo test file`
Expected: PASS, 5 tests.

- [ ] **Step 7: Vérification complète**

Run: `cd services/offers && cargo test && cargo fmt --check && cargo clippy --all-targets -- -D warnings`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add services/offers/src/sources services/offers/tests/fixtures
git commit -m "feat(offers): connecteur de dépôt manuel avec origine de chaque champ"
```

---

### Task 6: Déduplication et pipeline de collecte

**Files:**
- Create: `services/offers/src/dedup.rs`
- Create: `services/offers/src/collect.rs`
- Create: `services/offers/tests/collect.rs`
- Modify: `services/offers/src/lib.rs`

**Interfaces:**
- Consumes: `store::{connect, migrate, StoreError}`, `normalize::fingerprint`, `sources::{Source, RawDocument}`.
- Produces:
  - `dedup::Decision { group_id: Uuid, existing_offer_id: Option<Uuid>, rule: Option<&'static str>, compared: serde_json::Value }`
  - `dedup::decide(pool: &SqlitePool, source_id: &str, external_id: Option<&str>, fingerprint: &str) -> Result<Decision, StoreError>`
  - `dedup::{REGLE_IDENTIFIANT, REGLE_EMPREINTE}`
  - `collect::SourceReport { source_id, fetched, created, updated, grouped, skipped, error }`
  - `collect::Report { sources: Vec<SourceReport> }` avec `Report::all_failed(&self) -> bool`
  - `collect::run_source(pool: &SqlitePool, source: &dyn Source) -> SourceReport`

- [ ] **Step 1: Écrire les tests d'intégration qui échouent**

`services/offers/tests/collect.rs` :

```rust
use std::path::PathBuf;

use cekarna_offers::{collect, sources::file::FileSource, store};
use sqlx::SqlitePool;

async fn base() -> (tempfile::TempDir, SqlitePool) {
    let dossier = tempfile::tempdir().unwrap();
    let chemin = dossier.path().join("test.db");
    let pool = store::connect(chemin.to_str().unwrap()).await.unwrap();
    store::migrate(&pool).await.unwrap();
    (dossier, pool)
}

fn source_fixture(id: &str) -> FileSource {
    FileSource::new(
        id,
        vec![PathBuf::from("tests/fixtures/offres-synthetiques.json")],
    )
}

#[tokio::test]
async fn une_premiere_collecte_cree_les_offres() {
    let (_dossier, pool) = base().await;
    let rapport = collect::run_source(&pool, &source_fixture("depot-manuel")).await;
    assert_eq!(rapport.created, 2);
    assert_eq!(rapport.updated, 0);
    assert!(rapport.error.is_none());
}

#[tokio::test]
async fn collecter_deux_fois_ne_cree_aucun_doublon() {
    let (_dossier, pool) = base().await;
    collect::run_source(&pool, &source_fixture("depot-manuel")).await;
    let second = collect::run_source(&pool, &source_fixture("depot-manuel")).await;

    assert_eq!(second.created, 0);
    assert_eq!(second.updated, 2);
    let total: i64 = sqlx::query_scalar("SELECT count(*) FROM offers")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(total, 2);
}

#[tokio::test]
async fn la_meme_annonce_sur_deux_sources_forme_un_seul_groupe() {
    let (_dossier, pool) = base().await;
    collect::run_source(&pool, &source_fixture("depot-manuel")).await;
    collect::run_source(&pool, &source_fixture("second-depot")).await;

    let offres: i64 = sqlx::query_scalar("SELECT count(*) FROM offers")
        .fetch_one(&pool)
        .await
        .unwrap();
    let groupes: i64 = sqlx::query_scalar("SELECT count(DISTINCT group_id) FROM offers")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(offres, 4, "les quatre offres restent consultables");
    assert_eq!(groupes, 2, "regroupées deux à deux par empreinte");
}

#[tokio::test]
async fn chaque_regroupement_ecrit_sa_decision() {
    let (_dossier, pool) = base().await;
    collect::run_source(&pool, &source_fixture("depot-manuel")).await;
    collect::run_source(&pool, &source_fixture("second-depot")).await;

    let decisions: Vec<(String,)> =
        sqlx::query_as("SELECT rule FROM duplicate_decisions ORDER BY rule")
            .fetch_all(&pool)
            .await
            .unwrap();
    assert_eq!(decisions.len(), 2);
    assert!(
        decisions
            .iter()
            .all(|(regle,)| regle == "empreinte-normalisee")
    );
}

#[tokio::test]
async fn un_document_illisible_est_conserve_avec_sa_raison() {
    let (_dossier, pool) = base().await;
    let dossier = tempfile::tempdir().unwrap();
    let chemin = dossier.path().join("casse.json");
    std::fs::write(&chemin, b"{ pas un tableau }").unwrap();

    let rapport = collect::run_source(&pool, &FileSource::new("depot-casse", vec![chemin])).await;
    assert_eq!(rapport.skipped, 1);
    assert_eq!(rapport.created, 0);
    assert!(
        rapport.error.is_none(),
        "un document cassé n'est pas un échec de source"
    );

    let conserves: i64 = sqlx::query_scalar("SELECT count(*) FROM normalization_failures")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(conserves, 1);
    let bruts: i64 = sqlx::query_scalar("SELECT count(*) FROM raw_documents")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(bruts, 1, "la charge brute est conservée malgré l'échec");
}
```

- [ ] **Step 2: Lancer les tests pour vérifier qu'ils échouent**

Run: `cd services/offers && cargo test --test collect`
Expected: FAIL — `unresolved import cekarna_offers::collect`.

- [ ] **Step 3: Écrire les règles de déduplication**

`services/offers/src/dedup.rs` :

```rust
use serde_json::json;
use sqlx::SqlitePool;
use uuid::Uuid;

use crate::store::StoreError;

pub const REGLE_IDENTIFIANT: &str = "identifiant-source";
pub const REGLE_EMPREINTE: &str = "empreinte-normalisee";

#[derive(Debug, Clone)]
pub struct Decision {
    pub group_id: Uuid,
    /// Renseigné quand l'offre existe déjà et doit être mise à jour.
    pub existing_offer_id: Option<Uuid>,
    /// Règle appliquée, absente quand l'offre est inédite.
    pub rule: Option<&'static str>,
    pub compared: serde_json::Value,
}

/// Applique les deux règles, dans l'ordre. La règle 1 prime : une offre ne
/// change jamais de groupe en cours de vie, sinon les décisions déjà écrites
/// deviendraient fausses.
pub async fn decide(
    pool: &SqlitePool,
    source_id: &str,
    external_id: Option<&str>,
    fingerprint: &str,
) -> Result<Decision, StoreError> {
    if let Some(externe) = external_id {
        let existante: Option<(String, String)> = sqlx::query_as(
            "SELECT id, group_id FROM offers WHERE source_id = ?1 AND external_id = ?2",
        )
        .bind(source_id)
        .bind(externe)
        .fetch_optional(pool)
        .await?;
        if let Some((id, group_id)) = existante {
            return Ok(Decision {
                group_id: Uuid::parse_str(&group_id).unwrap_or_else(|_| Uuid::now_v7()),
                existing_offer_id: Uuid::parse_str(&id).ok(),
                rule: Some(REGLE_IDENTIFIANT),
                compared: json!({ "source_id": source_id, "external_id": externe }),
            });
        }
    }

    let voisine: Option<(String,)> = sqlx::query_as(
        "SELECT group_id FROM offers WHERE fingerprint = ?1 ORDER BY first_seen_at, id LIMIT 1",
    )
    .bind(fingerprint)
    .fetch_optional(pool)
    .await?;

    match voisine {
        Some((group_id,)) => Ok(Decision {
            group_id: Uuid::parse_str(&group_id).unwrap_or_else(|_| Uuid::now_v7()),
            existing_offer_id: None,
            rule: Some(REGLE_EMPREINTE),
            compared: json!({ "fingerprint": fingerprint }),
        }),
        None => Ok(Decision {
            group_id: Uuid::now_v7(),
            existing_offer_id: None,
            rule: None,
            compared: json!({ "fingerprint": fingerprint }),
        }),
    }
}
```

- [ ] **Step 4: Écrire le pipeline**

`services/offers/src/collect.rs` :

```rust
use serde::Serialize;
use sqlx::SqlitePool;
use time::{OffsetDateTime, format_description::well_known::Rfc3339};
use uuid::Uuid;

use crate::{
    dedup,
    normalize::fingerprint,
    sources::{RawDocument, Source},
    store::StoreError,
};

#[derive(Debug, Default, Clone, Serialize)]
pub struct SourceReport {
    pub source_id: String,
    pub fetched: usize,
    pub created: usize,
    pub updated: usize,
    pub grouped: usize,
    pub skipped: usize,
    pub error: Option<String>,
}

#[derive(Debug, Default, Clone, Serialize)]
pub struct Report {
    pub sources: Vec<SourceReport>,
}

impl Report {
    /// Vrai seulement si toutes les sources ont échoué : l'échec partiel est le
    /// cas normal et ne doit pas faire échouer la commande.
    pub fn all_failed(&self) -> bool {
        !self.sources.is_empty() && self.sources.iter().all(|source| source.error.is_some())
    }
}

fn maintenant() -> String {
    OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .unwrap_or_default()
}

async fn enregistrer_brut(pool: &SqlitePool, brut: &RawDocument) -> Result<(), StoreError> {
    sqlx::query(
        "INSERT INTO raw_documents (id, source_id, external_id, fetched_at, content_type, payload, payload_sha256)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
    )
    .bind(brut.id.to_string())
    .bind(&brut.source_id)
    .bind(brut.external_id.as_deref())
    .bind(brut.fetched_at.format(&Rfc3339).unwrap_or_default())
    .bind(&brut.content_type)
    .bind(&brut.payload)
    .bind(&brut.payload_sha256)
    .execute(pool)
    .await?;
    Ok(())
}

/// Collecte une source de bout en bout. Ne renvoie jamais d'erreur : un échec
/// est porté par le rapport, pour ne pas interrompre les autres sources.
pub async fn run_source(pool: &SqlitePool, source: &dyn Source) -> SourceReport {
    let mut rapport = SourceReport {
        source_id: source.id().to_string(),
        ..SourceReport::default()
    };

    let documents = match source.fetch(None).await {
        Ok(documents) => documents,
        Err(erreur) => {
            rapport.error = Some(erreur.to_string());
            return rapport;
        }
    };
    rapport.fetched = documents.len();

    for brut in &documents {
        if let Err(erreur) = enregistrer_brut(pool, brut).await {
            rapport.error = Some(erreur.to_string());
            return rapport;
        }

        let offres = match source.normalize(brut) {
            Ok(offres) => offres,
            Err(erreur) => {
                // Conservé, jamais abandonné en silence, jamais complété au jugé.
                if let Err(echec) = sqlx::query(
                    "INSERT INTO normalization_failures (raw_document_id, reason, failed_at)
                     VALUES (?1, ?2, ?3)",
                )
                .bind(brut.id.to_string())
                .bind(erreur.to_string())
                .bind(maintenant())
                .execute(pool)
                .await
                {
                    rapport.error = Some(echec.to_string());
                    return rapport;
                }
                rapport.skipped += 1;
                continue;
            }
        };

        for offre in offres {
            let empreinte = fingerprint(&offre.title, &offre.company, &offre.location);
            let decision =
                match dedup::decide(pool, source.id(), offre.external_id.as_deref(), &empreinte)
                    .await
                {
                    Ok(decision) => decision,
                    Err(erreur) => {
                        rapport.error = Some(erreur.to_string());
                        return rapport;
                    }
                };

            let origins = serde_json::to_string(&offre.origins).unwrap_or_else(|_| "{}".into());
            let horodatage = maintenant();

            if let Some(existante) = decision.existing_offer_id {
                if let Err(erreur) = sqlx::query(
                    "UPDATE offers SET raw_document_id = ?1, title = ?2, company = ?3,
                     location = ?4, contract = ?5, url = ?6, description = ?7,
                     published_at = ?8, fingerprint = ?9, origins = ?10, last_seen_at = ?11
                     WHERE id = ?12",
                )
                .bind(brut.id.to_string())
                .bind(&offre.title)
                .bind(&offre.company)
                .bind(&offre.location)
                .bind(offre.contract.as_deref())
                .bind(offre.url.as_deref())
                .bind(&offre.description)
                .bind(offre.published_at.as_deref())
                .bind(&empreinte)
                .bind(&origins)
                .bind(&horodatage)
                .bind(existante.to_string())
                .execute(pool)
                .await
                {
                    rapport.error = Some(erreur.to_string());
                    return rapport;
                }
                rapport.updated += 1;
                continue;
            }

            let offre_id = Uuid::now_v7();
            if let Err(erreur) = sqlx::query(
                "INSERT INTO offers (id, raw_document_id, source_id, external_id, title, company,
                 location, contract, url, description, published_at, fingerprint, group_id,
                 origins, first_seen_at, last_seen_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?15)",
            )
            .bind(offre_id.to_string())
            .bind(brut.id.to_string())
            .bind(source.id())
            .bind(offre.external_id.as_deref())
            .bind(&offre.title)
            .bind(&offre.company)
            .bind(&offre.location)
            .bind(offre.contract.as_deref())
            .bind(offre.url.as_deref())
            .bind(&offre.description)
            .bind(offre.published_at.as_deref())
            .bind(&empreinte)
            .bind(decision.group_id.to_string())
            .bind(&origins)
            .bind(&horodatage)
            .execute(pool)
            .await
            {
                rapport.error = Some(erreur.to_string());
                return rapport;
            }
            rapport.created += 1;

            if let Some(regle) = decision.rule {
                rapport.grouped += 1;
                if let Err(erreur) = sqlx::query(
                    "INSERT INTO duplicate_decisions (offer_id, group_id, rule, compared, decided_at)
                     VALUES (?1, ?2, ?3, ?4, ?5)",
                )
                .bind(offre_id.to_string())
                .bind(decision.group_id.to_string())
                .bind(regle)
                .bind(decision.compared.to_string())
                .bind(&horodatage)
                .execute(pool)
                .await
                {
                    rapport.error = Some(erreur.to_string());
                    return rapport;
                }
            }
        }
    }

    rapport
}
```

Ajouter `pub mod collect;` et `pub mod dedup;` dans `src/lib.rs`.

- [ ] **Step 5: Lancer les tests pour vérifier qu'ils passent**

Run: `cd services/offers && cargo test --test collect`
Expected: PASS, 5 tests.

- [ ] **Step 6: Vérification complète**

Run: `cd services/offers && cargo test && cargo fmt --check && cargo clippy --all-targets -- -D warnings`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add services/offers/src/dedup.rs services/offers/src/collect.rs services/offers/src/lib.rs services/offers/tests/collect.rs
git commit -m "feat(offers): déduplication déterministe et pipeline de collecte tracé"
```

---

### Task 7: API HTTP de lecture et garde d'authentification interne

**Files:**
- Create: `services/offers/src/http.rs`
- Create: `services/offers/tests/http.rs`
- Modify: `services/offers/src/lib.rs`
- Modify: `services/offers/src/main.rs`
- Modify: `services/offers/Cargo.toml` (ajout de `tower` en dépendance de développement)

**Interfaces:**
- Consumes: `store`, `sources::Registry`, `config::Config`.
- Produces:
  - `http::AppState { pool: Arc<SqlitePool>, internal_token: Arc<String>, registry: Arc<Registry> }`
  - `http::router(state: AppState) -> axum::Router`
  - `http::OfferView` (sérialisée en JSON pour NestJS)

- [ ] **Step 1: Ajouter `tower` aux dépendances de développement**

Dans `services/offers/Cargo.toml` :

```toml
[dev-dependencies]
tempfile = "3"
tower = { version = "0.5", features = ["util"] }
```

- [ ] **Step 2: Écrire les tests qui échouent**

`services/offers/tests/http.rs` :

```rust
use std::{path::PathBuf, sync::Arc};

use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use cekarna_offers::{collect, http, sources::Registry, sources::file::FileSource, store};
use tower::ServiceExt;

const JETON: &str = "0123456789abcdef0123456789abcdef";

const LISTE: &str = r#"
[[source]]
id = "depot-manuel"
kind = "file"
terms = "https://exemple.test/conditions"
enabled = true
min_interval_seconds = 1
"#;

async fn application() -> (tempfile::TempDir, axum::Router) {
    let dossier = tempfile::tempdir().unwrap();
    let chemin = dossier.path().join("test.db");
    let pool = store::connect(chemin.to_str().unwrap()).await.unwrap();
    store::migrate(&pool).await.unwrap();
    collect::run_source(
        &pool,
        &FileSource::new(
            "depot-manuel",
            vec![PathBuf::from("tests/fixtures/offres-synthetiques.json")],
        ),
    )
    .await;

    let state = http::AppState {
        pool: Arc::new(pool),
        internal_token: Arc::new(JETON.to_string()),
        registry: Arc::new(Registry::from_toml(LISTE).unwrap()),
    };
    (dossier, http::router(state))
}

fn requete(uri: &str, jeton: Option<&str>) -> Request<Body> {
    let mut constructeur = Request::builder().uri(uri);
    if let Some(valeur) = jeton {
        constructeur = constructeur.header("authorization", format!("Bearer {valeur}"));
    }
    constructeur.body(Body::empty()).unwrap()
}

#[tokio::test]
async fn refuse_une_requete_sans_jeton() {
    let (_dossier, app) = application().await;
    let reponse = app.oneshot(requete("/v1/offers", None)).await.unwrap();
    assert_eq!(reponse.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn refuse_un_jeton_errone() {
    let (_dossier, app) = application().await;
    let reponse = app
        .oneshot(requete("/v1/offers", Some("mauvais-jeton")))
        .await
        .unwrap();
    assert_eq!(reponse.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn la_sonde_de_vie_ne_demande_pas_de_jeton() {
    let (_dossier, app) = application().await;
    let reponse = app.oneshot(requete("/health", None)).await.unwrap();
    assert_eq!(reponse.status(), StatusCode::OK);
}

#[tokio::test]
async fn liste_les_offres_canoniques() {
    let (_dossier, app) = application().await;
    let reponse = app
        .oneshot(requete("/v1/offers", Some(JETON)))
        .await
        .unwrap();
    assert_eq!(reponse.status(), StatusCode::OK);
    let corps = axum::body::to_bytes(reponse.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: serde_json::Value = serde_json::from_slice(&corps).unwrap();
    assert_eq!(json["offers"].as_array().unwrap().len(), 2);
}

#[tokio::test]
async fn filtre_par_ville() {
    let (_dossier, app) = application().await;
    let reponse = app
        .oneshot(requete("/v1/offers?location=lyon", Some(JETON)))
        .await
        .unwrap();
    let corps = axum::body::to_bytes(reponse.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: serde_json::Value = serde_json::from_slice(&corps).unwrap();
    let offres = json["offers"].as_array().unwrap();
    assert_eq!(offres.len(), 1);
    assert_eq!(offres[0]["location"], "Lyon");
}

#[tokio::test]
async fn expose_la_liste_blanche_declaree() {
    let (_dossier, app) = application().await;
    let reponse = app
        .oneshot(requete("/v1/sources", Some(JETON)))
        .await
        .unwrap();
    let corps = axum::body::to_bytes(reponse.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: serde_json::Value = serde_json::from_slice(&corps).unwrap();
    assert_eq!(json["sources"][0]["id"], "depot-manuel");
    assert_eq!(
        json["sources"][0]["terms"],
        "https://exemple.test/conditions"
    );
}

#[tokio::test]
async fn renvoie_404_pour_une_offre_inconnue() {
    let (_dossier, app) = application().await;
    let reponse = app
        .oneshot(requete(
            "/v1/offers/01900000-0000-7000-8000-000000000000",
            Some(JETON),
        ))
        .await
        .unwrap();
    assert_eq!(reponse.status(), StatusCode::NOT_FOUND);
}
```

- [ ] **Step 3: Lancer les tests pour vérifier qu'ils échouent**

Run: `cd services/offers && cargo test --test http`
Expected: FAIL — `unresolved import cekarna_offers::http`.

- [ ] **Step 4: Écrire le module HTTP**

`services/offers/src/http.rs` :

```rust
use std::sync::Arc;

use axum::{
    Json, Router,
    extract::{Path, Query, Request, State},
    http::{StatusCode, header},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::get,
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::{FromRow, SqlitePool};

use crate::{sources::Registry, store};

#[derive(Clone)]
pub struct AppState {
    pub pool: Arc<SqlitePool>,
    pub internal_token: Arc<String>,
    pub registry: Arc<Registry>,
}

#[derive(Debug, Serialize, FromRow)]
pub struct OfferView {
    pub id: String,
    pub source_id: String,
    pub external_id: Option<String>,
    pub title: String,
    pub company: String,
    pub location: String,
    pub contract: Option<String>,
    pub url: Option<String>,
    pub description: String,
    pub published_at: Option<String>,
    pub group_id: String,
    pub origins: String,
    pub first_seen_at: String,
    pub last_seen_at: String,
}

#[derive(Debug, Deserialize)]
pub struct ListeParams {
    pub q: Option<String>,
    pub location: Option<String>,
    pub contract: Option<String>,
    pub cursor: Option<String>,
    pub limit: Option<i64>,
    pub duplicates: Option<String>,
}

#[derive(Debug, Serialize, FromRow)]
struct DecisionView {
    offer_id: String,
    rule: String,
    compared: String,
    decided_at: String,
}

/// Comparaison à temps constant : la durée de la réponse ne doit pas révéler
/// combien de caractères du jeton sont corrects.
fn egalite_constante(gauche: &[u8], droite: &[u8]) -> bool {
    if gauche.len() != droite.len() {
        return false;
    }
    gauche
        .iter()
        .zip(droite.iter())
        .fold(0u8, |accumulateur, (a, b)| accumulateur | (a ^ b))
        == 0
}

async fn require_internal_token(
    State(state): State<AppState>,
    request: Request,
    next: Next,
) -> Response {
    if request.uri().path().starts_with("/health") {
        return next.run(request).await;
    }
    let fourni = request
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|valeur| valeur.to_str().ok())
        .and_then(|valeur| valeur.strip_prefix("Bearer "));
    match fourni {
        Some(valeur) if egalite_constante(valeur.as_bytes(), state.internal_token.as_bytes()) => {
            next.run(request).await
        }
        _ => StatusCode::UNAUTHORIZED.into_response(),
    }
}

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/health", get(|| async { Json(json!({ "status": "ok" })) }))
        .route("/health/ready", get(ready))
        .route("/v1/offers", get(lister_offres))
        .route("/v1/offers/{id}", get(detail_offre))
        .route("/v1/sources", get(lister_sources))
        .layer(middleware::from_fn_with_state(
            state.clone(),
            require_internal_token,
        ))
        .with_state(state)
}

async fn ready(State(state): State<AppState>) -> impl IntoResponse {
    match store::ping(&state.pool).await {
        Ok(()) => (StatusCode::OK, Json(json!({ "status": "ready" }))),
        Err(erreur) => {
            tracing::error!(error = %erreur, "base indisponible");
            (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(json!({ "status": "unavailable" })),
            )
        }
    }
}

async fn lister_offres(
    State(state): State<AppState>,
    Query(params): Query<ListeParams>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let limite = params.limit.unwrap_or(50).clamp(1, 200);
    let inclure_doublons = params.duplicates.as_deref() == Some("include");

    // Sans `duplicates=include`, seule l'offre canonique de chaque groupe sort :
    // la plus ancienne, l'identifiant tranchant les égalités.
    let mut requete = String::from(
        "SELECT id, source_id, external_id, title, company, location, contract, url,
                description, published_at, group_id, origins, first_seen_at, last_seen_at
         FROM offers o WHERE 1 = 1",
    );
    if !inclure_doublons {
        requete.push_str(
            " AND o.id = (SELECT c.id FROM offers c WHERE c.group_id = o.group_id
                          ORDER BY c.first_seen_at, c.id LIMIT 1)",
        );
    }
    if params.q.is_some() {
        requete.push_str(" AND (lower(o.title) LIKE ? OR lower(o.description) LIKE ?)");
    }
    if params.location.is_some() {
        requete.push_str(" AND lower(o.location) = ?");
    }
    if params.contract.is_some() {
        requete.push_str(" AND lower(o.contract) = ?");
    }
    if params.cursor.is_some() {
        requete.push_str(" AND o.id > ?");
    }
    requete.push_str(" ORDER BY o.id LIMIT ?");

    let mut executable = sqlx::query_as::<_, OfferView>(&requete);
    if let Some(q) = &params.q {
        let motif = format!("%{}%", q.to_lowercase());
        executable = executable.bind(motif.clone()).bind(motif);
    }
    if let Some(location) = &params.location {
        executable = executable.bind(location.to_lowercase());
    }
    if let Some(contract) = &params.contract {
        executable = executable.bind(contract.to_lowercase());
    }
    if let Some(cursor) = &params.cursor {
        executable = executable.bind(cursor.clone());
    }
    executable = executable.bind(limite);

    let offres = executable.fetch_all(&*state.pool).await.map_err(|erreur| {
        tracing::error!(error = %erreur, "lecture des offres impossible");
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    let suivant = offres.last().map(|offre| offre.id.clone());
    Ok(Json(json!({ "offers": offres, "next_cursor": suivant })))
}

async fn detail_offre(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let offre: Option<OfferView> = sqlx::query_as(
        "SELECT id, source_id, external_id, title, company, location, contract, url,
                description, published_at, group_id, origins, first_seen_at, last_seen_at
         FROM offers WHERE id = ?1",
    )
    .bind(&id)
    .fetch_optional(&*state.pool)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let Some(offre) = offre else {
        return Err(StatusCode::NOT_FOUND);
    };

    let membres: Vec<OfferView> = sqlx::query_as(
        "SELECT id, source_id, external_id, title, company, location, contract, url,
                description, published_at, group_id, origins, first_seen_at, last_seen_at
         FROM offers WHERE group_id = ?1 AND id <> ?2 ORDER BY first_seen_at, id",
    )
    .bind(&offre.group_id)
    .bind(&id)
    .fetch_all(&*state.pool)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let decisions: Vec<DecisionView> = sqlx::query_as(
        "SELECT offer_id, rule, compared, decided_at FROM duplicate_decisions
         WHERE group_id = ?1 ORDER BY decided_at",
    )
    .bind(&offre.group_id)
    .fetch_all(&*state.pool)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(Json(json!({
        "offer": offre,
        "group_members": membres,
        "duplicate_decisions": decisions,
    })))
}

async fn lister_sources(State(state): State<AppState>) -> Json<serde_json::Value> {
    let sources: Vec<serde_json::Value> = state
        .registry
        .enabled()
        .iter()
        .map(|entree| {
            json!({
                "id": entree.id,
                "kind": format!("{:?}", entree.kind).to_lowercase(),
                "terms": entree.terms,
                "min_interval_seconds": entree.min_interval_seconds,
            })
        })
        .collect();
    Json(json!({ "sources": sources }))
}
```

Ajouter `pub mod http;` dans `src/lib.rs`.

- [ ] **Step 5: Brancher le routeur dans le binaire**

Remplacer `services/offers/src/main.rs` :

```rust
use std::{path::Path, sync::Arc};

use cekarna_offers::{config::Config, http, sources::Registry, store};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    dotenvy::dotenv().ok();
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    let config = Config::from_env()?;
    let pool = store::connect(&config.database_path).await?;
    store::migrate(&pool).await?;
    let registry = Registry::load(Path::new(&config.sources_path))?;

    let state = http::AppState {
        pool: Arc::new(pool),
        internal_token: Arc::new(config.internal_token.clone()),
        registry: Arc::new(registry),
    };

    let listener = tokio::net::TcpListener::bind(config.addr).await?;
    tracing::info!(addr = %config.addr, "service offres à l'écoute");
    axum::serve(listener, http::router(state)).await?;
    Ok(())
}
```

- [ ] **Step 6: Lancer les tests pour vérifier qu'ils passent**

Run: `cd services/offers && cargo test --test http`
Expected: PASS, 7 tests.

- [ ] **Step 7: Vérification complète**

Run: `cd services/offers && cargo test && cargo fmt --check && cargo clippy --all-targets -- -D warnings`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add services/offers/src services/offers/tests/http.rs services/offers/Cargo.toml services/offers/Cargo.lock
git commit -m "feat(offers): API de lecture protégée par jeton interne"
```

---

### Task 8: Déclenchement de collecte, verrou et ligne de commande

**Files:**
- Create: `services/offers/src/cli.rs`
- Create: `services/offers/tests/lock.rs`
- Modify: `services/offers/src/store/mod.rs`
- Modify: `services/offers/src/collect.rs`
- Modify: `services/offers/src/http.rs`
- Modify: `services/offers/src/main.rs`

**Interfaces:**
- Consumes: `collect::run_source`, `sources::Registry`, `store`.
- Produces:
  - `store::acquire_collection_lock(pool: &SqlitePool, holder: &str) -> Result<bool, StoreError>`
  - `store::release_collection_lock(pool: &SqlitePool) -> Result<(), StoreError>`
  - `collect::run_all(pool: &SqlitePool, registry: &Registry, only: Option<&str>) -> Report`
  - `cli::{Cli, Commande}`

- [ ] **Step 1: Écrire le test du verrou qui échoue**

`services/offers/tests/lock.rs` :

```rust
use cekarna_offers::store;

#[tokio::test]
async fn une_seule_collecte_a_la_fois() {
    let dossier = tempfile::tempdir().unwrap();
    let chemin = dossier.path().join("test.db");
    let pool = store::connect(chemin.to_str().unwrap()).await.unwrap();
    store::migrate(&pool).await.unwrap();

    assert!(store::acquire_collection_lock(&pool, "cli").await.unwrap());
    assert!(
        !store::acquire_collection_lock(&pool, "http").await.unwrap(),
        "le second demandeur doit échouer immédiatement"
    );

    store::release_collection_lock(&pool).await.unwrap();
    assert!(
        store::acquire_collection_lock(&pool, "http").await.unwrap(),
        "le verrou est reprenable une fois relâché"
    );
}
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `cd services/offers && cargo test --test lock`
Expected: FAIL — `cannot find function acquire_collection_lock`.

- [ ] **Step 3: Écrire le verrou**

Ajouter à la fin de `services/offers/src/store/mod.rs` :

```rust
use time::{OffsetDateTime, format_description::well_known::Rfc3339};

/// Prend le verrou de collecte. Renvoie `false` si une collecte tourne déjà,
/// plutôt que d'attendre : deux écritures concurrentes sur SQLite buteraient
/// sur `SQLITE_BUSY` avec un message incompréhensible pour l'exploitant.
pub async fn acquire_collection_lock(pool: &SqlitePool, holder: &str) -> Result<bool, StoreError> {
    let horodatage = OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .unwrap_or_default();
    let resultat = sqlx::query(
        "INSERT INTO collection_lock (id, holder, acquired_at) VALUES (1, ?1, ?2)
         ON CONFLICT (id) DO NOTHING",
    )
    .bind(holder)
    .bind(horodatage)
    .execute(pool)
    .await?;
    Ok(resultat.rows_affected() == 1)
}

pub async fn release_collection_lock(pool: &SqlitePool) -> Result<(), StoreError> {
    sqlx::query("DELETE FROM collection_lock WHERE id = 1")
        .execute(pool)
        .await?;
    Ok(())
}
```

- [ ] **Step 4: Lancer le test pour vérifier qu'il passe**

Run: `cd services/offers && cargo test --test lock`
Expected: PASS, 1 test.

- [ ] **Step 5: Écrire l'orchestration de toutes les sources**

Ajouter à la fin de `services/offers/src/collect.rs` :

```rust
use std::path::PathBuf;

use crate::sources::{Registry, SourceEntry, SourceKind, file::FileSource};

/// Construit le connecteur correspondant à une entrée déclarée. Une entrée dont
/// le connecteur n'est pas encore livré est signalée, jamais devinée.
fn connecteur(entree: &SourceEntry) -> Result<Box<dyn Source>, String> {
    match entree.kind {
        SourceKind::File => Ok(Box::new(FileSource::new(
            entree.id.clone(),
            entree.locations.iter().map(PathBuf::from).collect(),
        ))),
        autre => Err(format!("connecteur {autre:?} pas encore livré")),
    }
}

/// Collecte toutes les sources activées, ou une seule si `only` est renseigné.
/// Une source en échec n'interrompt pas les autres.
pub async fn run_all(pool: &SqlitePool, registry: &Registry, only: Option<&str>) -> Report {
    let mut rapport = Report::default();
    for entree in registry.enabled() {
        if only.is_some_and(|cible| entree.id != cible) {
            continue;
        }
        match connecteur(entree) {
            Ok(source) => rapport.sources.push(run_source(pool, source.as_ref()).await),
            Err(raison) => rapport.sources.push(SourceReport {
                source_id: entree.id.clone(),
                error: Some(raison),
                ..SourceReport::default()
            }),
        }
    }
    rapport
}
```

Les tâches 9 et 10 ajouteront leurs variantes à ce `match`.

- [ ] **Step 6: Ajouter la route de déclenchement**

Dans `services/offers/src/http.rs`, ajouter la route dans `router()`, avant `.layer(...)` :

```rust
        .route("/v1/collect", axum::routing::post(declencher_collecte))
```

Puis le gestionnaire, à la fin du fichier :

```rust
#[derive(Debug, Deserialize, Default)]
pub struct CollectBody {
    pub source_id: Option<String>,
}

async fn declencher_collecte(
    State(state): State<AppState>,
    corps: Option<Json<CollectBody>>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let demande = corps.map(|Json(corps)| corps).unwrap_or_default();

    if !store::acquire_collection_lock(&state.pool, "http")
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
    {
        return Err(StatusCode::CONFLICT);
    }

    let rapport =
        crate::collect::run_all(&state.pool, &state.registry, demande.source_id.as_deref()).await;

    if let Err(erreur) = store::release_collection_lock(&state.pool).await {
        tracing::error!(error = %erreur, "verrou de collecte non relâché");
    }

    Ok(Json(json!({ "report": rapport })))
}
```

- [ ] **Step 7: Écrire la ligne de commande**

`services/offers/src/cli.rs` :

```rust
use clap::{Parser, Subcommand};

#[derive(Debug, Parser)]
#[command(name = "offers", about = "Collecte et déduplication d'offres")]
pub struct Cli {
    #[command(subcommand)]
    pub commande: Option<Commande>,
}

#[derive(Debug, Subcommand)]
pub enum Commande {
    /// Applique les migrations puis s'arrête.
    Migrate,
    /// Lance une collecte, éventuellement limitée à une source déclarée.
    Collect {
        #[arg(long)]
        source: Option<String>,
    },
    /// Relâche un verrou laissé par un processus interrompu.
    Unlock,
    /// Démarre le serveur HTTP. Comportement par défaut.
    Serve,
}
```

- [ ] **Step 8: Câbler la ligne de commande dans le binaire**

Remplacer `services/offers/src/main.rs` :

```rust
mod cli;

use std::{path::Path, process::ExitCode, sync::Arc};

use cekarna_offers::{collect, config::Config, http, sources::Registry, store};
use clap::Parser;

use crate::cli::{Cli, Commande};

#[tokio::main]
async fn main() -> Result<ExitCode, Box<dyn std::error::Error>> {
    dotenvy::dotenv().ok();
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    let arguments = Cli::parse();
    let config = Config::from_env()?;
    let pool = store::connect(&config.database_path).await?;
    store::migrate(&pool).await?;

    match arguments.commande.unwrap_or(Commande::Serve) {
        Commande::Migrate => {
            tracing::info!("migrations appliquées");
            Ok(ExitCode::SUCCESS)
        }
        Commande::Unlock => {
            store::release_collection_lock(&pool).await?;
            tracing::info!("verrou de collecte relâché");
            Ok(ExitCode::SUCCESS)
        }
        Commande::Collect { source } => {
            let registry = Registry::load(Path::new(&config.sources_path))?;
            if !store::acquire_collection_lock(&pool, "cli").await? {
                eprintln!(
                    "une collecte est déjà en cours ; lancer « offers unlock » si le processus est mort"
                );
                return Ok(ExitCode::FAILURE);
            }
            let rapport = collect::run_all(&pool, &registry, source.as_deref()).await;
            store::release_collection_lock(&pool).await?;
            println!("{}", serde_json::to_string_pretty(&rapport)?);
            // L'échec partiel est normal : seul un échec total sort en erreur.
            Ok(if rapport.all_failed() {
                ExitCode::FAILURE
            } else {
                ExitCode::SUCCESS
            })
        }
        Commande::Serve => {
            let registry = Registry::load(Path::new(&config.sources_path))?;
            let state = http::AppState {
                pool: Arc::new(pool),
                internal_token: Arc::new(config.internal_token.clone()),
                registry: Arc::new(registry),
            };
            let listener = tokio::net::TcpListener::bind(config.addr).await?;
            tracing::info!(addr = %config.addr, "service offres à l'écoute");
            axum::serve(listener, http::router(state)).await?;
            Ok(ExitCode::SUCCESS)
        }
    }
}
```

- [ ] **Step 9: Vérification complète**

Run: `cd services/offers && cargo test && cargo fmt --check && cargo clippy --all-targets -- -D warnings`
Expected: PASS.

- [ ] **Step 10: Vérifier la collecte à la main**

Run:
```bash
cd services/offers
cp tests/fixtures/offres-synthetiques.json ./offres.json
OFFERS_INTERNAL_TOKEN=0123456789abcdef0123456789abcdef cargo run -- collect
OFFERS_INTERNAL_TOKEN=0123456789abcdef0123456789abcdef cargo run -- collect
```
Expected: `"created": 2` au premier passage, `"created": 0` et `"updated": 2` au second. Supprimer ensuite `offres.json`, `offers.db`, `offers.db-shm`, `offers.db-wal`.

- [ ] **Step 11: Commit**

```bash
git add services/offers/src services/offers/tests/lock.rs
git commit -m "feat(offers): déclenchement de collecte, verrou exclusif et ligne de commande"
```

---

### Task 9: Connecteur API France Travail

**Files:**
- Create: `services/offers/src/sources/france_travail.rs`
- Create: `services/offers/tests/fixtures/france-travail-synthetique.json`
- Modify: `services/offers/src/sources/mod.rs`
- Modify: `services/offers/src/collect.rs`
- Modify: `services/offers/.env.example`

**Interfaces:**
- Consumes: `sources::{Source, RawDocument, NormalizedOffer, SourceError, NormalizeError}`.
- Produces: `sources::france_travail::{FranceTravailSource, Credentials}`, `FranceTravailSource::new(id: impl Into<String>, credentials: Option<Credentials>) -> FranceTravailSource`.

`normalize` est une fonction pure du contenu reçu : elle se teste sans réseau.
`fetch` est la seule partie qui appelle l'extérieur ; aucun test ne l'exécute.

- [ ] **Step 1: Écrire la fixture synthétique**

`services/offers/tests/fixtures/france-travail-synthetique.json` — forme du
corps de réponse, avec des valeurs inventées pour le test :

```json
{
  "resultats": [
    {
      "id": "SYNTH-FT-001",
      "intitule": "Développeur Web (H/F)",
      "entreprise": { "nom": "Studio Exemple SAS" },
      "lieuTravail": { "libelle": "75 - PARIS 11" },
      "typeContrat": "CDI",
      "origineOffre": { "urlOrigine": "https://exemple.test/ft/1" },
      "description": "Offre synthétique utilisée uniquement pour les tests.",
      "dateCreation": "2026-09-01T08:00:00.000Z"
    },
    {
      "id": "SYNTH-FT-002",
      "intitule": "Chef de projet",
      "entreprise": {},
      "lieuTravail": { "libelle": "69 - LYON" },
      "description": "Offre synthétique utilisée uniquement pour les tests."
    }
  ]
}
```

- [ ] **Step 2: Écrire les tests qui échouent**

À la fin de `services/offers/src/sources/france_travail.rs` :

```rust
#[cfg(test)]
mod tests {
    use super::*;

    fn document() -> RawDocument {
        let charge = std::fs::read("tests/fixtures/france-travail-synthetique.json").unwrap();
        RawDocument::new("france-travail", None, "application/json", charge)
    }

    #[test]
    fn normalise_les_resultats_avec_leur_origine() {
        let source = FranceTravailSource::new("france-travail", None);
        let offres = source.normalize(&document()).unwrap();
        assert_eq!(offres.len(), 2);
        assert_eq!(offres[0].external_id.as_deref(), Some("SYNTH-FT-001"));
        assert_eq!(offres[0].title, "Développeur Web (H/F)");
        assert_eq!(offres[0].company, "Studio Exemple SAS");
        assert_eq!(
            offres[0].origins.get("company").unwrap(),
            "/resultats/0/entreprise/nom"
        );
        assert_eq!(
            offres[0].origins.get("published_at").unwrap(),
            "/resultats/0/dateCreation"
        );
    }

    #[test]
    fn laisse_vide_une_entreprise_non_communiquee() {
        let source = FranceTravailSource::new("france-travail", None);
        let offres = source.normalize(&document()).unwrap();
        assert_eq!(offres[1].company, "");
        assert!(!offres[1].origins.contains_key("company"));
        assert!(offres[1].contract.is_none());
    }

    #[test]
    fn refuse_une_charge_sans_tableau_de_resultats() {
        let source = FranceTravailSource::new("france-travail", None);
        let brut = RawDocument::new("france-travail", None, "application/json", b"{}".to_vec());
        let erreur = source.normalize(&brut).unwrap_err();
        assert!(erreur.0.contains("resultats"));
    }

    #[tokio::test]
    async fn refuse_de_collecter_sans_identifiants() {
        let source = FranceTravailSource::new("france-travail", None);
        let erreur = source.fetch(None).await.unwrap_err();
        assert!(matches!(erreur, SourceError::Unauthorized));
    }
}
```

Note : une entreprise non communiquée donne une chaîne vide **sans origine**.
C'est l'invariant central — un champ que la source ne fournit pas n'est jamais
comblé, et l'absence d'origine le prouve.

- [ ] **Step 3: Lancer les tests pour vérifier qu'ils échouent**

Run: `cd services/offers && cargo test france_travail`
Expected: FAIL — `cannot find type FranceTravailSource in this scope`.

- [ ] **Step 4: Écrire le connecteur**

Au début de `services/offers/src/sources/france_travail.rs` :

```rust
use std::collections::BTreeMap;

use async_trait::async_trait;
use serde_json::Value;

use super::{NormalizeError, NormalizedOffer, RawDocument, Source, SourceError};

const URL_JETON: &str =
    "https://entreprise.francetravail.fr/connexion/oauth2/access_token?realm=%2Fpartenaire";
const URL_RECHERCHE: &str = "https://api.francetravail.io/partenaire/offresdemploi/v2/offres/search";

#[derive(Debug, Clone)]
pub struct Credentials {
    pub client_id: String,
    pub client_secret: String,
}

pub struct FranceTravailSource {
    id: String,
    credentials: Option<Credentials>,
}

impl FranceTravailSource {
    pub fn new(id: impl Into<String>, credentials: Option<Credentials>) -> Self {
        Self {
            id: id.into(),
            credentials,
        }
    }

    async fn jeton(&self, identifiants: &Credentials) -> Result<String, SourceError> {
        let reponse = reqwest::Client::new()
            .post(URL_JETON)
            .form(&[
                ("grant_type", "client_credentials"),
                ("client_id", identifiants.client_id.as_str()),
                ("client_secret", identifiants.client_secret.as_str()),
                ("scope", "api_offresdemploiv2 o2dsoffre"),
            ])
            .send()
            .await
            .map_err(|erreur| SourceError::Network(erreur.to_string()))?;
        if !reponse.status().is_success() {
            return Err(SourceError::Unauthorized);
        }
        let corps: Value = reponse
            .json()
            .await
            .map_err(|erreur| SourceError::Network(erreur.to_string()))?;
        corps
            .get("access_token")
            .and_then(Value::as_str)
            .map(str::to_string)
            .ok_or(SourceError::Unauthorized)
    }
}

fn texte(valeur: &Value, chemin: &[&str]) -> Option<String> {
    let mut courant = valeur;
    for segment in chemin {
        courant = courant.get(segment)?;
    }
    courant
        .as_str()
        .map(str::to_string)
        .filter(|texte| !texte.trim().is_empty())
}

#[async_trait]
impl Source for FranceTravailSource {
    fn id(&self) -> &str {
        &self.id
    }

    async fn fetch(&self, _since: Option<&str>) -> Result<Vec<RawDocument>, SourceError> {
        // Sans identifiants déclarés, on n'appelle rien : la source reste muette
        // plutôt que de tenter un accès non autorisé.
        let Some(identifiants) = &self.credentials else {
            return Err(SourceError::Unauthorized);
        };
        let jeton = self.jeton(identifiants).await?;
        let reponse = reqwest::Client::new()
            .get(URL_RECHERCHE)
            .bearer_auth(jeton)
            .send()
            .await
            .map_err(|erreur| SourceError::Network(erreur.to_string()))?;
        if reponse.status() == reqwest::StatusCode::UNAUTHORIZED {
            return Err(SourceError::Unauthorized);
        }
        let charge = reponse
            .bytes()
            .await
            .map_err(|erreur| SourceError::Network(erreur.to_string()))?
            .to_vec();
        Ok(vec![RawDocument::new(
            &self.id,
            None,
            "application/json",
            charge,
        )])
    }

    fn normalize(&self, raw: &RawDocument) -> Result<Vec<NormalizedOffer>, NormalizeError> {
        let racine: Value = serde_json::from_slice(&raw.payload)
            .map_err(|erreur| NormalizeError(format!("JSON illisible : {erreur}")))?;
        let resultats = racine
            .get("resultats")
            .and_then(Value::as_array)
            .ok_or_else(|| NormalizeError("champ « resultats » absent ou non tableau".into()))?;

        let mut offres = Vec::with_capacity(resultats.len());
        for (index, element) in resultats.iter().enumerate() {
            let mut origins = BTreeMap::new();
            let mut poser = |cle: &str, chemin: &str, valeur: &Option<String>| {
                if valeur.is_some() {
                    origins.insert(cle.to_string(), format!("/resultats/{index}/{chemin}"));
                }
            };

            let title = texte(element, &["intitule"]);
            poser("title", "intitule", &title);
            let company = texte(element, &["entreprise", "nom"]);
            poser("company", "entreprise/nom", &company);
            let location = texte(element, &["lieuTravail", "libelle"]);
            poser("location", "lieuTravail/libelle", &location);
            let description = texte(element, &["description"]);
            poser("description", "description", &description);
            let contract = texte(element, &["typeContrat"]);
            poser("contract", "typeContrat", &contract);
            let url = texte(element, &["origineOffre", "urlOrigine"]);
            poser("url", "origineOffre/urlOrigine", &url);
            let published_at = texte(element, &["dateCreation"]);
            poser("published_at", "dateCreation", &published_at);

            offres.push(NormalizedOffer {
                external_id: texte(element, &["id"]),
                // Un champ absent reste vide et sans origine : jamais comblé.
                title: title.unwrap_or_default(),
                company: company.unwrap_or_default(),
                location: location.unwrap_or_default(),
                contract,
                url,
                description: description.unwrap_or_default(),
                published_at,
                origins,
            });
        }
        Ok(offres)
    }
}
```

Ajouter `pub mod france_travail;` dans `src/sources/mod.rs`.

- [ ] **Step 5: Brancher le connecteur dans l'orchestration**

Dans `services/offers/src/collect.rs`, remplacer la fonction `connecteur` :

```rust
fn connecteur(entree: &SourceEntry) -> Result<Box<dyn Source>, String> {
    match entree.kind {
        SourceKind::File => Ok(Box::new(FileSource::new(
            entree.id.clone(),
            entree.locations.iter().map(PathBuf::from).collect(),
        ))),
        SourceKind::FranceTravail => {
            let identifiants = match (
                std::env::var("OFFERS_FRANCE_TRAVAIL_CLIENT_ID").ok(),
                std::env::var("OFFERS_FRANCE_TRAVAIL_CLIENT_SECRET").ok(),
            ) {
                (Some(client_id), Some(client_secret)) => {
                    Some(crate::sources::france_travail::Credentials {
                        client_id,
                        client_secret,
                    })
                }
                _ => None,
            };
            Ok(Box::new(
                crate::sources::france_travail::FranceTravailSource::new(
                    entree.id.clone(),
                    identifiants,
                ),
            ))
        }
        autre => Err(format!("connecteur {autre:?} pas encore livré")),
    }
}
```

- [ ] **Step 6: Documenter les variables**

Ajouter à `services/offers/.env.example` :

```sh
# Identifiants France Travail. Sans eux, la source déclarée reste muette et le
# rapport de collecte le signale. Ne jamais les journaliser.
OFFERS_FRANCE_TRAVAIL_CLIENT_ID=
OFFERS_FRANCE_TRAVAIL_CLIENT_SECRET=
```

- [ ] **Step 7: Lancer les tests pour vérifier qu'ils passent**

Run: `cd services/offers && cargo test france_travail`
Expected: PASS, 4 tests.

- [ ] **Step 8: Vérification complète**

Run: `cd services/offers && cargo test && cargo fmt --check && cargo clippy --all-targets -- -D warnings`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add services/offers/src services/offers/tests/fixtures services/offers/.env.example
git commit -m "feat(offers): connecteur France Travail, normalisation testée hors ligne"
```

---

### Task 10: Connecteur « flux publiés par les employeurs »

**Files:**
- Create: `services/offers/src/sources/feed.rs`
- Create: `services/offers/tests/fixtures/flux-employeur-synthetique.json`
- Modify: `services/offers/src/sources/mod.rs`
- Modify: `services/offers/src/collect.rs`

**Interfaces:**
- Consumes: `sources::{Source, RawDocument, NormalizedOffer, SourceError, NormalizeError}`.
- Produces: `sources::feed::FeedSource`, `FeedSource::new(id: impl Into<String>, urls: Vec<String>) -> FeedSource`.

Portée volontairement réduite aux flux **JSON** : les ATS courants en publient.
Ajouter un analyseur XML introduirait une dépendance pour un besoin non démontré.

- [ ] **Step 1: Écrire la fixture synthétique**

`services/offers/tests/fixtures/flux-employeur-synthetique.json` :

```json
{
  "jobs": [
    {
      "id": "SYNTH-FEED-001",
      "title": "Développeur Web H/F",
      "company": "Studio Exemple",
      "location": "Paris",
      "absolute_url": "https://exemple.test/carrieres/1",
      "content": "Offre synthétique utilisée uniquement pour les tests.",
      "updated_at": "2026-09-02T09:00:00Z"
    }
  ]
}
```

- [ ] **Step 2: Écrire les tests qui échouent**

À la fin de `services/offers/src/sources/feed.rs` :

```rust
#[cfg(test)]
mod tests {
    use super::*;

    fn document() -> RawDocument {
        let charge = std::fs::read("tests/fixtures/flux-employeur-synthetique.json").unwrap();
        RawDocument::new("flux-exemple", None, "application/json", charge)
    }

    #[test]
    fn normalise_les_postes_du_flux() {
        let source = FeedSource::new("flux-exemple", vec![]);
        let offres = source.normalize(&document()).unwrap();
        assert_eq!(offres.len(), 1);
        assert_eq!(offres[0].external_id.as_deref(), Some("SYNTH-FEED-001"));
        assert_eq!(offres[0].location, "Paris");
        assert_eq!(offres[0].origins.get("title").unwrap(), "/jobs/0/title");
    }

    #[test]
    fn refuse_un_flux_sans_tableau_de_postes() {
        let source = FeedSource::new("flux-exemple", vec![]);
        let brut = RawDocument::new("flux-exemple", None, "application/json", b"{}".to_vec());
        assert!(source.normalize(&brut).unwrap_err().0.contains("jobs"));
    }

    #[tokio::test]
    async fn ne_recupere_que_les_adresses_declarees() {
        let source = FeedSource::new("flux-exemple", vec![]);
        let documents = source.fetch(None).await.unwrap();
        assert!(
            documents.is_empty(),
            "aucune adresse déclarée, donc aucun appel"
        );
    }
}
```

- [ ] **Step 3: Lancer les tests pour vérifier qu'ils échouent**

Run: `cd services/offers && cargo test feed`
Expected: FAIL — `cannot find type FeedSource in this scope`.

- [ ] **Step 4: Écrire le connecteur**

Au début de `services/offers/src/sources/feed.rs` :

```rust
use std::collections::BTreeMap;

use async_trait::async_trait;
use serde_json::Value;

use super::{NormalizeError, NormalizedOffer, RawDocument, Source, SourceError};

pub struct FeedSource {
    id: String,
    urls: Vec<String>,
}

impl FeedSource {
    pub fn new(id: impl Into<String>, urls: Vec<String>) -> Self {
        Self {
            id: id.into(),
            urls,
        }
    }
}

fn texte(element: &Value, cle: &str) -> Option<String> {
    element
        .get(cle)
        .and_then(Value::as_str)
        .map(str::to_string)
        .filter(|valeur| !valeur.trim().is_empty())
}

#[async_trait]
impl Source for FeedSource {
    fn id(&self) -> &str {
        &self.id
    }

    /// Récupère exactement les adresses déclarées. Ne suit aucun lien, ne
    /// découvre aucune page : ce connecteur ne se déplace jamais.
    async fn fetch(&self, _since: Option<&str>) -> Result<Vec<RawDocument>, SourceError> {
        let client = reqwest::Client::new();
        let mut documents = Vec::new();
        for url in &self.urls {
            let reponse = client
                .get(url)
                .send()
                .await
                .map_err(|erreur| SourceError::Network(erreur.to_string()))?;
            if !reponse.status().is_success() {
                return Err(SourceError::Network(format!(
                    "{url} a répondu {}",
                    reponse.status()
                )));
            }
            let charge = reponse
                .bytes()
                .await
                .map_err(|erreur| SourceError::Network(erreur.to_string()))?
                .to_vec();
            documents.push(RawDocument::new(&self.id, None, "application/json", charge));
        }
        Ok(documents)
    }

    fn normalize(&self, raw: &RawDocument) -> Result<Vec<NormalizedOffer>, NormalizeError> {
        let racine: Value = serde_json::from_slice(&raw.payload)
            .map_err(|erreur| NormalizeError(format!("JSON illisible : {erreur}")))?;
        let postes = racine
            .get("jobs")
            .and_then(Value::as_array)
            .ok_or_else(|| NormalizeError("champ « jobs » absent ou non tableau".into()))?;

        let mut offres = Vec::with_capacity(postes.len());
        for (index, element) in postes.iter().enumerate() {
            let mut origins = BTreeMap::new();
            let mut poser = |cle: &str, source: &str, valeur: &Option<String>| {
                if valeur.is_some() {
                    origins.insert(cle.to_string(), format!("/jobs/{index}/{source}"));
                }
            };

            let title = texte(element, "title");
            poser("title", "title", &title);
            let company = texte(element, "company");
            poser("company", "company", &company);
            let location = texte(element, "location");
            poser("location", "location", &location);
            let description = texte(element, "content");
            poser("description", "content", &description);
            let url = texte(element, "absolute_url");
            poser("url", "absolute_url", &url);
            let published_at = texte(element, "updated_at");
            poser("published_at", "updated_at", &published_at);

            offres.push(NormalizedOffer {
                external_id: texte(element, "id"),
                title: title.unwrap_or_default(),
                company: company.unwrap_or_default(),
                location: location.unwrap_or_default(),
                contract: None,
                url,
                description: description.unwrap_or_default(),
                published_at,
                origins,
            });
        }
        Ok(offres)
    }
}
```

Ajouter `pub mod feed;` dans `src/sources/mod.rs`.

- [ ] **Step 5: Brancher le connecteur et retirer la branche « pas encore livré »**

Dans `services/offers/src/collect.rs`, compléter le `match` de `connecteur` :

```rust
        SourceKind::Feed => Ok(Box::new(crate::sources::feed::FeedSource::new(
            entree.id.clone(),
            entree.locations.clone(),
        ))),
```

Le `match` couvre désormais toutes les variantes de `SourceKind` : supprimer le
bras `autre => Err(...)`, que le compilateur signalera comme inatteignable. La
fonction garde son type `Result` pour les tâches futures.

- [ ] **Step 6: Lancer les tests pour vérifier qu'ils passent**

Run: `cd services/offers && cargo test feed`
Expected: PASS, 3 tests.

- [ ] **Step 7: Vérification complète**

Run: `cd services/offers && cargo test && cargo fmt --check && cargo clippy --all-targets -- -D warnings`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add services/offers/src services/offers/tests/fixtures
git commit -m "feat(offers): connecteur de flux employeurs limité aux adresses déclarées"
```

---

### Task 11: Module NestJS de lecture

**Files:**
- Create: `cekarna_website/src/offers/offers.module.ts`
- Create: `cekarna_website/src/offers/offers.service.ts`
- Create: `cekarna_website/src/offers/offers.controller.ts`
- Create: `cekarna_website/src/offers/offers.service.spec.ts`
- Modify: `cekarna_website/src/app.module.ts`
- Modify: `cekarna_website/src/config/environment.ts`
- Modify: `cekarna_website/src/config/environment.spec.ts`
- Modify: `cekarna_website/.env.example`
- Modify: `cekarna_website/README.md`

**Interfaces:**
- Consumes: l'API Rust `GET /v1/offers`, `GET /v1/offers/{id}`.
- Produces: `OffersService.list(query: OffersQuery)`, `OffersService.get(id: string)`, routes NestJS `GET /v1/offers` et `GET /v1/offers/:id`.

`POST /v1/collect` n'est **pas** proxifié : la collecte est une opération
d'exploitation, pas une action du visiteur.

- [ ] **Step 1: Ajouter la configuration**

Dans `cekarna_website/src/config/environment.ts`, étendre `Environment` :

```ts
  /** Adresse du service d'offres, en boucle locale. */
  offersBaseUrl: string;
  /** Jeton partagé avec le service d'offres. Vide = module désactivé. */
  offersInternalToken: string;
```

et dans le `return` de `readEnvironment` :

```ts
    offersBaseUrl: (env.OFFERS_BASE_URL ?? 'http://127.0.0.1:8083').replace(
      /\/$/,
      '',
    ),
    offersInternalToken: env.OFFERS_INTERNAL_TOKEN?.trim() ?? '',
```

Dans `cekarna_website/src/config/environment.spec.ts`, ajouter les deux clés
attendues aux deux assertions `toEqual` existantes :

```ts
      offersBaseUrl: 'http://127.0.0.1:8083',
      offersInternalToken: '',
```

Dans `cekarna_website/.env.example` :

```sh
# Service d'offres (Rust). Le jeton doit valoir OFFERS_INTERNAL_TOKEN du service.
OFFERS_BASE_URL=http://127.0.0.1:8083
OFFERS_INTERNAL_TOKEN=
```

- [ ] **Step 2: Écrire le test du service qui échoue**

`cekarna_website/src/offers/offers.service.spec.ts` :

```ts
import { ServiceUnavailableException } from '@nestjs/common';
import { Environment } from '../config/environment';
import { OffersService } from './offers.service';

const CONFIG: Environment = {
  port: 3000,
  host: '127.0.0.1',
  corsOrigins: [],
  cvImportMaxBytes: 5_000_000,
  cvImportRetentionSeconds: 900,
  offersBaseUrl: 'http://127.0.0.1:8083',
  offersInternalToken: '0123456789abcdef0123456789abcdef',
};

describe('OffersService', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('transmet le jeton interne et les filtres au service Rust', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      new Response(JSON.stringify({ offers: [], next_cursor: null }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    jest.spyOn(globalThis, 'fetch').mockImplementation(fetchMock);

    const service = new OffersService(CONFIG);
    await service.list({ location: 'Lyon' });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:8083/v1/offers?location=Lyon');
    expect((init.headers as Record<string, string>).Authorization).toBe(
      'Bearer 0123456789abcdef0123456789abcdef',
    );
  });

  it('refuse de servir quand aucun jeton n’est configuré', async () => {
    const service = new OffersService({ ...CONFIG, offersInternalToken: '' });
    await expect(service.list({})).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('signale une panne du service d’offres sans exposer son détail', async () => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('ECONNREFUSED 127.0.0.1:8083'));

    const service = new OffersService(CONFIG);
    await expect(service.list({})).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
```

- [ ] **Step 3: Lancer le test pour vérifier qu'il échoue**

Run: `cd cekarna_website && npm test -- offers`
Expected: FAIL — `Cannot find module './offers.service'`.

- [ ] **Step 4: Écrire le service**

`cekarna_website/src/offers/offers.service.ts` :

```ts
import {
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ENVIRONMENT } from '../config/environment';
import type { Environment } from '../config/environment';

export interface OffersQuery {
  q?: string;
  location?: string;
  contract?: string;
  cursor?: string;
  limit?: string;
}

@Injectable()
export class OffersService {
  private readonly logger = new Logger(OffersService.name);

  constructor(@Inject(ENVIRONMENT) private readonly config: Environment) {}

  list(query: OffersQuery): Promise<unknown> {
    const params = new URLSearchParams();
    for (const [clef, valeur] of Object.entries(query))
      if (valeur) params.set(clef, valeur);
    const suffixe = params.size ? `?${params.toString()}` : '';
    return this.call(`/v1/offers${suffixe}`);
  }

  get(id: string): Promise<unknown> {
    return this.call(`/v1/offers/${encodeURIComponent(id)}`);
  }

  private async call(chemin: string): Promise<unknown> {
    if (!this.config.offersInternalToken)
      throw new ServiceUnavailableException(
        'Le service d’offres n’est pas configuré.',
      );

    let response: Response;
    try {
      response = await fetch(`${this.config.offersBaseUrl}${chemin}`, {
        headers: { Authorization: `Bearer ${this.config.offersInternalToken}` },
      });
    } catch (error) {
      // Le détail réseau reste dans les journaux, jamais dans la réponse HTTP.
      this.logger.error(
        error instanceof Error ? error.message : 'appel impossible',
      );
      throw new ServiceUnavailableException(
        'Le service d’offres est injoignable.',
      );
    }

    if (!response.ok) {
      this.logger.error(`service d’offres : statut ${response.status}`);
      throw new ServiceUnavailableException(
        'Le service d’offres a refusé la demande.',
      );
    }
    return response.json();
  }
}
```

- [ ] **Step 5: Écrire le contrôleur et le module**

`cekarna_website/src/offers/offers.controller.ts` :

```ts
import { Controller, Get, Header, Param, Query } from '@nestjs/common';
import { OffersService } from './offers.service';
import type { OffersQuery } from './offers.service';

@Controller('v1/offers')
export class OffersController {
  constructor(private readonly offers: OffersService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  list(@Query() query: OffersQuery): Promise<unknown> {
    return this.offers.list(query);
  }

  @Get(':id')
  @Header('Cache-Control', 'no-store')
  get(@Param('id') id: string): Promise<unknown> {
    return this.offers.get(id);
  }
}
```

`cekarna_website/src/offers/offers.module.ts` :

```ts
import { Module } from '@nestjs/common';
import { ENVIRONMENT, readEnvironment } from '../config/environment';
import { OffersController } from './offers.controller';
import { OffersService } from './offers.service';

@Module({
  controllers: [OffersController],
  providers: [
    OffersService,
    { provide: ENVIRONMENT, useFactory: () => readEnvironment(process.env) },
  ],
  exports: [OffersService],
})
export class OffersModule {}
```

Dans `cekarna_website/src/app.module.ts`, ajouter `OffersModule` aux `imports`.

- [ ] **Step 6: Lancer les tests et la vérification complète**

Run: `cd cekarna_website && npm run check`
Expected: PASS — lint, types, tests unitaires, tests HTTP et compilation.

- [ ] **Step 7: Documenter les routes**

Dans `cekarna_website/README.md`, à la suite des routes existantes :

```markdown
- `GET /v1/offers` : offres collectées et dédupliquées, servies par `services/offers`. Filtres `q`, `location`, `contract`, pagination par curseur.
- `GET /v1/offers/:id` : une offre, l'origine de chacun de ses champs, les membres de son groupe de doublons et les décisions qui les ont réunis.
```

- [ ] **Step 8: Commit**

```bash
git add cekarna_website/src/offers cekarna_website/src/app.module.ts cekarna_website/src/config cekarna_website/.env.example cekarna_website/README.md
git commit -m "feat(api): module de lecture des offres adossé au service Rust"
```

---

### Task 12: Documentation, image de production et alignement du projet

**Files:**
- Create: `services/offers/README.md`
- Create: `services/offers/Dockerfile`
- Modify: `cekarna_website/docs/PROJECT.md`
- Modify: `cekarna_website/docs/B2C.md`

**Interfaces:**
- Consumes: tout ce qui précède.
- Produces: rien de logiciel.

- [ ] **Step 1: Écrire le README du service**

`services/offers/README.md` :

~~~markdown
# Cekarna Offers — Rust / axum

Collecte des offres depuis des sources **explicitement autorisées**, les
déduplique de façon déterministe et les expose en lecture à l'API NestJS.
Deuxième service Rust du dépôt, après `services/notifications`.

## Démarrage local

Prérequis : Rust 1.85 ou supérieur.

```sh
cp .env.example .env   # renseigner OFFERS_INTERNAL_TOKEN
cargo run -- migrate
cargo run -- serve
```

Le service écoute sur `http://127.0.0.1:8083`, uniquement en boucle locale
(8081 est pris par `services/auth`, 8082 par `services/notifications`). La base
SQLite est créée au chemin `OFFERS_DATABASE_PATH`.

## Sources autorisées

`sources.toml` est la liste blanche. **Une source absente de ce fichier n'est
jamais interrogée**, même si son connecteur existe dans le code. Chaque entrée
déclare les conditions d'utilisation acceptées et un intervalle minimal entre
deux appels.

Le connecteur `feed` ne récupère que les adresses listées : il ne suit aucun
lien et ne découvre aucune page. Le connecteur `aggregator` n'est pas livré, il
attend un contrat commercial.

## Commandes

| Commande | Effet |
| --- | --- |
| `offers migrate` | Applique les migrations et s'arrête. |
| `offers collect [--source X]` | Lance une collecte et affiche son rapport. |
| `offers unlock` | Relâche un verrou laissé par un processus interrompu. |
| `offers serve` | Démarre le serveur HTTP. Par défaut. |

## Contrat interne

Toutes les routes hors `/health*` exigent
`Authorization: Bearer <OFFERS_INTERNAL_TOKEN>`. NestJS est le seul client
prévu ; aucun navigateur n'appelle ce service, il n'a donc aucune configuration
CORS.

## Déduplication

Deux règles déterministes, dans cet ordre :

1. `identifiant-source` — même `(source_id, external_id)` : l'annonce est
   recollectée, elle est mise à jour sur place.
2. `empreinte-normalisee` — `sha256(titre|entreprise|lieu)` après
   normalisation : la même annonce vue ailleurs rejoint le groupe existant.

Chaque regroupement écrit sa règle et les valeurs comparées dans
`duplicate_decisions`. Aucun doublon n'est supprimé : l'offre canonique d'un
groupe est la plus ancienne, les autres restent consultables.

La charge brute de chaque source est conservée telle quelle, et chaque champ
normalisé enregistre le chemin de son origine. Un champ que la source ne
fournit pas reste vide ; il n'est jamais comblé.

## Vérification

```sh
cargo fmt --check
cargo test
cargo clippy --all-targets -- -D warnings
```

Aucun test n'appelle le réseau : les connecteurs distants sont testés sur des
charges enregistrées dans `tests/fixtures/`, **synthétiques**. Aucune offre
réelle ni donnée personnelle n'est versionnée.

## Limites

Pas de rapprochement des annonces reformulées : cela demanderait un seuil de
similarité, donc un corpus annoté pour le régler. Pas de planification
automatique : la collecte se déclenche par la commande ou par
`POST /v1/collect`.
~~~

- [ ] **Step 2: Écrire le Dockerfile**

`services/offers/Dockerfile` :

```dockerfile
FROM rust:1.85-slim AS build
WORKDIR /src
COPY Cargo.toml Cargo.lock ./
COPY src ./src
COPY migrations ./migrations
RUN cargo build --release --locked

FROM gcr.io/distroless/cc-debian12
WORKDIR /app
COPY --from=build /src/target/release/offers /app/offers
COPY migrations /app/migrations
COPY sources.toml /app/sources.toml
EXPOSE 8083
USER 65532:65532
ENTRYPOINT ["/app/offers"]
CMD ["serve"]
```

- [ ] **Step 3: Aligner `docs/PROJECT.md`**

Remplacer, dans « Mesures avant montée en charge », la phrase :

> Évaluer un besoin réel avant microservices Rust/Go, Qdrant distribué, Kubernetes ou GPU dédiés.

par :

> Deux services Rust existent : `services/notifications` (file d'envoi des
> emails) et `services/offers` (collecte et déduplication d'offres). Le coût
> d'entrée du langage est payé. Évaluer un besoin réel avant d'ajouter Qdrant
> distribué, Kubernetes ou des GPU dédiés.

Ajouter une section, avant « Mesures avant montée en charge » :

```markdown
## Collecte d'offres — 6 septembre 2026

`services/offers` (Rust, SQLite, axum) collecte des offres depuis une liste
blanche de sources déclarées, les déduplique par deux règles déterministes et
les expose en lecture à NestJS. Spec :
`docs/superpowers/specs/2026-09-06-offers-collecte-deduplication-design.md`.

Coût : un service de plus à exploiter — un binaire, une base SQLite, une
configuration. Rust était déjà présent, le coût du langage était donc déjà payé.
Divergence assumée : `services/notifications` utilise PostgreSQL, ce service
SQLite. Rouvrir la question si un troisième service Rust demande PostgreSQL.

Hors périmètre de cette tranche : comparaison profil/offre évaluée sur corpus,
brouillons de candidature, similarité entre annonces reformulées, planification
automatique.
```

- [ ] **Step 4: Aligner `docs/B2C.md`**

Remplacer l'entrée 4 de la liste des prochaines tranches :

```markdown
4. Collecte d'offres depuis des sources autorisées : livrée dans `services/offers`
   (liste blanche déclarée, déduplication déterministe tracée, lecture via
   `GET /v1/offers`). Reste à faire : la comparaison évaluée sur corpus annoté et
   l'affichage des offres collectées dans `web/`.
```

- [ ] **Step 5: Vérification complète des deux chaînes**

Run:
```bash
cd services/offers && cargo test && cargo fmt --check && cargo clippy --all-targets -- -D warnings
cd ../.. && npm run check:all
```
Expected: PASS des deux côtés.

- [ ] **Step 6: Commit**

```bash
git add services/offers/README.md services/offers/Dockerfile cekarna_website/docs
git commit -m "docs(offers): mode d'emploi du service et alignement de la documentation projet"
```

---

## Vérification finale du plan

Après la tâche 12, l'ensemble doit satisfaire la spec :

- [ ] La collecte n'interroge que des sources déclarées dans `sources.toml`.
- [ ] La charge brute est conservée intacte, et chaque champ normalisé cite son origine.
- [ ] Une offre recollectée est mise à jour, jamais dupliquée.
- [ ] La même annonce vue sur deux sources forme un groupe, avec sa décision écrite.
- [ ] Aucun doublon n'est supprimé ; l'offre canonique est la plus ancienne.
- [ ] Un document illisible est conservé avec sa raison, sans bloquer la collecte.
- [ ] Une source en échec n'interrompt pas les autres ; l'échec total seul sort en erreur.
- [ ] Le service n'écoute qu'en boucle locale et exige le jeton interne hors `/health*`.
- [ ] Aucun test n'appelle le réseau ; aucune donnée réelle n'est versionnée.
- [ ] `cargo fmt --check`, `cargo test`, `cargo clippy --all-targets -- -D warnings` et `npm run check:all` passent.
