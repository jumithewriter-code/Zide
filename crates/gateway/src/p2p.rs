//! Simulated peer-to-peer on-ramp.
//!
//! The customer pays an LP in fiat and quotes a random reference; the LP confirms the money
//! arrived and sends shielded ZEC from their own wallet to the invoice's one-time address.
//! LP-facing responses never include the app, plan or subscription.
//!
//! LP endpoints require the LP's own key (`Authorization: Bearer lp_test_…`) and only ever touch
//! that LP's orders. Customer endpoints are addressed by unguessable invoice/order ids.
//!
//! Demo simplification: nothing escrows the LP's ZEC and the LP confirms fiat by hand
//! (production: FROST threshold escrow + zkTLS proof of the fiat payment).

use axum::{
    extract::{Path, State},
    http::HeaderMap,
    routing::{get, post},
    Json, Router,
};
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};

use crate::{
    api::{format_zec, payment_uri, ApiError, ApiResult},
    ids, now, AppState,
};

/// P2P trades take longer than a wallet payment, so the quote window is extended.
const P2P_WINDOW_SECS: i64 = 60 * 60;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/v1/invoices/{id}/p2p", post(start_order).get(existing_order))
        .route("/v1/p2p/{order_id}", get(customer_view))
        .route("/v1/p2p/{order_id}/sent", post(mark_sent))
        .route("/v1/lps", post(lp_sign_up))
        .route("/v1/lp", get(lp_me))
        .route("/v1/lp/orders", get(lp_orders))
        .route("/v1/lp/orders/{order_id}/confirm", post(confirm_fiat))
}

/// Resolves `Authorization: Bearer lp_test_…` to `(lp_id, handle, method)`.
fn authenticate_lp(db: &Connection, headers: &HeaderMap) -> Result<(i64, String, String), ApiError> {
    let key = headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .ok_or(ApiError::Unauthorized)?;
    db.query_row(
        "SELECT id, handle, method FROM lps WHERE key_hash = ?1",
        [ids::sha256_hex(key)],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
    )
    .optional()?
    .ok_or(ApiError::Unauthorized)
}

/// Customer chose "pay with cash": match an LP (fewest open orders) or return the existing match.
async fn start_order(State(state): State<AppState>, Path(invoice_id): Path<String>) -> ApiResult {
    let db = state.db.lock().unwrap();
    let invoice: Option<(String, i64)> = db
        .query_row(
            "SELECT status, price_usd_cents FROM invoices WHERE id = ?1",
            [&invoice_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?;
    let (status, price_cents) = invoice.ok_or(ApiError::NotFound("unknown invoice"))?;

    let existing: Option<String> = db
        .query_row("SELECT id FROM lp_orders WHERE invoice_id = ?1", [&invoice_id], |r| r.get(0))
        .optional()?;
    if let Some(order_id) = existing {
        return Ok(Json(customer_order(&db, &order_id)?));
    }
    if status != "open" {
        return Err(ApiError::BadRequest("invoice is no longer open".into()));
    }

    let lp_id: i64 = db
        .query_row(
            "SELECT l.id FROM lps l
             ORDER BY (SELECT COUNT(*) FROM lp_orders o JOIN invoices i ON i.id = o.invoice_id
                       WHERE o.lp_id = l.id AND i.status IN ('open', 'pending')), RANDOM()
             LIMIT 1",
            [],
            |r| r.get(0),
        )
        .optional()?
        .ok_or(ApiError::BadRequest("no liquidity providers available".into()))?;

    let order_id = ids::prefixed_id("ord");
    let reference = format!("ZR-{}", &ids::invoice_code()[..6]);
    let ts = now();
    db.execute(
        "INSERT INTO lp_orders (id, invoice_id, lp_id, reference, fiat_cents, status, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 'awaiting_fiat', ?6, ?6)",
        params![order_id, invoice_id, lp_id, reference, price_cents, ts],
    )?;
    db.execute(
        "UPDATE invoices SET expires_at = MAX(expires_at, ?2) WHERE id = ?1",
        params![invoice_id, ts + P2P_WINDOW_SECS],
    )?;
    Ok(Json(customer_order(&db, &order_id)?))
}

/// Lets a reloaded checkout pick up its cash order, if one was started.
async fn existing_order(State(state): State<AppState>, Path(invoice_id): Path<String>) -> ApiResult {
    let db = state.db.lock().unwrap();
    let order_id: String = db
        .query_row("SELECT id FROM lp_orders WHERE invoice_id = ?1", [&invoice_id], |r| r.get(0))
        .optional()?
        .ok_or(ApiError::NotFound("no cash order for this invoice"))?;
    Ok(Json(customer_order(&db, &order_id)?))
}

async fn customer_view(State(state): State<AppState>, Path(order_id): Path<String>) -> ApiResult {
    let db = state.db.lock().unwrap();
    Ok(Json(customer_order(&db, &order_id)?))
}

async fn mark_sent(State(state): State<AppState>, Path(order_id): Path<String>) -> ApiResult {
    let db = state.db.lock().unwrap();
    db.execute(
        "UPDATE lp_orders SET status = 'fiat_sent', updated_at = ?2 WHERE id = ?1 AND status = 'awaiting_fiat'",
        params![order_id, now()],
    )?;
    Ok(Json(customer_order(&db, &order_id)?))
}

#[derive(serde::Deserialize)]
struct LpSignUp {
    handle: String,
    method: String,
    pay_to: String,
}

/// Become a liquidity provider. Demo: open sign-up; the key is shown once and stored as a hash.
/// `pay_to` is the LP's own payout details, shown to customers matched with this LP.
async fn lp_sign_up(State(state): State<AppState>, Json(req): Json<LpSignUp>) -> ApiResult {
    let handle = req.handle.trim().to_ascii_lowercase();
    if !(3..=24).contains(&handle.len()) || !handle.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-') {
        return Err(ApiError::BadRequest("handle must be 3-24 letters, digits or dashes".into()));
    }
    let (method, pay_to) = (req.method.trim(), req.pay_to.trim());
    if method.is_empty() || method.len() > 40 || pay_to.is_empty() || pay_to.len() > 80 {
        return Err(ApiError::BadRequest("method (1-40 chars) and pay_to (1-80 chars) are required".into()));
    }
    let db = state.db.lock().unwrap();
    let taken: bool = db.query_row("SELECT 1 FROM lps WHERE handle = ?1", [&handle], |_| Ok(true)).optional()?.unwrap_or(false);
    if taken {
        return Err(ApiError::BadRequest("that handle is taken".into()));
    }
    let key = ids::lp_key();
    db.execute(
        "INSERT INTO lps (handle, method, pay_to, key_hash) VALUES (?1, ?2, ?3, ?4)",
        params![handle, method, pay_to, ids::sha256_hex(&key)],
    )?;
    Ok(Json(json!({
        "lp": { "handle": handle, "method": method },
        "lp_key": key,
        "note": "Store this key now: it is shown only once.",
    })))
}

async fn lp_me(State(state): State<AppState>, headers: HeaderMap) -> ApiResult {
    let db = state.db.lock().unwrap();
    let (_, handle, method) = authenticate_lp(&db, &headers)?;
    Ok(Json(json!({ "handle": handle, "method": method })))
}

/// The LP's view: amount, reference and — only after they confirm the fiat — where to send ZEC.
async fn lp_orders(State(state): State<AppState>, headers: HeaderMap) -> ApiResult {
    let db = state.db.lock().unwrap();
    let (lp_id, _, _) = authenticate_lp(&db, &headers)?;
    let mut stmt = db.prepare(
        "SELECT o.id, o.reference, o.fiat_cents, o.status, o.created_at,
                i.status, i.address, i.amount_zat, i.code
         FROM lp_orders o JOIN invoices i ON i.id = o.invoice_id
         WHERE o.lp_id = ?1 ORDER BY o.created_at DESC LIMIT 50",
    )?;
    let orders = stmt
        .query_map([lp_id], |r| {
            let order_status: String = r.get(3)?;
            let invoice_status: String = r.get(5)?;
            let (address, amount_zat, code): (String, i64, String) = (r.get(6)?, r.get(7)?, r.get(8)?);
            let mut order = json!({
                "order_id": r.get::<_, String>(0)?,
                "reference": r.get::<_, String>(1)?,
                "fiat_cents": r.get::<_, i64>(2)?,
                "status": effective_status(&order_status, &invoice_status),
                "created_at": r.get::<_, i64>(4)?,
            });
            if order_status == "fiat_received" && invoice_status != "paid" {
                let memo = format!("ZIDE1:{code}");
                order["send"] = json!({
                    "address": address,
                    "amount_zec": format_zec(amount_zat),
                    "memo": memo,
                    "payment_uri": payment_uri(&address, amount_zat, &memo),
                });
            }
            Ok(order)
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(Json(json!({ "orders": orders })))
}

async fn confirm_fiat(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(order_id): Path<String>,
) -> ApiResult {
    let db = state.db.lock().unwrap();
    let (lp_id, _, _) = authenticate_lp(&db, &headers)?;
    // Only the LP the order was matched to can confirm it.
    let changed = db.execute(
        "UPDATE lp_orders SET status = 'fiat_received', updated_at = ?3
         WHERE id = ?1 AND lp_id = ?2 AND status IN ('awaiting_fiat', 'fiat_sent')",
        params![order_id, lp_id, now()],
    )?;
    if changed == 0 {
        return Err(ApiError::NotFound("no open order with that id"));
    }
    Ok(Json(json!({ "order_id": order_id, "status": "fiat_received" })))
}

/// Once the shielded payment lands, the trade is complete regardless of earlier clicks.
fn effective_status(order_status: &str, invoice_status: &str) -> String {
    match invoice_status {
        "paid" => "completed".into(),
        "pending" => "zec_sent".into(),
        "expired" => "expired".into(),
        _ => order_status.into(),
    }
}

/// The customer's view: who to pay, how much, and the reference to quote.
fn customer_order(db: &Connection, order_id: &str) -> Result<Value, ApiError> {
    db.query_row(
        "SELECT o.id, o.invoice_id, o.reference, o.fiat_cents, o.status, i.status, i.expires_at,
                l.handle, l.method, l.pay_to
         FROM lp_orders o JOIN lps l ON l.id = o.lp_id JOIN invoices i ON i.id = o.invoice_id
         WHERE o.id = ?1",
        [order_id],
        |r| {
            let order_status: String = r.get(4)?;
            let invoice_status: String = r.get(5)?;
            Ok(json!({
                "order_id": r.get::<_, String>(0)?,
                "invoice_id": r.get::<_, String>(1)?,
                "reference": r.get::<_, String>(2)?,
                "fiat_cents": r.get::<_, i64>(3)?,
                "status": effective_status(&order_status, &invoice_status),
                "expires_at": r.get::<_, i64>(6)?,
                "lp": {
                    "handle": r.get::<_, String>(7)?,
                    "method": r.get::<_, String>(8)?,
                    "pay_to": r.get::<_, String>(9)?,
                },
            }))
        },
    )
    .optional()?
    .ok_or(ApiError::NotFound("unknown order"))
}
