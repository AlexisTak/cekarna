use super::*;
use std::path::PathBuf;
pub struct FileSource {
    id: String,
    paths: Vec<PathBuf>,
}
impl FileSource {
    pub fn new(id: String, paths: Vec<PathBuf>) -> Self {
        Self { id, paths }
    }
}
fn text(v: &serde_json::Value, key: &str) -> Option<String> {
    v.get(key)?
        .as_str()
        .map(str::to_string)
        .filter(|s| !s.trim().is_empty())
}
#[async_trait]
impl Source for FileSource {
    fn id(&self) -> &str {
        &self.id
    }
    async fn fetch(&self, _: Option<&str>) -> Result<Vec<RawDocument>, SourceError> {
        self.paths
            .iter()
            .map(|p| {
                std::fs::read(p)
                    .map(|b| RawDocument::new(&self.id, None, "application/json", b))
                    .map_err(|_| SourceError::Read)
            })
            .collect()
    }
    fn normalize(&self, raw: &RawDocument) -> Result<Vec<NormalizedOffer>, NormalizeError> {
        let list: Vec<serde_json::Value> =
            serde_json::from_slice(&raw.payload).map_err(|e| NormalizeError(e.to_string()))?;
        Ok(list
            .iter()
            .enumerate()
            .map(|(i, v)| {
                let mut origins = BTreeMap::new();
                let mut get = |key: &str| {
                    let result = text(v, key);
                    if result.is_some() {
                        origins.insert(key.into(), format!("/{i}/{key}"));
                    }
                    result
                };
                let external_id = get("id");
                let title = get("title").unwrap_or_default();
                let company = get("company").unwrap_or_default();
                let location = get("location").unwrap_or_default();
                let contract = get("contract");
                let url = get("url");
                let description = get("description").unwrap_or_default();
                let published_at = get("published_at");
                let salary = get("salary");
                let work_duration = get("work_duration");
                let experience = get("experience");
                let qualification = get("qualification");
                let skills = v
                    .get("skills")
                    .and_then(serde_json::Value::as_array)
                    .map(|values| {
                        origins.insert("skills".into(), format!("/{i}/skills"));
                        values
                            .iter()
                            .filter_map(serde_json::Value::as_str)
                            .map(str::to_string)
                            .collect()
                    })
                    .unwrap_or_default();
                let accessible_th = v.get("accessible_th").and_then(serde_json::Value::as_bool);
                if accessible_th.is_some() {
                    origins.insert("accessible_th".into(), format!("/{i}/accessible_th"));
                }
                NormalizedOffer {
                    external_id,
                    title,
                    company,
                    location,
                    contract,
                    url,
                    description,
                    published_at,
                    salary,
                    work_duration,
                    experience,
                    qualification,
                    skills,
                    accessible_th,
                    origins,
                }
            })
            .collect())
    }
}
