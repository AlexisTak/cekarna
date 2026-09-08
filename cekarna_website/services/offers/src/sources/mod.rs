pub mod feed;
pub mod file;
pub mod france_travail;
use async_trait::async_trait;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::{collections::BTreeMap, path::Path};
use thiserror::Error;

#[derive(Debug, Clone)]
pub struct RawDocument {
    pub source_id: String,
    pub external_id: Option<String>,
    pub content_type: String,
    pub payload: Vec<u8>,
    pub sha256: String,
}
impl RawDocument {
    pub fn new(
        source_id: &str,
        external_id: Option<String>,
        content_type: &str,
        payload: Vec<u8>,
    ) -> Self {
        let sha256 = format!("{:x}", Sha256::digest(&payload));
        Self {
            source_id: source_id.into(),
            external_id,
            content_type: content_type.into(),
            payload,
            sha256,
        }
    }
}
#[derive(Debug, Clone)]
pub struct NormalizedOffer {
    pub external_id: Option<String>,
    pub title: String,
    pub company: String,
    pub location: String,
    pub contract: Option<String>,
    pub url: Option<String>,
    pub description: String,
    pub published_at: Option<String>,
    pub salary: Option<String>,
    pub work_duration: Option<String>,
    pub experience: Option<String>,
    pub qualification: Option<String>,
    pub skills: Vec<String>,
    pub accessible_th: Option<bool>,
    pub origins: BTreeMap<String, String>,
}
#[derive(Debug, Error)]
#[error("document non normalisable: {0}")]
pub struct NormalizeError(pub String);
#[derive(Debug, Error)]
pub enum SourceError {
    #[error("identifiants absents ou refusés")]
    Unauthorized,
    #[error("réseau indisponible")]
    Network,
    #[error("lecture impossible")]
    Read,
}
#[async_trait]
pub trait Source: Send + Sync {
    fn id(&self) -> &str;
    async fn fetch(&self, since: Option<&str>) -> Result<Vec<RawDocument>, SourceError>;
    fn normalize(&self, raw: &RawDocument) -> Result<Vec<NormalizedOffer>, NormalizeError>;
}
#[derive(Debug, Clone, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum SourceKind {
    File,
    Feed,
    FranceTravail,
}
#[derive(Debug, Clone, Deserialize)]
pub struct SourceEntry {
    pub id: String,
    pub kind: SourceKind,
    pub terms: String,
    pub enabled: bool,
    pub min_interval_seconds: u64,
    #[serde(default)]
    pub locations: Vec<String>,
}
#[derive(Deserialize)]
struct SourceFile {
    source: Vec<SourceEntry>,
}
#[derive(Clone)]
pub struct Registry {
    entries: Vec<SourceEntry>,
}
impl Registry {
    pub fn load(path: &Path) -> anyhow::Result<Self> {
        let content = std::fs::read_to_string(path)?;
        let parsed: SourceFile = toml::from_str(&content)?;
        for e in &parsed.source {
            if e.id.trim().is_empty() || e.terms.trim().is_empty() {
                anyhow::bail!("source incomplète");
            }
        }
        Ok(Self {
            entries: parsed.source,
        })
    }
    pub fn enabled(&self) -> Vec<&SourceEntry> {
        self.entries.iter().filter(|e| e.enabled).collect()
    }
    pub fn entries(&self) -> &[SourceEntry] {
        &self.entries
    }
}
