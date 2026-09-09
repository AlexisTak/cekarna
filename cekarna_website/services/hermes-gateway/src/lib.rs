pub mod config;

use std::sync::Arc;

use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, Request, State},
    http::{HeaderValue, StatusCode, header},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use config::Config;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use subtle::ConstantTimeEq;
use tokio::sync::Semaphore;
use tower_http::trace::TraceLayer;

const MAX_REQUEST_BYTES: usize = 96 * 1024;
const MAX_RESPONSE_BYTES: usize = 2 * 1024 * 1024;

#[derive(Clone)]
pub struct AppState {
    client: Client,
    upstream: Arc<str>,
    token: Arc<str>,
    model: Arc<str>,
    permits: Arc<Semaphore>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct ChatRequest {
    model: String,
    stream: bool,
    format: String,
    keep_alive: String,
    options: ChatOptions,
    messages: Vec<ChatMessage>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct ChatOptions {
    temperature: f64,
    num_ctx: u32,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct ChatMessage {
    role: String,
    content: String,
}

pub fn state(config: &Config) -> Result<AppState, reqwest::Error> {
    Ok(AppState {
        client: Client::builder()
            .timeout(config.timeout)
            .redirect(reqwest::redirect::Policy::none())
            .build()?,
        upstream: Arc::from(config.ollama_base_url.as_str()),
        token: Arc::from(config.internal_token.as_str()),
        model: Arc::from(config.model.as_str()),
        permits: Arc::new(Semaphore::new(config.max_concurrency)),
    })
}

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/health/live", get(live))
        .route("/health/ready", get(ready))
        .route("/api/tags", get(tags))
        .route(
            "/api/chat",
            post(chat).layer(DefaultBodyLimit::max(MAX_REQUEST_BYTES)),
        )
        .layer(middleware::from_fn_with_state(state.clone(), authorize))
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}

async fn live() -> Json<Value> {
    Json(json!({ "status": "ok" }))
}

async fn ready(State(state): State<AppState>) -> Response {
    match state
        .client
        .get(format!("{}/api/tags", state.upstream))
        .send()
        .await
    {
        Ok(response) if response.status().is_success() => {
            (StatusCode::OK, Json(json!({ "status": "ready" }))).into_response()
        }
        _ => error(StatusCode::SERVICE_UNAVAILABLE, "upstream_unavailable"),
    }
}

async fn tags(State(state): State<AppState>) -> Response {
    relay(
        state
            .client
            .get(format!("{}/api/tags", state.upstream))
            .send()
            .await,
    )
    .await
}

async fn chat(State(state): State<AppState>, Json(input): Json<ChatRequest>) -> Response {
    if !valid_chat(&input, &state.model) {
        return error(StatusCode::BAD_REQUEST, "invalid_request");
    }
    let Ok(_permit) = state.permits.clone().try_acquire_owned() else {
        return error(StatusCode::TOO_MANY_REQUESTS, "busy");
    };
    relay(
        state
            .client
            .post(format!("{}/api/chat", state.upstream))
            .json(&input)
            .send()
            .await,
    )
    .await
}

fn valid_chat(input: &ChatRequest, expected_model: &str) -> bool {
    input.model == expected_model
        && !input.stream
        && input.format == "json"
        && matches!(input.keep_alive.as_str(), "0" | "5m" | "10m")
        && input.options.temperature == 0.0
        && (512..=8192).contains(&input.options.num_ctx)
        && input.messages.len() == 1
        && input.messages[0].role == "user"
        && !input.messages[0].content.is_empty()
        && input.messages[0].content.len() <= 64 * 1024
}

async fn relay(result: Result<reqwest::Response, reqwest::Error>) -> Response {
    let response = match result {
        Ok(response) => response,
        Err(error_value) if error_value.is_timeout() => {
            return error(StatusCode::GATEWAY_TIMEOUT, "upstream_timeout");
        }
        Err(_) => return error(StatusCode::BAD_GATEWAY, "upstream_unavailable"),
    };
    if !response.status().is_success() {
        return error(StatusCode::BAD_GATEWAY, "upstream_error");
    }
    if !response
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value.starts_with("application/json"))
    {
        return error(StatusCode::BAD_GATEWAY, "invalid_upstream_response");
    }
    if response
        .content_length()
        .is_some_and(|length| length > MAX_RESPONSE_BYTES as u64)
    {
        return error(StatusCode::BAD_GATEWAY, "invalid_upstream_response");
    }
    let status = response.status();
    let content_type = response.headers().get(header::CONTENT_TYPE).cloned();
    let bytes = match response.bytes().await {
        Ok(bytes) if bytes.len() <= MAX_RESPONSE_BYTES => bytes,
        _ => return error(StatusCode::BAD_GATEWAY, "invalid_upstream_response"),
    };
    let mut output = Response::builder()
        .status(status)
        .header(header::CACHE_CONTROL, "no-store");
    if let Some(value) = content_type {
        output = output.header(header::CONTENT_TYPE, value);
    }
    output
        .body(axum::body::Body::from(bytes))
        .unwrap_or_else(|_| error(StatusCode::BAD_GATEWAY, "invalid_upstream_response"))
}

async fn authorize(State(state): State<AppState>, request: Request, next: Next) -> Response {
    if request.uri().path().starts_with("/health/") {
        return next.run(request).await;
    }
    let supplied = request
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "));
    if supplied.is_some_and(|value| {
        value.len() == state.token.len()
            && bool::from(value.as_bytes().ct_eq(state.token.as_bytes()))
    }) {
        next.run(request).await
    } else {
        error(StatusCode::UNAUTHORIZED, "unauthorized")
    }
}

fn error(status: StatusCode, code: &'static str) -> Response {
    let mut response = (status, Json(json!({ "error": code }))).into_response();
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        body::Body,
        http::{HeaderMap, Request},
    };
    use std::{net::SocketAddr, time::Duration};
    use tower::ServiceExt;

    fn test_config(upstream: String) -> Config {
        Config {
            addr: "127.0.0.1:8084".parse::<SocketAddr>().unwrap(),
            ollama_base_url: upstream,
            internal_token: "0123456789abcdef0123456789abcdef".into(),
            model: "hermes3:3b".into(),
            max_concurrency: 2,
            timeout: Duration::from_secs(2),
        }
    }

    #[tokio::test]
    async fn protects_inference_routes() {
        let app = router(state(&test_config("http://127.0.0.1:9".into())).unwrap());
        let response = app
            .oneshot(Request::get("/api/tags").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn rejects_an_unapproved_model_before_contacting_upstream() {
        let app = router(state(&test_config("http://127.0.0.1:9".into())).unwrap());
        let body = json!({
            "model":"another-model", "stream":false, "format":"json", "keep_alive":"5m",
            "options":{"temperature":0,"num_ctx":4096},
            "messages":[{"role":"user","content":"test"}]
        });
        let response = app
            .oneshot(
                Request::post("/api/chat")
                    .header(
                        header::AUTHORIZATION,
                        "Bearer 0123456789abcdef0123456789abcdef",
                    )
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(body.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn forwards_only_the_supported_tags_route() {
        let upstream = Router::new().route(
            "/api/tags",
            get(|| async { Json(json!({"models":[{"name":"hermes3:3b"}]})) }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(async move { axum::serve(listener, upstream).await.unwrap() });
        let app = router(state(&test_config(format!("http://{address}"))).unwrap());
        let response = app
            .oneshot(
                Request::get("/api/tags")
                    .header(
                        header::AUTHORIZATION,
                        "Bearer 0123456789abcdef0123456789abcdef",
                    )
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn forwards_a_valid_chat_without_the_gateway_credential() {
        async fn upstream_chat(headers: HeaderMap, Json(body): Json<Value>) -> Response {
            if headers.contains_key(header::AUTHORIZATION)
                || body.get("model").and_then(Value::as_str) != Some("hermes3:3b")
            {
                return StatusCode::BAD_REQUEST.into_response();
            }
            Json(json!({"message":{"content":"{\"findings\":[]}"}})).into_response()
        }
        let upstream = Router::new().route("/api/chat", post(upstream_chat));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(async move { axum::serve(listener, upstream).await.unwrap() });
        let app = router(state(&test_config(format!("http://{address}"))).unwrap());
        let body = json!({
            "model":"hermes3:3b", "stream":false, "format":"json", "keep_alive":"5m",
            "options":{"temperature":0,"num_ctx":4096},
            "messages":[{"role":"user","content":"test"}]
        });
        let response = app
            .oneshot(
                Request::post("/api/chat")
                    .header(
                        header::AUTHORIZATION,
                        "Bearer 0123456789abcdef0123456789abcdef",
                    )
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(body.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn rejects_excess_generation_concurrency_without_contacting_upstream() {
        let current_state = state(&Config {
            max_concurrency: 1,
            ..test_config("http://127.0.0.1:9".into())
        })
        .unwrap();
        let _permit = current_state.permits.clone().acquire_owned().await.unwrap();
        let app = router(current_state);
        let body = json!({
            "model":"hermes3:3b", "stream":false, "format":"json", "keep_alive":"5m",
            "options":{"temperature":0,"num_ctx":4096},
            "messages":[{"role":"user","content":"test"}]
        });
        let response = app
            .oneshot(
                Request::post("/api/chat")
                    .header(
                        header::AUTHORIZATION,
                        "Bearer 0123456789abcdef0123456789abcdef",
                    )
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(body.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::TOO_MANY_REQUESTS);
    }
}
