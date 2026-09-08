use super::*;
use serde_json::Value;
const TOKEN_URL: &str =
    "https://entreprise.francetravail.fr/connexion/oauth2/access_token?realm=%2Fpartenaire";
const SEARCH_URL: &str = "https://api.francetravail.io/partenaire/offresdemploi/v2/offres/search";
#[derive(Clone)]
pub struct Credentials {
    pub client_id: String,
    pub client_secret: String,
}
pub struct FranceTravailSource {
    id: String,
    credentials: Option<Credentials>,
}
impl FranceTravailSource {
    pub fn new(id: String, credentials: Option<Credentials>) -> Self {
        Self { id, credentials }
    }
    async fn token(&self, c: &Credentials) -> Result<String, SourceError> {
        let r = reqwest::Client::new()
            .post(TOKEN_URL)
            .form(&[
                ("grant_type", "client_credentials"),
                ("client_id", &c.client_id),
                ("client_secret", &c.client_secret),
                ("scope", "api_offresdemploiv2 o2dsoffre"),
            ])
            .send()
            .await
            .map_err(|_| SourceError::Network)?;
        if !r.status().is_success() {
            return Err(SourceError::Unauthorized);
        }
        r.json::<Value>()
            .await
            .map_err(|_| SourceError::Network)?
            .get("access_token")
            .and_then(Value::as_str)
            .map(str::to_string)
            .ok_or(SourceError::Unauthorized)
    }
}
fn at(v: &Value, path: &[&str]) -> Option<String> {
    let mut x = v;
    for p in path {
        x = x.get(p)?;
    }
    x.as_str()
        .map(str::to_string)
        .filter(|s| !s.trim().is_empty())
}
#[async_trait]
impl Source for FranceTravailSource {
    fn id(&self) -> &str {
        &self.id
    }
    async fn fetch(&self, _: Option<&str>) -> Result<Vec<RawDocument>, SourceError> {
        let c = self.credentials.as_ref().ok_or(SourceError::Unauthorized)?;
        let token = self.token(c).await?;
        let r = reqwest::Client::new()
            .get(SEARCH_URL)
            .bearer_auth(token)
            .header("Range", "0-149")
            .send()
            .await
            .map_err(|_| SourceError::Network)?;
        if !r.status().is_success() {
            return Err(SourceError::Network);
        }
        let bytes = r.bytes().await.map_err(|_| SourceError::Network)?.to_vec();
        Ok(vec![RawDocument::new(
            &self.id,
            None,
            "application/json",
            bytes,
        )])
    }
    fn normalize(&self, raw: &RawDocument) -> Result<Vec<NormalizedOffer>, NormalizeError> {
        let root: Value =
            serde_json::from_slice(&raw.payload).map_err(|e| NormalizeError(e.to_string()))?;
        let rows = root
            .get("resultats")
            .and_then(Value::as_array)
            .ok_or_else(|| NormalizeError("resultats absent".into()))?;
        Ok(rows
            .iter()
            .enumerate()
            .map(|(i, v)| {
                let mut origins = BTreeMap::new();
                let mut field = |name: &str, path: &[&str]| {
                    let value = at(v, path);
                    if value.is_some() {
                        origins.insert(name.into(), format!("/resultats/{i}/{}", path.join("/")));
                    }
                    value
                };
                let external_id = field("external_id", &["id"]);
                let title = field("title", &["intitule"]).unwrap_or_default();
                let company = field("company", &["entreprise", "nom"]).unwrap_or_default();
                let location = field("location", &["lieuTravail", "libelle"]).unwrap_or_default();
                let contract = field("contract", &["typeContrat"]);
                let url = field("url", &["origineOffre", "urlOrigine"]);
                let description = field("description", &["description"]).unwrap_or_default();
                let published_at = field("published_at", &["dateCreation"]);
                let salary = field("salary", &["salaire", "libelle"]);
                let work_duration = field("work_duration", &["dureeTravailLibelle"]);
                let experience = field("experience", &["experienceLibelle"]);
                let qualification = field("qualification", &["qualificationLibelle"]);
                let skills = v
                    .get("competences")
                    .and_then(Value::as_array)
                    .map(|values| {
                        origins.insert("skills".into(), format!("/resultats/{i}/competences"));
                        values
                            .iter()
                            .filter_map(|value| at(value, &["libelle"]))
                            .collect()
                    })
                    .unwrap_or_default();
                let accessible_th = v.get("accessibleTH").and_then(Value::as_bool);
                if accessible_th.is_some() {
                    origins.insert(
                        "accessible_th".into(),
                        format!("/resultats/{i}/accessibleTH"),
                    );
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
