use cekarna_offers::{
    collect,
    config::Config,
    http::{self, AppState},
    sources::Registry,
    store,
};
use clap::{Parser, Subcommand};
use std::sync::Arc;
#[derive(Parser)]
struct Cli {
    #[command(subcommand)]
    command: Option<Command>,
}
#[derive(Subcommand)]
enum Command {
    Serve,
    Collect {
        #[arg(long)]
        source: Option<String>,
    },
    Migrate,
}
#[tokio::main]
async fn main() -> anyhow::Result<()> {
    dotenvy::dotenv().ok();
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();
    let config = Config::from_env()?;
    let pool = store::connect(&config.database_path).await?;
    store::migrate(&pool).await?;
    match Cli::parse().command.unwrap_or(Command::Serve) {
        Command::Migrate => Ok(()),
        Command::Collect { source } => {
            let registry = Registry::load(&config.sources_path)?;
            println!(
                "{}",
                serde_json::to_string(&collect::run(&pool, &registry, source.as_deref()).await?)?
            );
            Ok(())
        }
        Command::Serve => {
            let registry = Registry::load(&config.sources_path)?;
            let listener = tokio::net::TcpListener::bind(config.addr).await?;
            axum::serve(
                listener,
                http::router(AppState {
                    pool,
                    token: Arc::new(config.internal_token),
                    registry: Arc::new(registry),
                }),
            )
            .await?;
            Ok(())
        }
    }
}
