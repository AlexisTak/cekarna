use crate::{collect, normalize::norm, sources::Registry, store};
use axum::{
    Json, Router,
    extract::{Path, Query, Request, State},
    http::{StatusCode, header},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::{FromRow, SqlitePool};
use std::sync::Arc;
#[derive(Clone)]
pub struct AppState {
    pub pool: SqlitePool,
    pub token: Arc<String>,
    pub registry: Arc<Registry>,
}
#[derive(Serialize, FromRow)]
struct Offer {
    id: String,
    source_id: String,
    external_id: Option<String>,
    title: String,
    company: String,
    location: String,
    contract: Option<String>,
    url: Option<String>,
    description: String,
    published_at: Option<String>,
    salary: Option<String>,
    work_duration: Option<String>,
    experience: Option<String>,
    qualification: Option<String>,
    #[sqlx(json)]
    skills: Vec<String>,
    accessible_th: Option<bool>,
    group_id: String,
    origins: String,
    first_seen_at: String,
    last_seen_at: String,
}
#[derive(Deserialize)]
struct ListQuery {
    q: Option<String>,
    location: Option<String>,
    contract: Option<String>,
    cursor: Option<String>,
    limit: Option<i64>,
    duplicates: Option<String>,
}
fn equal(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).fold(0u8, |x, (a, b)| x | (a ^ b)) == 0
}
async fn auth(State(state): State<AppState>, request: Request, next: Next) -> Response {
    if request.uri().path().starts_with("/health") {
        return next.run(request).await;
    }
    let supplied = request
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "));
    if supplied.is_some_and(|v| equal(v.as_bytes(), state.token.as_bytes())) {
        next.run(request).await
    } else {
        StatusCode::UNAUTHORIZED.into_response()
    }
}
pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/health", get(|| async { Json(json!({"status":"ok"})) }))
        .route("/health/ready", get(ready))
        .route("/v1/offers", get(list))
        .route("/v1/offers/{id}", get(detail))
        .route("/v1/sources", get(sources))
        .route("/v1/collect", post(collect_now))
        .layer(middleware::from_fn_with_state(state.clone(), auth))
        .with_state(state)
}
async fn ready(State(s): State<AppState>) -> impl IntoResponse {
    match store::ping(&s.pool).await {
        Ok(_) => (StatusCode::OK, Json(json!({"status":"ready"}))),
        Err(_) => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({"status":"unavailable"})),
        ),
    }
}
async fn list(
    State(s): State<AppState>,
    Query(p): Query<ListQuery>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let limit = p.limit.unwrap_or(50).clamp(1, 200);
    let mut sql="SELECT id,source_id,external_id,title,company,location,contract,url,description,published_at,salary,work_duration,experience,qualification,skills_json AS skills,accessible_th,group_id,origins,first_seen_at,last_seen_at FROM offers o WHERE active=1".to_string();
    if p.duplicates.as_deref() != Some("include") {
        sql.push_str(" AND id=(SELECT id FROM offers c WHERE c.group_id=o.group_id AND c.active=1 ORDER BY first_seen_at,id LIMIT 1)");
    }
    if p.q.is_some() {
        sql.push_str(" AND search_text LIKE ?");
    }
    if p.location.is_some() {
        sql.push_str(" AND location_normalized LIKE ?");
    }
    if p.contract.is_some() {
        sql.push_str(" AND lower(contract)=?");
    }
    if p.cursor.is_some() {
        sql.push_str(" AND id>?");
    }
    sql.push_str(" ORDER BY id LIMIT ?");
    let mut q = sqlx::query_as::<_, Offer>(&sql);
    if let Some(value) = p.q {
        q = q.bind(format!("%{}%", norm(&value)));
    }
    if let Some(value) = p.location {
        q = q.bind(format!("%{}%", norm(&value)));
    }
    if let Some(value) = p.contract {
        q = q.bind(value.to_lowercase());
    }
    if let Some(value) = p.cursor {
        q = q.bind(value);
    }
    let rows = q
        .bind(limit)
        .fetch_all(&s.pool)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let next = if rows.len() == limit as usize {
        rows.last().map(|o| o.id.clone())
    } else {
        None
    };
    Ok(Json(json!({"offers":rows,"next_cursor":next})))
}
async fn detail(
    State(s): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let offer:Option<Offer>=sqlx::query_as("SELECT id,source_id,external_id,title,company,location,contract,url,description,published_at,salary,work_duration,experience,qualification,skills_json AS skills,accessible_th,group_id,origins,first_seen_at,last_seen_at FROM offers WHERE id=?1").bind(&id).fetch_optional(&s.pool).await.map_err(|_|StatusCode::INTERNAL_SERVER_ERROR)?;
    let Some(offer) = offer else {
        return Err(StatusCode::NOT_FOUND);
    };
    let members:Vec<Offer>=sqlx::query_as("SELECT id,source_id,external_id,title,company,location,contract,url,description,published_at,salary,work_duration,experience,qualification,skills_json AS skills,accessible_th,group_id,origins,first_seen_at,last_seen_at FROM offers WHERE group_id=?1 AND id<>?2 ORDER BY first_seen_at,id").bind(&offer.group_id).bind(&id).fetch_all(&s.pool).await.map_err(|_|StatusCode::INTERNAL_SERVER_ERROR)?;
    let decisions:Vec<(String,String,String,String)>=sqlx::query_as("SELECT offer_id,rule,compared,decided_at FROM duplicate_decisions WHERE group_id=?1 ORDER BY decided_at").bind(&offer.group_id).fetch_all(&s.pool).await.map_err(|_|StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(
        json!({"offer":offer,"group_members":members,"duplicate_decisions":decisions.into_iter().map(|d|json!({"offer_id":d.0,"rule":d.1,"compared":d.2,"decided_at":d.3})).collect::<Vec<_>>()}),
    ))
}
async fn sources(State(s): State<AppState>) -> Json<serde_json::Value> {
    let rows = sqlx::query_as::<_, (String, Option<String>, Option<String>)>(
        "SELECT source_id,last_completed_at,last_error FROM source_runs",
    )
    .fetch_all(&s.pool)
    .await
    .unwrap_or_default();
    let values=s.registry.entries().iter().map(|e|{let run=rows.iter().find(|r|r.0==e.id);json!({"id":e.id,"kind":format!("{:?}",e.kind).to_lowercase(),"terms":e.terms,"enabled":e.enabled,"min_interval_seconds":e.min_interval_seconds,"last_completed_at":run.and_then(|r|r.1.clone()),"last_error":run.and_then(|r|r.2.clone())})}).collect::<Vec<_>>();
    Json(json!({"sources":values}))
}
#[derive(Default, Deserialize)]
struct CollectInput {
    source_id: Option<String>,
}
async fn collect_now(
    State(s): State<AppState>,
    body: Option<Json<CollectInput>>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    let selected = body.and_then(|b| b.0.source_id);
    match collect::run(&s.pool, &s.registry, selected.as_deref()).await {
        Ok(r) => Ok(Json(json!(r))),
        Err(e) => Err((StatusCode::CONFLICT, Json(json!({"error":e.to_string()})))),
    }
}
