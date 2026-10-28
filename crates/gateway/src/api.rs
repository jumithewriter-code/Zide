//! HTTP API: router, errors, merchant authentication and shared helpers.
//!
//! Two audiences:
//! - merchant servers, authenticated with a secret key (`Authorization: Bearer sk_test_…`);
//! - the payer's browser on the hosted payment page, which only ever sees one session.

use axum::{
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json, Router,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};
use tower_http::cors::CorsLayer;

use crate::{db, ids, now, AppState, Config};

/// The drop-in button script, served by the gateway so merchants load it from the Zide host.
const ZIDE_JS: &str = include_str!("../../../sdk/js/zide.js");

pub fn router(state: AppState) -> Router {
    Router::new()
        .route(
            "/zide.js",
            axum::routing::get(|| async {
                ([("content-type", "application/javascript; charset=utf-8"), ("cache-control", "no-cache")], ZIDE_JS)
            }),
        )
        .merge(crate::merchants::routes())
        .merge(crate::sessions::routes())
        .merge(crate::p2p::routes())
        .merge(crate::inspect::routes())
        .layer(CorsLayer::permissive())
        .with_state(state)
}

pub enum ApiError {
    NotFound(&'static str),
    BadRequest(String),
    Unauthorized,
    Internal(anyhow::Error),
}

impl<E: Into<anyhow::Error>> From<E> for ApiError {
    fn from(e: E) -> Self {
        ApiError::Internal(e.into())
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let (status, msg) = match self {
            ApiError::NotFound(m) => (StatusCode::NOT_FOUND, m.to_string()),
            ApiError::BadRequest(m) => (StatusCode::BAD_REQUEST, m),
            ApiError::Unauthorized => (StatusCode::UNAUTHORIZED, "missing or invalid secret key".to_string()),
            ApiError::Internal(e) => {
                eprintln!("internal error: {e:#}");
                (StatusCode::INTERNAL_SERVER_ERROR, "internal error".to_string())
            }
        };
        (status, Json(json!({ "error": msg }))).into_response()
    }
}

pub type ApiResult = Result<Json<Value>, ApiError>;

pub fn bad(msg: impl Into<String>) -> ApiError {
    ApiError::BadRequest(msg.into())
}

/// Resolves `Authorization: Bearer sk_test_…` to a merchant id.
pub fn authenticate(db: &Connection, headers: &HeaderMap) -> Result<i64, ApiError> {
    let key = headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .ok_or(ApiError::Unauthorized)?;
    db.query_row("SELECT merchant_id FROM api_keys WHERE key_hash = ?1", [ids::sha256_hex(key)], |r| r.get(0))
        .optional()?
        .ok_or(ApiError::Unauthorized)
}

/// Merchant references must be opaque ids (e.g. `acct_8f2k`), not emails or names. We reject
/// characters that personal data needs (`@`, spaces) so integrators can't leak it by accident.
pub fn validate_reference(reference: Option<&str>) -> Result<(), ApiError> {
    let Some(r) = reference else { return Ok(()) };
    let ok = !r.is_empty()
        && r.len() <= 64
        && r.bytes().all(|b| b.is_ascii_alphanumeric() || b"-_.:".contains(&b));
    if ok {
        Ok(())
    } else {
        Err(bad("reference must be an opaque id: up to 64 letters, digits, - _ . : (no emails or names)"))
    }
}

pub fn validate_url(name: &str, url: &str) -> Result<(), ApiError> {
    if (url.starts_with("http://") || url.starts_with("https://")) && url.len() <= 2048 {
        Ok(())
    } else {
        Err(bad(format!("{name} must be an http(s) URL")))
    }
}

pub fn format_zec(zat: i64) -> String {
    format!("{}.{:08}", zat / 100_000_000, zat % 100_000_000)
}

/// ZIP 321 payment URI: wallets that scan the QR fill in address, amount and memo.
pub fn payment_uri(address: &str, amount_zat: i64, memo: &str) -> String {
    let amount = format_zec(amount_zat);
    format!(
        "zcash:{address}?amount={}&memo={}",
        amount.trim_end_matches('0').trim_end_matches('.'),
        URL_SAFE_NO_PAD.encode(memo.as_bytes())
    )
}

/// Creates an invoice with a fresh one-time shielded address and a locked ZEC quote.
pub fn create_invoice(
    db: &Connection,
    cfg: &Config,
    merchant_id: i64,
    subscription_id: Option<&str>,
    price_cents: i64,
    description: &str,
) -> Result<String, ApiError> {
    let start: u32 = db::kv_get(db, "next_div_index")?.map_or(Ok(db::FIRST_INVOICE_INDEX), |v| v.parse())?;
    let (address, div_index) = scanner::keys::invoice_address(&cfg.network, &cfg.ufvk, start)?;
    db::kv_set(db, "next_div_index", &(div_index + 1).to_string())?;

    let amount_zat = ((price_cents as f64 / 100.0) / cfg.zec_usd * 1e8).round() as i64;
    if amount_zat <= 0 {
        return Err(bad("price rounds to zero ZEC"));
    }
    let invoice_id = ids::prefixed_id("inv");
    let created_at = now();
    db.execute(
        "INSERT INTO invoices (id, code, merchant_id, subscription_id, div_index, address, amount_zat,
                               price_usd_cents, description, status, created_at, expires_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'open', ?10, ?11)",
        params![
            invoice_id,
            ids::invoice_code(),
            merchant_id,
            subscription_id,
            div_index as i64,
            address,
            amount_zat,
            price_cents,
            description,
            created_at,
            created_at + cfg.invoice_ttl_secs
        ],
    )?;
    Ok(invoice_id)
}
