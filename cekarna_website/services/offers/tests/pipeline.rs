use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use cekarna_offers::{
    collect,
    http::{self, AppState},
    sources::Registry,
    store,
};
use std::{fs, path::Path, sync::Arc};
use tempfile::TempDir;
use tower::ServiceExt;

async fn setup(files: &[(&str, &str)]) -> (TempDir, sqlx::SqlitePool, Registry) {
    let dir = tempfile::tempdir().unwrap();
    let mut toml = String::new();
    for (name, content) in files {
        let path = dir.path().join(format!("{name}.json"));
        fs::write(&path, content).unwrap();
        toml.push_str(&format!("[[source]]\nid=\"{name}\"\nkind=\"file\"\nterms=\"fixture synthétique\"\nenabled=true\nmin_interval_seconds=0\nlocations=[\"{}\"]\n",path.display().to_string().replace('\\',"\\\\")));
    }
    let sources = dir.path().join("sources.toml");
    fs::write(&sources, toml).unwrap();
    let pool = store::connect(&dir.path().join("offers.db")).await.unwrap();
    store::migrate(&pool).await.unwrap();
    (dir, pool, Registry::load(&sources).unwrap())
}
const ONE: &str = r#"[{"id":"ONE","title":"Développeur (H/F)","company":"Exemple SAS","location":"Lyon","contract":"CDI","description":"Synthétique"}]"#;

#[tokio::test]
async fn recollection_updates_without_duplicate() {
    let (_d, pool, registry) = setup(&[("a", ONE)]).await;
    let first = collect::run(&pool, &registry, None).await.unwrap();
    assert_eq!(first.sources[0].created, 1);
    let second = collect::run(&pool, &registry, None).await.unwrap();
    assert_eq!(second.sources[0].updated, 1);
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM offers")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count, 1);
}

#[tokio::test]
async fn groups_identical_cross_source_and_traces_decisions() {
    let other = ONE.replace("\"ONE\"", "\"TWO\"");
    let (_d, pool, registry) = setup(&[("a", ONE), ("b", &other)]).await;
    collect::run(&pool, &registry, None).await.unwrap();
    let groups: i64 = sqlx::query_scalar("SELECT count(DISTINCT group_id) FROM offers")
        .fetch_one(&pool)
        .await
        .unwrap();
    let decisions: i64 = sqlx::query_scalar("SELECT count(*) FROM duplicate_decisions")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(groups, 1);
    assert_eq!(decisions, 2);
}

#[tokio::test]
async fn invalid_raw_is_kept_without_retracting_the_last_valid_offer() {
    let (dir, pool, registry) = setup(&[("a", ONE)]).await;
    collect::run(&pool, &registry, None).await.unwrap();
    let file = dir.path().join("a.json");
    fs::write(&file, "not-json").unwrap();
    let report = collect::run(&pool, &registry, None).await.unwrap();
    assert_eq!(report.sources[0].rejected, 1);
    let raw: i64 =
        sqlx::query_scalar("SELECT count(*) FROM raw_documents WHERE normalize_error IS NOT NULL")
            .fetch_one(&pool)
            .await
            .unwrap();
    let active: i64 = sqlx::query_scalar("SELECT count(*) FROM offers WHERE active=1")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(raw, 1);
    assert_eq!(active, 1);
}

#[tokio::test]
async fn a_complete_empty_collection_retracts_a_missing_offer() {
    let (dir, pool, registry) = setup(&[("a", ONE)]).await;
    collect::run(&pool, &registry, None).await.unwrap();
    fs::write(dir.path().join("a.json"), "[]").unwrap();
    let report = collect::run(&pool, &registry, None).await.unwrap();
    assert!(report.sources[0].error.is_none());
    let active: i64 = sqlx::query_scalar("SELECT count(*) FROM offers WHERE active=1")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(active, 0);
}

#[tokio::test]
async fn http_requires_token_and_lists_canonical_offers() {
    let (_d, pool, registry) = setup(&[("a", ONE)]).await;
    collect::run(&pool, &registry, None).await.unwrap();
    let app = http::router(AppState {
        pool,
        token: Arc::new("0123456789abcdef0123456789abcdef".into()),
        registry: Arc::new(registry),
    });
    let unauthorized = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/v1/offers")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(unauthorized.status(), StatusCode::UNAUTHORIZED);
    let ok = app
        .oneshot(
            Request::builder()
                .uri("/v1/offers?q=developpeur&location=Lyon&contract=CDI")
                .header("Authorization", "Bearer 0123456789abcdef0123456789abcdef")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(ok.status(), StatusCode::OK);
    let bytes = axum::body::to_bytes(ok.into_body(), usize::MAX)
        .await
        .unwrap();
    let page: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(page["offers"].as_array().unwrap().len(), 1);
}

#[tokio::test]
async fn refuses_a_source_outside_the_allowlist() {
    let (_d, pool, registry) = setup(&[("a", ONE)]).await;
    let error = collect::run(&pool, &registry, Some("undeclared"))
        .await
        .unwrap_err();
    assert!(error.to_string().contains("liste blanche"));
}

#[test]
fn france_travail_fixture_is_synthetic_and_normalized() {
    use cekarna_offers::sources::{RawDocument, Source, france_travail::FranceTravailSource};
    let bytes = fs::read(Path::new("tests/fixtures/france-travail-synthetique.json")).unwrap();
    let source = FranceTravailSource::new("france-travail".into(), None);
    let offers = source
        .normalize(&RawDocument::new(
            "france-travail",
            None,
            "application/json",
            bytes,
        ))
        .unwrap();
    assert_eq!(offers[0].external_id.as_deref(), Some("SYNTH-FT-001"));
    assert_eq!(offers[0].origins["company"], "/resultats/0/entreprise/nom");
    assert_eq!(
        offers[0].salary.as_deref(),
        Some("Annuel de 35000 à 42000 euros")
    );
    assert_eq!(offers[0].skills, ["TypeScript", "React"]);
    assert_eq!(offers[0].accessible_th, Some(true));
}
