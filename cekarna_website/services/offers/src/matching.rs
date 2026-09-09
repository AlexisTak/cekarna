use crate::normalize::norm;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::time::{Duration, Instant};

const MAX_CANDIDATES: usize = 6;
const CACHE_TTL: Duration = Duration::from_secs(15 * 60);
const CACHE_MAX: usize = 1_000;

#[derive(Debug, Default, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ProfessionalEntry {
    #[serde(default)]
    pub role: String,
    #[serde(default)]
    pub employer: String,
    #[serde(default)]
    pub degree: String,
    #[serde(default)]
    pub institution: String,
    #[serde(default)]
    pub description: String,
}

#[derive(Debug, Default, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ProfessionalProfile {
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub city: String,
    #[serde(default)]
    pub contract: String,
    #[serde(default)]
    pub skills: String,
    #[serde(default)]
    pub about: String,
    #[serde(default)]
    pub experiences: Vec<ProfessionalEntry>,
    #[serde(default)]
    pub education: Vec<ProfessionalEntry>,
}

#[derive(Debug, Default, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct MatchFilters {
    #[serde(default)]
    pub q: String,
    #[serde(default)]
    pub location: String,
    #[serde(default)]
    pub contract: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct MatchRequest {
    pub profile: ProfessionalProfile,
    #[serde(default)]
    pub filters: MatchFilters,
}

#[derive(Clone)]
pub struct MatchOffer {
    pub id: String,
    pub title: String,
    pub location: String,
    pub contract: String,
    pub text: String,
    pub version: String,
}

#[derive(Clone)]
pub struct CacheEntry {
    pub created_at: Instant,
    pub inspected: usize,
    pub offer_ids: Vec<String>,
}

pub type MatchCache = HashMap<String, CacheEntry>;

fn tokens(value: &str) -> HashSet<String> {
    norm(value)
        .split(|c: char| !c.is_alphanumeric() && c != '+' && c != '#' && c != '.')
        .filter(|token| token.chars().count() >= 3)
        .filter(|token| !matches!(*token, "avec" | "dans" | "des" | "les" | "une" | "pour"))
        .map(str::to_owned)
        .collect()
}

fn overlap(left: &HashSet<String>, right: &HashSet<String>) -> usize {
    left.intersection(right).count()
}

fn profile_text(profile: &ProfessionalProfile) -> String {
    let entries = profile
        .experiences
        .iter()
        .chain(&profile.education)
        .flat_map(|entry| {
            [
                entry.role.as_str(),
                entry.employer.as_str(),
                entry.degree.as_str(),
                entry.institution.as_str(),
                entry.description.as_str(),
            ]
        })
        .collect::<Vec<_>>()
        .join(" ");
    format!(
        "{} {} {} {} {} {}",
        profile.title, profile.city, profile.contract, profile.skills, profile.about, entries
    )
}

pub fn cache_key(request: &MatchRequest, offers: &[MatchOffer]) -> String {
    let mut hash = Sha256::new();
    hash.update(serde_json::to_vec(request).unwrap_or_default());
    for offer in offers {
        hash.update([0]);
        hash.update(offer.id.as_bytes());
        hash.update([0]);
        hash.update(offer.version.as_bytes());
    }
    format!("{:x}", hash.finalize())
}

pub fn select(request: &MatchRequest, offers: &[MatchOffer]) -> (usize, Vec<String>) {
    let query = norm(&request.filters.q);
    let location_filter = norm(&request.filters.location);
    let contract_filter = norm(&request.filters.contract);
    let filtered = offers
        .iter()
        .filter(|offer| query.is_empty() || norm(&offer.text).contains(&query))
        .filter(|offer| {
            location_filter.is_empty() || norm(&offer.location).contains(&location_filter)
        })
        .filter(|offer| contract_filter.is_empty() || norm(&offer.contract) == contract_filter)
        .collect::<Vec<_>>();
    let inspected = filtered.len();
    let all_profile_tokens = tokens(&profile_text(&request.profile));
    let title_tokens = tokens(&request.profile.title);
    let city = norm(&request.profile.city);
    let contract = norm(&request.profile.contract);
    let mut scored = filtered
        .into_iter()
        .enumerate()
        .map(|(index, offer)| {
            let offer_tokens = tokens(&offer.text);
            let mut score = overlap(&all_profile_tokens, &offer_tokens);
            score += overlap(&title_tokens, &tokens(&offer.title)) * 3;
            if !city.is_empty() && norm(&offer.location).contains(&city) {
                score += 6;
            }
            if !contract.is_empty() && norm(&offer.contract) == contract {
                score += 4;
            }
            (offer.id.clone(), score, index)
        })
        .collect::<Vec<_>>();
    scored.sort_by_key(|(_, score, index)| (std::cmp::Reverse(*score), *index));
    (
        inspected,
        scored
            .into_iter()
            .filter(|(_, score, _)| *score > 0)
            .take(MAX_CANDIDATES)
            .map(|(id, _, _)| id)
            .collect(),
    )
}

pub fn cached(cache: &mut MatchCache, key: &str) -> Option<CacheEntry> {
    let now = Instant::now();
    cache.retain(|_, entry| now.duration_since(entry.created_at) < CACHE_TTL);
    cache.get(key).cloned()
}

pub fn insert(cache: &mut MatchCache, key: String, inspected: usize, offer_ids: Vec<String>) {
    if cache.len() >= CACHE_MAX {
        if let Some(oldest) = cache
            .iter()
            .min_by_key(|(_, entry)| entry.created_at)
            .map(|(key, _)| key.clone())
        {
            cache.remove(&oldest);
        }
    }
    cache.insert(
        key,
        CacheEntry {
            created_at: Instant::now(),
            inspected,
            offer_ids,
        },
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ranks_matching_offer_and_filters_unrelated_items() {
        let request = MatchRequest {
            profile: ProfessionalProfile {
                title: "Développeuse React".into(),
                city: "Lyon".into(),
                contract: "CDI".into(),
                skills: "TypeScript React".into(),
                ..Default::default()
            },
            filters: MatchFilters::default(),
        };
        let offers = vec![
            MatchOffer {
                id: "other".into(),
                title: "Comptable".into(),
                location: "Paris".into(),
                contract: "CDD".into(),
                text: "Comptable finance".into(),
                version: "1".into(),
            },
            MatchOffer {
                id: "match".into(),
                title: "Développeuse React".into(),
                location: "Lyon".into(),
                contract: "CDI".into(),
                text: "React TypeScript Lyon CDI".into(),
                version: "1".into(),
            },
        ];
        let (inspected, ids) = select(&request, &offers);
        assert_eq!(inspected, 2);
        assert_eq!(ids, ["match"]);
    }

    #[test]
    fn fingerprint_changes_with_profile_or_offer_version() {
        let mut request = MatchRequest {
            profile: ProfessionalProfile {
                title: "Rust".into(),
                ..Default::default()
            },
            filters: MatchFilters::default(),
        };
        let mut offers = vec![MatchOffer {
            id: "1".into(),
            title: "Rust".into(),
            location: String::new(),
            contract: String::new(),
            text: "Rust".into(),
            version: "v1".into(),
        }];
        let first = cache_key(&request, &offers);
        request.profile.title = "React".into();
        assert_ne!(first, cache_key(&request, &offers));
        request.profile.title = "Rust".into();
        offers[0].version = "v2".into();
        assert_ne!(first, cache_key(&request, &offers));
    }
}
