use crate::{
    normalize::{fingerprint, norm},
    sources::{
        Registry, Source, SourceEntry, SourceKind,
        file::FileSource,
        france_travail::{Credentials, FranceTravailSource},
    },
    store,
};
use serde::Serialize;
use serde_json::json;
use sqlx::SqlitePool;
use std::path::PathBuf;
use time::OffsetDateTime;
use uuid::Uuid;

#[derive(Debug, Default, Serialize)]
pub struct SourceReport {
    pub source_id: String,
    pub documents: u64,
    pub created: u64,
    pub updated: u64,
    pub grouped: u64,
    pub rejected: u64,
    pub skipped: bool,
    pub error: Option<String>,
}
#[derive(Debug, Default, Serialize)]
pub struct CollectionReport {
    pub sources: Vec<SourceReport>,
}
fn now() -> String {
    OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_default()
}
fn connector(entry: &SourceEntry) -> Box<dyn Source> {
    match entry.kind {
        SourceKind::File => Box::new(FileSource::new(
            entry.id.clone(),
            entry.locations.iter().map(PathBuf::from).collect(),
        )),
        SourceKind::Feed => Box::new(crate::sources::feed::FeedSource::new(
            entry.id.clone(),
            entry.locations.clone(),
        )),
        SourceKind::FranceTravail => {
            let credentials = match (
                std::env::var("OFFERS_FRANCE_TRAVAIL_CLIENT_ID"),
                std::env::var("OFFERS_FRANCE_TRAVAIL_CLIENT_SECRET"),
            ) {
                (Ok(client_id), Ok(client_secret))
                    if !client_id.is_empty() && !client_secret.is_empty() =>
                {
                    Some(Credentials {
                        client_id,
                        client_secret,
                    })
                }
                _ => None,
            };
            Box::new(FranceTravailSource::new(entry.id.clone(), credentials))
        }
    }
}
pub async fn run(
    pool: &SqlitePool,
    registry: &Registry,
    selected: Option<&str>,
) -> anyhow::Result<CollectionReport> {
    store::migrate(pool).await?;
    let lock = sqlx::query("INSERT INTO collection_lock(name,acquired_at) VALUES('collect',?1)")
        .bind(now())
        .execute(pool)
        .await;
    if lock.is_err() {
        anyhow::bail!("une collecte est déjà en cours");
    }
    let result = run_locked(pool, registry, selected).await;
    let _ = sqlx::query("DELETE FROM collection_lock WHERE name='collect'")
        .execute(pool)
        .await;
    result
}
async fn run_locked(
    pool: &SqlitePool,
    registry: &Registry,
    selected: Option<&str>,
) -> anyhow::Result<CollectionReport> {
    if let Some(id) = selected {
        if !registry.enabled().iter().any(|entry| entry.id == id) {
            anyhow::bail!("source absente ou désactivée dans la liste blanche");
        }
    }
    let mut report = CollectionReport::default();
    for entry in registry
        .enabled()
        .into_iter()
        .filter(|e| selected.is_none_or(|id| id == e.id))
    {
        let mut item = SourceReport {
            source_id: entry.id.clone(),
            ..Default::default()
        };
        let recent:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM source_runs WHERE source_id=?1 AND last_completed_at IS NOT NULL AND (julianday('now')-julianday(last_completed_at))*86400 < ?2)").bind(&entry.id).bind(entry.min_interval_seconds as i64).fetch_one(pool).await?;
        if recent {
            item.skipped = true;
            report.sources.push(item);
            continue;
        }
        sqlx::query("INSERT INTO source_runs(source_id,last_started_at,last_error) VALUES(?1,?2,NULL) ON CONFLICT(source_id) DO UPDATE SET last_started_at=excluded.last_started_at,last_error=NULL").bind(&entry.id).bind(now()).execute(pool).await?;
        let source = connector(entry);
        let documents = match source.fetch(None).await {
            Ok(v) => v,
            Err(e) => {
                item.error = Some(e.to_string());
                sqlx::query("UPDATE source_runs SET last_error=?2 WHERE source_id=?1")
                    .bind(&entry.id)
                    .bind("source_unavailable")
                    .execute(pool)
                    .await?;
                report.sources.push(item);
                continue;
            }
        };
        let collection_stamp = now();
        let mut complete = true;
        for raw in documents {
            item.documents += 1;
            let raw_id = Uuid::now_v7().to_string();
            sqlx::query("INSERT INTO raw_documents(id,source_id,external_id,fetched_at,content_type,payload,payload_sha256) VALUES(?1,?2,?3,?4,?5,?6,?7)").bind(&raw_id).bind(&raw.source_id).bind(&raw.external_id).bind(now()).bind(&raw.content_type).bind(&raw.payload).bind(&raw.sha256).execute(pool).await?;
            let offers = match source.normalize(&raw) {
                Ok(v) => v,
                Err(_) => {
                    complete = false;
                    item.rejected += 1;
                    sqlx::query(
                        "UPDATE raw_documents SET normalize_error='invalid_document' WHERE id=?1",
                    )
                    .bind(&raw_id)
                    .execute(pool)
                    .await?;
                    continue;
                }
            };
            for offer in offers {
                if offer.title.trim().is_empty() {
                    complete = false;
                    item.rejected += 1;
                    continue;
                }
                let fp = fingerprint(&offer.title, &offer.company, &offer.location);
                let search_text = norm(&format!(
                    "{} {} {} {}",
                    offer.title, offer.company, offer.location, offer.description
                ));
                let location_normalized = norm(&offer.location);
                let origins = serde_json::to_string(&offer.origins)?;
                let skills_json = serde_json::to_string(&offer.skills)?;
                if let Some(external) = &offer.external_id {
                    let existing: Option<(String, String)> = sqlx::query_as(
                        "SELECT id,group_id FROM offers WHERE source_id=?1 AND external_id=?2",
                    )
                    .bind(&entry.id)
                    .bind(external)
                    .fetch_optional(pool)
                    .await?;
                    if let Some((id, group)) = existing {
                        sqlx::query("UPDATE offers SET raw_document_id=?2,title=?3,company=?4,location=?5,contract=?6,url=?7,description=?8,published_at=?9,fingerprint=?10,origins=?11,last_seen_at=?12,active=1,search_text=?13,location_normalized=?14,salary=?15,work_duration=?16,experience=?17,qualification=?18,skills_json=?19,accessible_th=?20 WHERE id=?1").bind(&id).bind(&raw_id).bind(&offer.title).bind(&offer.company).bind(&offer.location).bind(&offer.contract).bind(&offer.url).bind(&offer.description).bind(&offer.published_at).bind(&fp).bind(&origins).bind(&collection_stamp).bind(&search_text).bind(&location_normalized).bind(&offer.salary).bind(&offer.work_duration).bind(&offer.experience).bind(&offer.qualification).bind(&skills_json).bind(offer.accessible_th).execute(pool).await?;
                        sqlx::query("INSERT INTO duplicate_decisions(offer_id,group_id,rule,compared,decided_at) VALUES(?1,?2,'identifiant-source',?3,?4)").bind(id).bind(group).bind(json!({"source_id":entry.id,"external_id":external}).to_string()).bind(now()).execute(pool).await?;
                        item.updated += 1;
                        continue;
                    }
                }
                let existing_group:Option<String>=sqlx::query_scalar("SELECT group_id FROM offers WHERE fingerprint=?1 ORDER BY first_seen_at,id LIMIT 1").bind(&fp).fetch_optional(pool).await?;
                let grouped = existing_group.is_some();
                let group = existing_group.unwrap_or_else(|| Uuid::now_v7().to_string());
                let id = Uuid::now_v7().to_string();
                let stamp = collection_stamp.clone();
                sqlx::query("INSERT INTO offers(id,raw_document_id,source_id,external_id,title,company,location,contract,url,description,published_at,fingerprint,search_text,location_normalized,salary,work_duration,experience,qualification,skills_json,accessible_th,group_id,origins,first_seen_at,last_seen_at,active) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22,?23,?23,1)").bind(&id).bind(&raw_id).bind(&entry.id).bind(&offer.external_id).bind(&offer.title).bind(&offer.company).bind(&offer.location).bind(&offer.contract).bind(&offer.url).bind(&offer.description).bind(&offer.published_at).bind(&fp).bind(&search_text).bind(&location_normalized).bind(&offer.salary).bind(&offer.work_duration).bind(&offer.experience).bind(&offer.qualification).bind(&skills_json).bind(offer.accessible_th).bind(&group).bind(origins).bind(&stamp).execute(pool).await?;
                sqlx::query("INSERT INTO duplicate_decisions(offer_id,group_id,rule,compared,decided_at) VALUES(?1,?2,?3,?4,?5)").bind(&id).bind(&group).bind(if grouped{"empreinte-normalisee"}else{"nouvelle-offre"}).bind(json!({"fingerprint":fp}).to_string()).bind(stamp).execute(pool).await?;
                item.created += 1;
                if grouped {
                    item.grouped += 1;
                }
            }
        }
        if complete {
            sqlx::query("UPDATE offers SET active=0 WHERE source_id=?1 AND last_seen_at<>?2")
                .bind(&entry.id)
                .bind(&collection_stamp)
                .execute(pool)
                .await?;
            sqlx::query(
                "UPDATE source_runs SET last_completed_at=?2,last_error=NULL WHERE source_id=?1",
            )
            .bind(&entry.id)
            .bind(now())
            .execute(pool)
            .await?;
        } else {
            item.error = Some("document_invalide".into());
            sqlx::query("UPDATE source_runs SET last_error='invalid_document' WHERE source_id=?1")
                .bind(&entry.id)
                .execute(pool)
                .await?;
        }
        report.sources.push(item);
    }
    Ok(report)
}
