use std::{env, net::SocketAddr, time::Duration};

use lettre::message::Mailbox;
use thiserror::Error;

#[derive(Debug, Clone)]
pub struct Config {
    pub addr: SocketAddr,
    pub database_url: String,
    pub internal_token: String,
    pub smtp: SmtpConfig,
    pub max_attempts: i32,
    pub retry_delay: Duration,
    pub retention_days: i64,
}

#[derive(Debug, Clone)]
pub struct SmtpConfig {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: String,
    pub from: Mailbox,
    pub security: SmtpSecurity,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SmtpSecurity {
    StartTls,
    PlainDevelopment,
}

#[derive(Debug, Error)]
pub enum ConfigError {
    #[error("missing required environment variable {0}")]
    Missing(&'static str),
    #[error("invalid {name}: {reason}")]
    Invalid { name: &'static str, reason: String },
}

impl Config {
    pub fn from_env() -> Result<Self, ConfigError> {
        let addr = required("NOTIFICATIONS_ADDR")
            .unwrap_or_else(|_| "127.0.0.1:8082".into())
            .parse()
            .map_err(|err| invalid("NOTIFICATIONS_ADDR", err))?;
        let database_url = required("NOTIFICATIONS_DATABASE_URL")?;
        let internal_token = required("NOTIFICATIONS_INTERNAL_TOKEN")?;
        if internal_token.len() < 32 {
            return Err(ConfigError::Invalid {
                name: "NOTIFICATIONS_INTERNAL_TOKEN",
                reason: "must be at least 32 characters".into(),
            });
        }
        let host = required("NOTIFICATIONS_SMTP_HOST")?;
        if host.trim().is_empty() || host.chars().any(char::is_whitespace) {
            return Err(ConfigError::Invalid {
                name: "NOTIFICATIONS_SMTP_HOST",
                reason: "must be a hostname without whitespace".into(),
            });
        }
        let port = optional_number("NOTIFICATIONS_SMTP_PORT", 587, 1, u16::MAX as i64)? as u16;
        let username = required("NOTIFICATIONS_SMTP_USERNAME")?;
        let password = required("NOTIFICATIONS_SMTP_PASSWORD")?;
        let from = required("NOTIFICATIONS_SMTP_FROM")?
            .parse()
            .map_err(|err| invalid("NOTIFICATIONS_SMTP_FROM", err))?;
        let security = match env::var("NOTIFICATIONS_SMTP_SECURITY")
            .unwrap_or_else(|_| "starttls".into())
            .as_str()
        {
            "starttls" => SmtpSecurity::StartTls,
            "plain" if env::var("APP_ENV").as_deref() == Ok("development") => {
                SmtpSecurity::PlainDevelopment
            }
            "plain" => {
                return Err(ConfigError::Invalid {
                    name: "NOTIFICATIONS_SMTP_SECURITY",
                    reason: "plain is allowed only when APP_ENV=development".into(),
                });
            }
            _ => {
                return Err(ConfigError::Invalid {
                    name: "NOTIFICATIONS_SMTP_SECURITY",
                    reason: "must be starttls or plain".into(),
                });
            }
        };
        let max_attempts = optional_number("NOTIFICATIONS_MAX_ATTEMPTS", 5, 1, 20)? as i32;
        let retry_seconds = optional_number("NOTIFICATIONS_RETRY_SECONDS", 60, 1, 86_400)? as u64;
        let retention_days = optional_number("NOTIFICATIONS_RETENTION_DAYS", 30, 1, 3_650)?;
        Ok(Self {
            addr,
            database_url,
            internal_token,
            smtp: SmtpConfig {
                host,
                port,
                username,
                password,
                from,
                security,
            },
            max_attempts,
            retry_delay: Duration::from_secs(retry_seconds),
            retention_days,
        })
    }
}

fn required(name: &'static str) -> Result<String, ConfigError> {
    env::var(name)
        .map_err(|_| ConfigError::Missing(name))
        .and_then(|value| {
            if value.trim().is_empty() {
                Err(ConfigError::Missing(name))
            } else {
                Ok(value)
            }
        })
}

fn optional_number(
    name: &'static str,
    default: i64,
    min: i64,
    max: i64,
) -> Result<i64, ConfigError> {
    let value = match env::var(name) {
        Ok(value) if !value.is_empty() => value,
        _ => return Ok(default),
    };
    let number = value.parse::<i64>().map_err(|err| invalid(name, err))?;
    if !(min..=max).contains(&number) {
        return Err(ConfigError::Invalid {
            name,
            reason: format!("must be between {min} and {max}"),
        });
    }
    Ok(number)
}

fn invalid(name: &'static str, error: impl std::fmt::Display) -> ConfigError {
    ConfigError::Invalid {
        name,
        reason: error.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::str::FromStr;

    #[test]
    fn parses_mailbox() {
        assert!(Mailbox::from_str("Cekarna <no-reply@example.com>").is_ok());
    }
}
