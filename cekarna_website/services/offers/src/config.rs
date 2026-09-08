use std::{net::SocketAddr, path::PathBuf};
use thiserror::Error;

#[derive(Clone)]
pub struct Config {
    pub addr: SocketAddr,
    pub database_path: PathBuf,
    pub internal_token: String,
    pub sources_path: PathBuf,
}
#[derive(Debug, Error)]
pub enum ConfigError {
    #[error("variable requise absente: {0}")]
    Missing(&'static str),
    #[error("configuration invalide: {0}")]
    Invalid(&'static str),
}
impl Config {
    pub fn from_env() -> Result<Self, ConfigError> {
        Self::from_source(|k| std::env::var(k).ok())
    }
    pub fn from_source(read: impl Fn(&'static str) -> Option<String>) -> Result<Self, ConfigError> {
        let addr: SocketAddr = read("OFFERS_ADDR")
            .unwrap_or_else(|| "127.0.0.1:8083".into())
            .parse()
            .map_err(|_| ConfigError::Invalid("OFFERS_ADDR"))?;
        if !addr.ip().is_loopback() && !addr.ip().is_unspecified() {
            return Err(ConfigError::Invalid("OFFERS_ADDR"));
        }
        let internal_token =
            read("OFFERS_INTERNAL_TOKEN").ok_or(ConfigError::Missing("OFFERS_INTERNAL_TOKEN"))?;
        if internal_token.len() < 32 {
            return Err(ConfigError::Invalid("OFFERS_INTERNAL_TOKEN"));
        }
        Ok(Self {
            addr,
            database_path: read("OFFERS_DATABASE_PATH")
                .unwrap_or_else(|| "offers.db".into())
                .into(),
            internal_token,
            sources_path: read("OFFERS_SOURCES_PATH")
                .unwrap_or_else(|| "sources.toml".into())
                .into(),
        })
    }
}
