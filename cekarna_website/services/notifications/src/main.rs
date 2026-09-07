mod config;

use std::{
    sync::Arc,
    time::{Duration, Instant},
};

use axum::{
    Json, Router,
    extract::{Request, State},
    http::{HeaderMap, StatusCode, header},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{delete, get, post},
};
use config::{Config, SmtpConfig, SmtpSecurity};
use lettre::{
    AsyncSmtpTransport, AsyncTransport, Tokio1Executor,
    message::{Mailbox, Message, header::ContentType},
    transport::smtp::authentication::Credentials,
};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, PgPool, postgres::PgPoolOptions};
use time::OffsetDateTime;
use tokio::{net::TcpListener, time::sleep};
use tower_http::trace::TraceLayer;
use tracing::{error, info, warn};
use uuid::Uuid;

#[derive(Clone)]
struct AppState {
    database: PgPool,
    internal_token: Arc<str>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct EnqueueRequest {
    owner_id: String,
    expires_at: Option<OffsetDateTime>,
    kind: String,
    recipient: String,
    subject: String,
    text_body: String,
}

#[derive(Serialize)]
struct EnqueueResponse {
    id: Uuid,
    status: String,
}

#[derive(Serialize, FromRow)]
struct NotificationView {
    id: Uuid,
    kind: String,
    status: String,
    attempts: i32,
    created_at: OffsetDateTime,
    delivered_at: Option<OffsetDateTime>,
    last_error: Option<String>,
}

#[derive(Serialize)]
struct Health {
    status: &'static str,
}

#[derive(FromRow)]
struct PendingNotification {
    id: Uuid,
    recipient: String,
    subject: String,
    text_body: String,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    dotenvy::dotenv().ok();
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();
    let config = Config::from_env()?;
    let database = PgPoolOptions::new()
        .max_connections(10)
        .connect(&config.database_url)
        .await?;
    sqlx::migrate!("./migrations").run(&database).await?;
    let state = AppState {
        database: database.clone(),
        internal_token: Arc::from(config.internal_token),
    };
    tokio::spawn(dispatch_loop(
        database,
        config.smtp,
        config.max_attempts,
        config.retry_delay,
        config.retention_days,
    ));

    let app = Router::new()
        .route("/health/live", get(live))
        .route("/health/ready", get(ready))
        .route("/v1/notifications/email", post(enqueue))
        .route("/v1/notifications/{id}", get(notification))
        .route("/v1/notifications/owner/{owner_id}", delete(purge_owner))
        .route_layer(middleware::from_fn_with_state(
            state.clone(),
            require_internal_token,
        ))
        .layer(TraceLayer::new_for_http())
        .with_state(state);
    let listener = TcpListener::bind(config.addr).await?;
    info!(address = %config.addr, "notifications service started");
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;
    Ok(())
}

async fn purge_owner(
    State(state): State<AppState>,
    axum::extract::Path(owner_id): axum::extract::Path<String>,
) -> Result<StatusCode, ApiError> {
    if owner_id.is_empty() || owner_id.len() > 128 {
        return Err(ApiError::bad_request("invalid owner_id"));
    }
    sqlx::query("DELETE FROM notifications WHERE owner_id = $1")
        .bind(owner_id)
        .execute(&state.database)
        .await
        .map_err(ApiError::database)?;
    Ok(StatusCode::NO_CONTENT)
}

async fn live() -> Json<Health> {
    Json(Health { status: "ok" })
}

async fn ready(State(state): State<AppState>) -> Response {
    match sqlx::query_scalar::<_, i32>("SELECT 1")
        .fetch_one(&state.database)
        .await
    {
        Ok(_) => Json(Health { status: "ok" }).into_response(),
        Err(_) => StatusCode::SERVICE_UNAVAILABLE.into_response(),
    }
}

async fn require_internal_token(
    State(state): State<AppState>,
    request: Request,
    next: Next,
) -> Response {
    if request.uri().path().starts_with("/health/") {
        return next.run(request).await;
    }
    let supplied = request
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "));
    let valid = supplied
        .is_some_and(|value| constant_time_eq(value.as_bytes(), state.internal_token.as_bytes()));
    if valid {
        next.run(request).await
    } else {
        StatusCode::UNAUTHORIZED.into_response()
    }
}

async fn enqueue(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(input): Json<EnqueueRequest>,
) -> Result<Json<EnqueueResponse>, ApiError> {
    validate_input(&input)?;
    let idempotency_key = headers
        .get("idempotency-key")
        .and_then(|value| value.to_str().ok())
        .ok_or(ApiError::bad_request("idempotency-key is required"))?;
    validate_idempotency_key(idempotency_key)?;
    let recipient: Mailbox = input
        .recipient
        .parse()
        .map_err(|_| ApiError::bad_request("recipient must be a valid email address"))?;
    let id = Uuid::now_v7();
    if input.owner_id.is_empty() || input.owner_id.len() > 128 {
        return Err(ApiError::bad_request("owner_id is required"));
    }
    let row: (Uuid, String) = sqlx::query_as("INSERT INTO notifications (id, owner_id, kind, recipient, subject, text_body, expires_at, idempotency_key) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (idempotency_key) DO UPDATE SET id = notifications.id RETURNING id, status::text")
        .bind(id).bind(input.owner_id).bind(input.kind).bind(recipient.to_string()).bind(input.subject).bind(input.text_body).bind(input.expires_at).bind(idempotency_key)
        .fetch_one(&state.database).await.map_err(ApiError::database)?;
    Ok(Json(EnqueueResponse {
        id: row.0,
        status: row.1,
    }))
}

async fn notification(
    State(state): State<AppState>,
    axum::extract::Path(id): axum::extract::Path<Uuid>,
) -> Result<Json<NotificationView>, ApiError> {
    let row = sqlx::query_as::<_, NotificationView>("SELECT id, kind, status::text AS status, attempts, created_at, delivered_at, last_error FROM notifications WHERE id = $1")
        .bind(id).fetch_optional(&state.database).await.map_err(ApiError::database)?;
    row.map(Json)
        .ok_or(ApiError(StatusCode::NOT_FOUND, "notification not found"))
}

fn validate_input(input: &EnqueueRequest) -> Result<(), ApiError> {
    let valid_kind = !input.kind.is_empty()
        && input.kind.len() <= 80
        && input.kind.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || matches!(byte, b'.' | b'_' | b'-')
        });
    if !valid_kind {
        return Err(ApiError::bad_request(
            "kind must contain lowercase letters, digits, dot, underscore, or hyphen",
        ));
    }
    if input.subject.trim().is_empty() || input.subject.len() > 200 {
        return Err(ApiError::bad_request("subject must be 1 to 200 characters"));
    }
    if input.text_body.trim().is_empty() || input.text_body.len() > 20_000 {
        return Err(ApiError::bad_request(
            "text_body must be 1 to 20000 characters",
        ));
    }
    Ok(())
}

fn validate_idempotency_key(key: &str) -> Result<(), ApiError> {
    if key.len() == 64
        && key
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
    {
        Ok(())
    } else {
        Err(ApiError::bad_request(
            "idempotency-key must be a lowercase SHA-256 digest",
        ))
    }
}

async fn dispatch_loop(
    database: PgPool,
    smtp: SmtpConfig,
    max_attempts: i32,
    retry_delay: Duration,
    retention_days: i64,
) {
    let builder = match smtp.security {
        SmtpSecurity::StartTls => AsyncSmtpTransport::<Tokio1Executor>::starttls_relay(&smtp.host),
        SmtpSecurity::PlainDevelopment => Ok(
            AsyncSmtpTransport::<Tokio1Executor>::builder_dangerous(&smtp.host),
        ),
    };
    let transport = match builder {
        Ok(builder) => builder
            .port(smtp.port)
            .credentials(Credentials::new(
                smtp.username.clone(),
                smtp.password.clone(),
            ))
            .build(),
        Err(err) => {
            error!(%err, "invalid SMTP configuration");
            return;
        }
    };
    let mut last_cleanup = Instant::now() - Duration::from_secs(3_600);
    loop {
        if last_cleanup.elapsed() >= Duration::from_secs(3_600) {
            if let Err(err) = purge_terminal(&database, retention_days).await {
                error!(%err, "unable to purge terminal notifications");
            }
            last_cleanup = Instant::now();
        }
        match claim_pending(&database, max_attempts).await {
            Ok(Some(notification)) => {
                let outcome = tokio::time::timeout(
                    Duration::from_secs(30),
                    send_email(&transport, &smtp.from, &notification),
                )
                .await
                .unwrap_or_else(|_| Err("smtp_timeout".into()));
                if let Err(err) = finish_delivery(
                    &database,
                    notification.id,
                    outcome,
                    max_attempts,
                    retry_delay,
                )
                .await
                {
                    error!(%err, "unable to record notification outcome");
                }
            }
            Ok(None) => sleep(Duration::from_secs(1)).await,
            Err(err) => {
                error!(%err, "unable to claim notification");
                sleep(Duration::from_secs(3)).await;
            }
        }
    }
}

async fn purge_terminal(database: &PgPool, retention_days: i64) -> Result<u64, sqlx::Error> {
    sqlx::query("DELETE FROM notifications WHERE status IN ('delivered', 'failed') AND COALESCE(delivered_at, created_at) < now() - $1::bigint * interval '1 day'")
        .bind(retention_days)
        .execute(database)
        .await
        .map(|result| result.rows_affected())
}

async fn claim_pending(
    database: &PgPool,
    max_attempts: i32,
) -> Result<Option<PendingNotification>, sqlx::Error> {
    sqlx::query("UPDATE notifications SET status = 'failed', locked_at = NULL, last_error = 'attempts_exhausted' WHERE attempts >= $1 AND (status = 'pending' OR (status = 'sending' AND locked_at < now() - interval '5 minutes'))")
        .bind(max_attempts).execute(database).await?;
    sqlx::query("UPDATE notifications SET status = 'cancelled', locked_at = NULL, last_error = 'expired' WHERE status IN ('pending','sending') AND expires_at IS NOT NULL AND expires_at <= now()").execute(database).await?;
    sqlx::query_as::<_, PendingNotification>("WITH next AS (SELECT id FROM notifications WHERE ((status = 'pending' AND available_at <= now()) OR (status = 'sending' AND locked_at < now() - interval '5 minutes')) AND (expires_at IS NULL OR expires_at > now()) AND attempts < $1 ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1) UPDATE notifications SET status = 'sending', attempts = attempts + 1, locked_at = now() WHERE id = (SELECT id FROM next) RETURNING id, recipient, subject, text_body")
        .bind(max_attempts).fetch_optional(database).await
}

async fn send_email(
    transport: &AsyncSmtpTransport<Tokio1Executor>,
    from: &Mailbox,
    item: &PendingNotification,
) -> Result<(), String> {
    let recipient: Mailbox = item
        .recipient
        .parse()
        .map_err(|_| "stored recipient is invalid".to_owned())?;
    let email = Message::builder()
        .from(from.clone())
        .to(recipient)
        .subject(&item.subject)
        .header(ContentType::TEXT_PLAIN)
        .body(item.text_body.clone())
        .map_err(|_| "email construction failed".to_owned())?;
    transport
        .send(email)
        .await
        .map(|_| ())
        .map_err(|_| "smtp_delivery_failed".to_owned())
}

async fn finish_delivery(
    database: &PgPool,
    id: Uuid,
    outcome: Result<(), String>,
    max_attempts: i32,
    retry_delay: Duration,
) -> Result<(), sqlx::Error> {
    match outcome {
        Ok(()) => {
            sqlx::query("UPDATE notifications SET status = 'delivered', delivered_at = now(), locked_at = NULL, last_error = NULL WHERE id = $1").bind(id).execute(database).await?;
            info!(notification_id = %id, "notification delivered");
        }
        Err(error_message) => {
            let sanitized = sanitize_error(&error_message);
            let row: (i32,) = sqlx::query_as("SELECT attempts FROM notifications WHERE id = $1")
                .bind(id)
                .fetch_one(database)
                .await?;
            if row.0 >= max_attempts {
                sqlx::query(
                    "UPDATE notifications SET status = 'failed', locked_at = NULL, last_error = $2 WHERE id = $1",
                )
                .bind(id)
                .bind(sanitized)
                .execute(database)
                .await?;
                warn!(notification_id = %id, "notification delivery permanently failed");
            } else {
                sqlx::query("UPDATE notifications SET status = 'pending', available_at = now() + $2::bigint * interval '1 second', locked_at = NULL, last_error = $3 WHERE id = $1").bind(id).bind(retry_delay.as_secs() as i64).bind(sanitized).execute(database).await?;
                warn!(notification_id = %id, "notification delivery failed; will retry");
            }
        }
    }
    Ok(())
}

fn sanitize_error(error: &str) -> String {
    error
        .chars()
        .filter(|character| !character.is_control())
        .take(500)
        .collect()
}

#[derive(Debug)]
struct ApiError(StatusCode, &'static str);
impl ApiError {
    fn bad_request(message: &'static str) -> Self {
        Self(StatusCode::BAD_REQUEST, message)
    }
    fn database(_: sqlx::Error) -> Self {
        Self(
            StatusCode::SERVICE_UNAVAILABLE,
            "notification store unavailable",
        )
    }
}
impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.0, Json(serde_json::json!({"error": self.1}))).into_response()
    }
}

fn constant_time_eq(left: &[u8], right: &[u8]) -> bool {
    if left.len() != right.len() {
        return false;
    }
    left.iter()
        .zip(right)
        .fold(0_u8, |different, (a, b)| different | (a ^ b))
        == 0
}

async fn shutdown_signal() {
    let _ = tokio::signal::ctrl_c().await;
}

#[cfg(test)]
mod tests {
    use super::*;
    #[sqlx::test(migrations = "./migrations")]
    #[ignore = "requires a local PostgreSQL DATABASE_URL with permission to create test databases"]
    async fn retry_and_crash_recovery(pool: PgPool) {
        let id = Uuid::now_v7();
        sqlx::query("INSERT INTO notifications(id,kind,recipient,subject,text_body) VALUES($1,'auth.email','test@example.test','Test','Body')")
            .bind(id).execute(&pool).await.unwrap();
        assert_eq!(claim_pending(&pool, 2).await.unwrap().unwrap().id, id);
        assert!(claim_pending(&pool, 2).await.unwrap().is_none());
        finish_delivery(
            &pool,
            id,
            Err("smtp_delivery_failed".into()),
            2,
            Duration::from_secs(60),
        )
        .await
        .unwrap();
        assert!(claim_pending(&pool, 2).await.unwrap().is_none());
        sqlx::query(
            "UPDATE notifications SET available_at = now() - interval '1 second' WHERE id=$1",
        )
        .bind(id)
        .execute(&pool)
        .await
        .unwrap();
        assert!(claim_pending(&pool, 2).await.unwrap().is_some());
        // Crash during the last attempt must eventually become a terminal failure.
        sqlx::query(
            "UPDATE notifications SET locked_at = now() - interval '6 minutes' WHERE id=$1",
        )
        .bind(id)
        .execute(&pool)
        .await
        .unwrap();
        assert!(claim_pending(&pool, 2).await.unwrap().is_none());
        let status: String =
            sqlx::query_scalar("SELECT status::text FROM notifications WHERE id=$1")
                .bind(id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(status, "failed");
    }
    #[test]
    fn rejects_invalid_input() {
        assert!(
            validate_input(&EnqueueRequest {
                owner_id: "owner".into(),
                expires_at: None,
                kind: "Email!".into(),
                recipient: "x@example.com".into(),
                subject: "Subject".into(),
                text_body: "body".into()
            })
            .is_err()
        );
    }
    #[test]
    fn constant_time_comparison_checks_values() {
        assert!(constant_time_eq(b"same", b"same"));
        assert!(!constant_time_eq(b"same", b"nope"));
    }
    #[test]
    fn sanitizes_delivery_errors() {
        assert_eq!(sanitize_error("bad\nerror"), "baderror");
    }
    #[test]
    fn validates_idempotency_keys() {
        assert!(validate_idempotency_key(&"a".repeat(64)).is_ok());
        assert!(validate_idempotency_key("not-a-digest").is_err());
    }
}
