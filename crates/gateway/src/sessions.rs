//! Checkout Sessions — the core gateway API.
//!
//! A merchant server creates a session (one-off payment or subscription), redirects the payer to
//! the hosted payment page, and learns the outcome from a signed webhook or by retrieving the
//! session. The merchant identifies its customer only by an opaque `reference` it chooses.

use axum::{
    extract::{Path, State},
    http::HeaderMap,
    routing::{get, post},
    Json, Router,
};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::{
    api::{
        authenticate, bad, create_invoice, format_zec, payment_uri, validate_reference, validate_url, ApiError,
        ApiResult,
    },
    ids, now, AppState,
};

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/v1/checkout/sessions", post(create).get(list))
        .route("/v1/checkout/sessions/{id}", get(retrieve))
        .route("/v1/subscriptions/{id}", get(subscription))
        .route("/v1/pay/{id}", get(hosted_page))
}

#[derive(Deserialize)]
struct CreateSession {
    /// `payment` (one-off) or `subscription`.
    mode: String,
    /// Subscription mode: which of the merchant's plans.
    plan_id: Option<i64>,
    /// Subscription mode: renew this existing subscription instead of starting a new one.
    subscription_id: Option<String>,
    /// Payment mode: amount and a short description shown to the payer.
    amount_usd_cents: Option<i64>,
    description: Option<String>,
    /// The merchant's own opaque id for the customer or order. Never an email or name.
    reference: Option<String>,
    /// `{SESSION_ID}` in success_url is replaced with the session id.
    success_url: String,
    cancel_url: String,
}

async fn create(State(state): State<AppState>, headers: HeaderMap, Json(req): Json<CreateSession>) -> ApiResult {
    validate_reference(req.reference.as_deref())?;
    validate_url("success_url", &req.success_url)?;
    validate_url("cancel_url", &req.cancel_url)?;

    let cfg = state.config.clone();
    let db = state.db.lock().unwrap();
    let merchant_id = authenticate(&db, &headers)?;

    let (price_cents, description, subscription_id) = match req.mode.as_str() {
        "subscription" => {
            let plan_id = req.plan_id.ok_or_else(|| bad("plan_id is required for subscription mode"))?;
            let (price, name): (i64, String) = db
                .query_row(
                    "SELECT price_usd_cents, name FROM plans WHERE id = ?1 AND merchant_id = ?2",
                    params![plan_id, merchant_id],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .optional()?
                .ok_or(ApiError::NotFound("unknown plan"))?;
            let sub_id = match &req.subscription_id {
                Some(existing) => {
                    let found: Option<String> = db
                        .query_row(
                            "SELECT id FROM subscriptions WHERE id = ?1 AND merchant_id = ?2 AND plan_id = ?3",
                            params![existing, merchant_id, plan_id],
                            |r| r.get(0),
                        )
                        .optional()?;
                    found.ok_or(ApiError::NotFound("unknown subscription for this plan"))?
                }
                None => {
                    let sub = ids::prefixed_id("sub");
                    db.execute(
                        "INSERT INTO subscriptions (id, merchant_id, plan_id, reference, status)
                         VALUES (?1, ?2, ?3, ?4, 'pending')",
                        params![sub, merchant_id, plan_id, req.reference],
                    )?;
                    sub
                }
            };
            (price, name, Some(sub_id))
        }
        "payment" => {
            let amount = req.amount_usd_cents.ok_or_else(|| bad("amount_usd_cents is required for payment mode"))?;
            if !(1..=1_000_000).contains(&amount) {
                return Err(bad("amount_usd_cents must be 1..=1000000"));
            }
            let description = req.description.as_deref().map(str::trim).unwrap_or("Payment").to_string();
            if description.is_empty() || description.len() > 120 {
                return Err(bad("description must be 1-120 characters"));
            }
            (amount, description, None)
        }
        _ => return Err(bad("mode must be `payment` or `subscription`")),
    };

    let invoice_id = create_invoice(&db, &cfg, merchant_id, subscription_id.as_deref(), price_cents, &description)?;
    let session_id = ids::prefixed_id("cs");
    db.execute(
        "INSERT INTO checkout_sessions (id, merchant_id, invoice_id, mode, reference, success_url, cancel_url, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![session_id, merchant_id, invoice_id, req.mode, req.reference, req.success_url, req.cancel_url, now()],
    )?;
    let session = session_json(&db, &session_id, &cfg.public_url, Some(merchant_id))?
        .ok_or_else(|| ApiError::Internal(anyhow::anyhow!("session vanished")))?;
    Ok(Json(session))
}

async fn retrieve(State(state): State<AppState>, headers: HeaderMap, Path(id): Path<String>) -> ApiResult {
    let db = state.db.lock().unwrap();
    let merchant_id = authenticate(&db, &headers)?;
    session_json(&db, &id, &state.config.public_url, Some(merchant_id))?
        .map(Json)
        .ok_or(ApiError::NotFound("unknown session"))
}

async fn list(State(state): State<AppState>, headers: HeaderMap) -> ApiResult {
    let db = state.db.lock().unwrap();
    let merchant_id = authenticate(&db, &headers)?;
    let mut stmt = db.prepare(
        "SELECT id FROM checkout_sessions WHERE merchant_id = ?1 ORDER BY created_at DESC LIMIT 50",
    )?;
    let ids: Vec<String> = stmt.query_map([merchant_id], |r| r.get(0))?.collect::<Result<_, _>>()?;
    let mut sessions = Vec::new();
    for id in ids {
        if let Some(s) = session_json(&db, &id, &state.config.public_url, Some(merchant_id))? {
            sessions.push(s);
        }
    }
    Ok(Json(json!({ "data": sessions })))
}

async fn subscription(State(state): State<AppState>, headers: HeaderMap, Path(id): Path<String>) -> ApiResult {
    let db = state.db.lock().unwrap();
    let merchant_id = authenticate(&db, &headers)?;
    subscription_json(&db, &id, merchant_id)?.map(Json).ok_or(ApiError::NotFound("unknown subscription"))
}

pub fn subscription_json(db: &Connection, id: &str, merchant_id: i64) -> Result<Option<Value>, ApiError> {
    let now = now();
    Ok(db
        .query_row(
            "SELECT s.id, s.plan_id, p.name, s.reference, s.status, s.current_period_end
             FROM subscriptions s JOIN plans p ON p.id = s.plan_id
             WHERE s.id = ?1 AND s.merchant_id = ?2",
            params![id, merchant_id],
            |r| {
                let status: String = r.get(4)?;
                let end: Option<i64> = r.get(5)?;
                Ok(json!({
                    "id": r.get::<_, String>(0)?,
                    "object": "subscription",
                    "plan": { "id": r.get::<_, i64>(1)?, "name": r.get::<_, String>(2)? },
                    "reference": r.get::<_, Option<String>>(3)?,
                    "status": if status == "active" && end.is_some_and(|e| e <= now) { "expired".to_string() } else { status },
                    "active": end.is_some_and(|e| e > now),
                    "current_period_end": end,
                }))
            },
        )
        .optional()?)
}

/// The merchant-facing view of a session.
pub fn session_json(
    db: &Connection,
    id: &str,
    public_url: &str,
    merchant_id: Option<i64>,
) -> Result<Option<Value>, ApiError> {
    let row = db
        .query_row(
            "SELECT s.merchant_id, s.mode, s.reference, s.success_url, s.cancel_url, s.created_at,
                    i.status, i.amount_zat, i.price_usd_cents, i.description, i.expires_at, i.paid_at,
                    i.subscription_id
             FROM checkout_sessions s JOIN invoices i ON i.id = s.invoice_id
             WHERE s.id = ?1",
            [id],
            |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    json!({
                        "id": id,
                        "object": "checkout.session",
                        "url": format!("{public_url}/#/pay/{id}"),
                        "mode": r.get::<_, String>(1)?,
                        "reference": r.get::<_, Option<String>>(2)?,
                        "success_url": r.get::<_, String>(3)?,
                        "cancel_url": r.get::<_, String>(4)?,
                        "created_at": r.get::<_, i64>(5)?,
                        "status": session_status(&r.get::<_, String>(6)?),
                        "payment_status": payment_status(&r.get::<_, String>(6)?),
                        "amount_zec": format_zec(r.get::<_, i64>(7)?),
                        "amount_usd_cents": r.get::<_, i64>(8)?,
                        "description": r.get::<_, String>(9)?,
                        "expires_at": r.get::<_, i64>(10)?,
                        "paid_at": r.get::<_, Option<i64>>(11)?,
                        "subscription_id": r.get::<_, Option<String>>(12)?,
                    }),
                ))
            },
        )
        .optional()?;
    let Some((owner, mut session)) = row else { return Ok(None) };
    if merchant_id.is_some_and(|m| m != owner) {
        return Ok(None);
    }
    if let Some(sub_id) = session["subscription_id"].as_str().map(str::to_string) {
        session["subscription"] = subscription_json(db, &sub_id, owner)?.unwrap_or(Value::Null);
    }
    Ok(Some(session))
}

pub fn session_status(invoice_status: &str) -> &'static str {
    match invoice_status {
        "paid" => "complete",
        "expired" => "expired",
        _ => "open",
    }
}

fn payment_status(invoice_status: &str) -> &'static str {
    match invoice_status {
        "paid" => "paid",
        "pending" => "processing",
        _ => "unpaid",
    }
}

/// What the payer's browser needs on the hosted payment page. Contains nothing about the
/// merchant's customer records — only what is being paid and how to pay it.
async fn hosted_page(State(state): State<AppState>, Path(id): Path<String>) -> ApiResult {
    let db = state.db.lock().unwrap();
    let page = db
        .query_row(
            "SELECT m.name, s.mode, s.success_url, s.cancel_url, i.id, i.status, i.address, i.code,
                    i.amount_zat, i.price_usd_cents, i.description, i.expires_at, p.period_days,
                    (SELECT COALESCE(SUM(value_zat), 0) FROM payments x WHERE x.invoice_id = i.id)
             FROM checkout_sessions s
             JOIN invoices i ON i.id = s.invoice_id
             JOIN merchants m ON m.id = s.merchant_id
             LEFT JOIN subscriptions sub ON sub.id = i.subscription_id
             LEFT JOIN plans p ON p.id = sub.plan_id
             WHERE s.id = ?1",
            [&id],
            |r| {
                let address: String = r.get(6)?;
                let amount_zat: i64 = r.get(8)?;
                let memo = format!("ZIDE1:{}", r.get::<_, String>(7)?);
                Ok(json!({
                    "session_id": id,
                    "merchant_name": r.get::<_, String>(0)?,
                    "mode": r.get::<_, String>(1)?,
                    "success_url": r.get::<_, String>(2)?.replace("{SESSION_ID}", &id),
                    "cancel_url": r.get::<_, String>(3)?,
                    "invoice_id": r.get::<_, String>(4)?,
                    "status": r.get::<_, String>(5)?,
                    "address": address,
                    "memo": memo,
                    "amount_zec": format_zec(amount_zat),
                    "payment_uri": payment_uri(&address, amount_zat, &memo),
                    "price_usd_cents": r.get::<_, i64>(9)?,
                    "description": r.get::<_, String>(10)?,
                    "expires_at": r.get::<_, i64>(11)?,
                    "period_days": r.get::<_, Option<i64>>(12)?,
                    "received_zat": r.get::<_, i64>(13)?,
                }))
            },
        )
        .optional()?;
    let mut page = page.ok_or(ApiError::NotFound("unknown payment session"))?;
    let invoice_id = page["invoice_id"].as_str().unwrap_or_default().to_string();
    let mut stmt = db.prepare("SELECT DISTINCT txid FROM payments WHERE invoice_id = ?1")?;
    let txids: Vec<String> = stmt.query_map([&invoice_id], |r| r.get(0))?.collect::<Result<_, _>>()?;
    page["txids"] = json!(txids);
    Ok(Json(page))
}
