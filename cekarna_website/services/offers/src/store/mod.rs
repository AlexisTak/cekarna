use sqlx::{
    SqlitePool,
    sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions},
};
use std::{path::Path, str::FromStr, time::Duration};
pub async fn connect(path: &Path) -> anyhow::Result<SqlitePool> {
    if let Some(parent) = path.parent().filter(|p| !p.as_os_str().is_empty()) {
        std::fs::create_dir_all(parent)?;
    }
    let url = format!("sqlite://{}", path.display());
    let options = SqliteConnectOptions::from_str(&url)?
        .create_if_missing(true)
        .foreign_keys(true)
        .journal_mode(SqliteJournalMode::Wal)
        .busy_timeout(Duration::from_secs(5));
    Ok(SqlitePoolOptions::new()
        .max_connections(5)
        .connect_with(options)
        .await?)
}
pub async fn migrate(pool: &SqlitePool) -> anyhow::Result<()> {
    for migration in [
        include_str!("../../migrations/001_offers.sql"),
        include_str!("../../migrations/002_search.sql"),
        include_str!("../../migrations/003_offer_details.sql"),
    ] {
        for statement in migration
            .split(';')
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            if let Err(error) = sqlx::query(statement).execute(pool).await {
                if !error.to_string().contains("duplicate column name") {
                    return Err(error.into());
                }
            }
        }
    }
    Ok(())
}
pub async fn ping(pool: &SqlitePool) -> Result<(), sqlx::Error> {
    sqlx::query("SELECT 1").execute(pool).await.map(|_| ())
}
