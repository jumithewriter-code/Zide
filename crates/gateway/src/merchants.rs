//! Merchant onboarding and settings: sign up, read your account, manage plans and webhooks.
//!
//! Demo simplification: sign-up is open (no email, no verification). The secret key is shown
//! once and stored only as a hash.

use axum::{
    extract::State,
    http::HeaderMap,
    routing::{get, post},
    Json, Router,
};
use rusqlite::{params, OptionalExtension};
use serde::Deserialize;
use serde_json::json;

use crate::{
    api::{authenticate, bad, validate_url, ApiResult},
    ids, now, AppState,
};

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/v1/merchants", post(sign_up))
        .route("/v1/merchant", get(me).patch(update))
        .route("/v1/plans", get(list_plans).post(create_plan))
}

#[derive(Deserialize)]
struct SignUp {
    name: String,
    webhook_url: Option<String>,
}

async fn sign_up(State(state): State<AppState>, Json(req): Json<SignUp>) -> ApiResult {
    let name = req.name.trim();
    if name.is_empty() || name.len() > 60 {
        return Err(bad("name must be 1-60 characters"));
    }
    if let Some(url) = &req.webhook_url {
        validate_url("webhook_url", url)?;
    }
    let slug_base: String = name
        .to_ascii_lowercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect::<String>()
        .trim_matches('-')
        .to_string();
    let slug = format!("{}-{}", if slug_base.is_empty() { "merchant" } else { &slug_base }, &ids::invoice_code()[..4].to_ascii_lowercase());

    let secret_key = ids::secret_key();
    let webhook_secret = ids::secret_hex();
    let db = state.db.lock().unwrap();
    db.execute(
        "INSERT INTO merchants (slug, name, webhook_url, webhook_secret, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![slug, name, req.webhook_url, webhook_secret, now()],
    )?;
    let merchant_id = db.last_insert_rowid();
    db.execute(
        "INSERT INTO api_keys (key_hash, merchant_id, created_at) VALUES (?1, ?2, ?3)",
        params![ids::sha256_hex(&secret_key), merchant_id, now()],
    )?;
    Ok(Json(json!({
        "merchant": { "id": merchant_id, "slug": slug, "name": name, "webhook_url": req.webhook_url },
        "secret_key": secret_key,
        "webhook_secret": webhook_secret,
        "note": "Store the secret key now: it is shown only once.",
    })))
}

async fn me(State(state): State<AppState>, headers: HeaderMap) -> ApiResult {
    let db = state.db.lock().unwrap();
    let id = authenticate(&db, &headers)?;
    let m = db.query_row(
        "SELECT slug, name, webhook_url, webhook_secret FROM merchants WHERE id = ?1",
        [id],
        |r| {
            Ok(json!({
                "id": id,
                "slug": r.get::<_, String>(0)?,
                "name": r.get::<_, String>(1)?,
                "webhook_url": r.get::<_, Option<String>>(2)?,
                "webhook_secret": r.get::<_, String>(3)?,
            }))
        },
    )?;
    Ok(Json(m))
}

#[derive(Deserialize)]
struct Update {
    webhook_url: Option<String>,
}

async fn update(State(state): State<AppState>, headers: HeaderMap, Json(req): Json<Update>) -> ApiResult {
    if let Some(url) = &req.webhook_url {
        validate_url("webhook_url", url)?;
    }
    {
        let db = state.db.lock().unwrap();
        let id = authenticate(&db, &headers)?;
        db.execute("UPDATE merchants SET webhook_url = ?2 WHERE id = ?1", params![id, req.webhook_url])?;
    }
    me(State(state), headers).await
}

#[derive(Deserialize)]
struct NewPlan {
    name: String,
    price_usd_cents: i64,
    period_days: i64,
}

async fn create_plan(State(state): State<AppState>, headers: HeaderMap, Json(req): Json<NewPlan>) -> ApiResult {
    let name = req.name.trim();
    if name.is_empty() || name.len() > 60 {
        return Err(bad("name must be 1-60 characters"));
    }
    if !(1..=1_000_000).contains(&req.price_usd_cents) || !(1..=3660).contains(&req.period_days) {
        return Err(bad("price_usd_cents must be 1..=1000000 and period_days 1..=3660"));
    }
    let db = state.db.lock().unwrap();
    let merchant_id = authenticate(&db, &headers)?;
    // Idempotent by name, so an integration can "ensure" its plans on every start.
    let existing: Option<i64> = db
        .query_row(
            "SELECT id FROM plans WHERE merchant_id = ?1 AND name = ?2 AND price_usd_cents = ?3 AND period_days = ?4",
            params![merchant_id, name, req.price_usd_cents, req.period_days],
            |r| r.get(0),
        )
        .optional()?;
    let id = match existing {
        Some(id) => id,
        None => {
            db.execute(
                "INSERT INTO plans (merchant_id, name, price_usd_cents, period_days) VALUES (?1, ?2, ?3, ?4)",
                params![merchant_id, name, req.price_usd_cents, req.period_days],
            )?;
            db.last_insert_rowid()
        }
    };
    Ok(Json(json!({ "id": id, "name": name, "price_usd_cents": req.price_usd_cents, "period_days": req.period_days })))
}

async fn list_plans(State(state): State<AppState>, headers: HeaderMap) -> ApiResult {
    let db = state.db.lock().unwrap();
    let merchant_id = authenticate(&db, &headers)?;
    let mut stmt =
        db.prepare("SELECT id, name, price_usd_cents, period_days FROM plans WHERE merchant_id = ?1 ORDER BY id")?;
    let plans = stmt
        .query_map([merchant_id], |r| {
            Ok(json!({
                "id": r.get::<_, i64>(0)?,
                "name": r.get::<_, String>(1)?,
                "price_usd_cents": r.get::<_, i64>(2)?,
                "period_days": r.get::<_, i64>(3)?,
            }))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(Json(json!({ "plans": plans })))
}
