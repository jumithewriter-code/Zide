//! Demo transaction inspector: puts the public view of a transaction (what an explorer shows)
//! next to what Zide's viewing key reveals. Public testnet explorers don't follow NU7 yet,
//! so this reads the transaction straight from the chain.

use axum::{
    extract::{Path, State},
    routing::get,
    Json, Router,
};
use rusqlite::OptionalExtension;
use scanner::{decrypt::decrypt_incoming, public::public_view};
use serde_json::json;

use crate::{
    api::{format_zec, ApiError, ApiResult},
    matcher::find_invoice,
    AppState,
};

pub fn routes() -> Router<AppState> {
    Router::new().route("/v1/tx/{txid}", get(inspect))
}

async fn inspect(State(state): State<AppState>, Path(txid): Path<String>) -> ApiResult {
    let source = state.inspector.as_ref().ok_or(ApiError::NotFound("transaction inspector is disabled"))?;
    if txid.len() != 64 || !txid.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err(ApiError::BadRequest("txid must be 64 hex characters".into()));
    }
    let (tip, tx) = {
        let mut source = source.lock().await;
        let tip = source.tip_height().await?;
        let tx = source.transaction(&txid.to_ascii_lowercase()).await.map_err(|_| ApiError::NotFound("transaction not found on chain"))?;
        (tip, tx)
    };

    let cfg = &state.config;
    let public = public_view(&cfg.network, &tx.data, tx.mined_height, tip)?;
    let hits = decrypt_incoming(&cfg.network, &tx.data, tx.mined_height, tip, &cfg.ufvk)?;

    let db = state.db.lock().unwrap();
    let mut zide_view = Vec::new();
    for hit in &hits {
        let invoice = match find_invoice(&db, hit)? {
            Some(id) => db
                .query_row("SELECT id, status FROM invoices WHERE id = ?1", [&id], |r| {
                    Ok(json!({ "id": r.get::<_, String>(0)?, "status": r.get::<_, String>(1)? }))
                })
                .optional()?,
            None => None,
        };
        zide_view.push(json!({
            "pool": hit.pool,
            "amount_zec": format_zec(hit.value_zat as i64),
            "memo": hit.memo,
            "invoice": invoice,
        }));
    }
    Ok(Json(json!({
        "public": public,
        "confirmations": tx.mined_height.map(|h| tip.saturating_sub(h) + 1),
        "zide_view": zide_view,
    })))
}
