use super::*;
use serde_json::Value;
pub struct FeedSource {
    id: String,
    urls: Vec<String>,
}
impl FeedSource {
    pub fn new(id: String, urls: Vec<String>) -> Self {
        Self { id, urls }
    }
}
fn value(v: &Value, key: &str) -> Option<String> {
    v.get(key)?
        .as_str()
        .map(str::to_string)
        .filter(|s| !s.trim().is_empty())
}
#[async_trait]
impl Source for FeedSource {
    fn id(&self) -> &str {
        &self.id
    }
    async fn fetch(&self, _: Option<&str>) -> Result<Vec<RawDocument>, SourceError> {
        let client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|_| SourceError::Network)?;
        let mut documents = Vec::new();
        for url in &self.urls {
            let parsed = reqwest::Url::parse(url).map_err(|_| SourceError::Network)?;
            if parsed.scheme() != "https" {
                return Err(SourceError::Network);
            }
            let response = client
                .get(parsed)
                .send()
                .await
                .map_err(|_| SourceError::Network)?;
            if !response.status().is_success() {
                return Err(SourceError::Network);
            }
            documents.push(RawDocument::new(
                &self.id,
                None,
                "application/json",
                response
                    .bytes()
                    .await
                    .map_err(|_| SourceError::Network)?
                    .to_vec(),
            ));
        }
        Ok(documents)
    }
    fn normalize(&self, raw: &RawDocument) -> Result<Vec<NormalizedOffer>, NormalizeError> {
        let root: Value =
            serde_json::from_slice(&raw.payload).map_err(|e| NormalizeError(e.to_string()))?;
        let rows = root
            .get("jobs")
            .and_then(Value::as_array)
            .ok_or_else(|| NormalizeError("jobs absent".into()))?;
        Ok(rows
            .iter()
            .enumerate()
            .map(|(i, v)| {
                let mut origins = BTreeMap::new();
                let mut get = |key: &str| {
                    let found = value(v, key);
                    if found.is_some() {
                        origins.insert(key.into(), format!("/jobs/{i}/{key}"));
                    }
                    found
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
                    .and_then(Value::as_array)
                    .map(|values| {
                        origins.insert("skills".into(), format!("/jobs/{i}/skills"));
                        values
                            .iter()
                            .filter_map(Value::as_str)
                            .map(str::to_string)
                            .collect()
                    })
                    .unwrap_or_default();
                let accessible_th = v.get("accessible_th").and_then(Value::as_bool);
                if accessible_th.is_some() {
                    origins.insert("accessible_th".into(), format!("/jobs/{i}/accessible_th"));
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
