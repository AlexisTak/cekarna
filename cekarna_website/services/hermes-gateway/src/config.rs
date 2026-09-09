use std::{net::SocketAddr, time::Duration};

use thiserror::Error;
use url::Url;

#[derive(Clone, Debug)]
pub struct Config {
    pub addr: SocketAddr,
    pub ollama_base_url: String,
    pub internal_token: String,
    pub model: String,
    pub max_concurrency: usize,
    pub timeout: Duration,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum ConfigError {
    #[error("missing required environment variable {0}")]
    Missing(&'static str),
    #[error("invalid environment variable {0}")]
    Invalid(&'static str),
}

impl Config {
    pub fn from_env() -> Result<Self, ConfigError> {
        Self::from_source(|key| std::env::var(key).ok())
    }

    pub fn from_source(read: impl Fn(&'static str) -> Option<String>) -> Result<Self, ConfigError> {
        let addr: SocketAddr = read("HERMES_GATEWAY_ADDR")
            .unwrap_or_else(|| "127.0.0.1:8084".into())
            .parse()
            .map_err(|_| ConfigError::Invalid("HERMES_GATEWAY_ADDR"))?;
        if !addr.ip().is_loopback() && !addr.ip().is_unspecified() {
            return Err(ConfigError::Invalid("HERMES_GATEWAY_ADDR"));
        }
        let raw_url = read("OLLAMA_BASE_URL").unwrap_or_else(|| "http://127.0.0.1:11434".into());
        let parsed = Url::parse(&raw_url).map_err(|_| ConfigError::Invalid("OLLAMA_BASE_URL"))?;
        if !matches!(parsed.scheme(), "http" | "https")
            || !parsed.username().is_empty()
            || parsed.password().is_some()
            || parsed.path() != "/"
            || parsed.query().is_some()
            || parsed.fragment().is_some()
        {
            return Err(ConfigError::Invalid("OLLAMA_BASE_URL"));
        }
        let internal_token = read("HERMES_GATEWAY_TOKEN")
            .filter(|value| !value.trim().is_empty())
            .ok_or(ConfigError::Missing("HERMES_GATEWAY_TOKEN"))?;
        if internal_token.len() < 32 {
            return Err(ConfigError::Invalid("HERMES_GATEWAY_TOKEN"));
        }
        let model = read("HERMES_MODEL")
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| "hermes3:3b".into());
        if model.len() > 128 || model.chars().any(char::is_whitespace) {
            return Err(ConfigError::Invalid("HERMES_MODEL"));
        }
        let max_concurrency = number(&read, "HERMES_MAX_CONCURRENCY", 2, 1, 32)?;
        let timeout_seconds = number(&read, "HERMES_TIMEOUT_SECONDS", 60, 5, 300)?;
        Ok(Self {
            addr,
            ollama_base_url: raw_url.trim_end_matches('/').into(),
            internal_token,
            model,
            max_concurrency,
            timeout: Duration::from_secs(timeout_seconds as u64),
        })
    }
}

fn number(
    read: &impl Fn(&'static str) -> Option<String>,
    key: &'static str,
    default: usize,
    min: usize,
    max: usize,
) -> Result<usize, ConfigError> {
    let value = match read(key) {
        Some(value) if !value.trim().is_empty() => value
            .parse::<usize>()
            .map_err(|_| ConfigError::Invalid(key))?,
        _ => default,
    };
    if !(min..=max).contains(&value) {
        return Err(ConfigError::Invalid(key));
    }
    Ok(value)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn config(values: &[(&'static str, &str)]) -> Result<Config, ConfigError> {
        let values = values.iter().copied().collect::<HashMap<_, _>>();
        Config::from_source(|key| values.get(key).map(|value| (*value).into()))
    }

    #[test]
    fn validates_private_service_configuration() {
        let value = config(&[
            ("HERMES_GATEWAY_TOKEN", "0123456789abcdef0123456789abcdef"),
            ("OLLAMA_BASE_URL", "https://ollama.internal.example"),
            ("HERMES_MAX_CONCURRENCY", "4"),
        ])
        .expect("valid config");
        assert_eq!(value.ollama_base_url, "https://ollama.internal.example");
        assert_eq!(value.max_concurrency, 4);
    }

    #[test]
    fn rejects_missing_secret_and_unsafe_upstream_urls() {
        assert_eq!(
            config(&[]).unwrap_err(),
            ConfigError::Missing("HERMES_GATEWAY_TOKEN")
        );
        assert_eq!(
            config(&[
                ("HERMES_GATEWAY_TOKEN", "0123456789abcdef0123456789abcdef"),
                ("OLLAMA_BASE_URL", "https://user:pass@example.test/api"),
            ])
            .unwrap_err(),
            ConfigError::Invalid("OLLAMA_BASE_URL")
        );
    }
}
