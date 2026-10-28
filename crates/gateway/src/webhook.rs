//! Signed merchant notifications. The payload is the merchant's own session (with its opaque
//! `reference`) — never a txid, address, or anything about the payer.

use std::time::Duration;

use hmac::{Hmac, KeyInit, Mac};
use rusqlite::OptionalExtension;
use serde_json::{json, Value};
use sha2::Sha256;

use crate::{ids, now, AppState};

pub struct Event {
    pub merchant_id: i64,
    pub kind: &'static str,
    pub data: Value,
}

pub fn sign(secret: &str, body: &str) -> String {
    let mut mac = Hmac::<Sha256>::new_from_slice(secret.as_bytes()).expect("HMAC accepts any key length");
    mac.update(body.as_bytes());
    format!("sha256={}", hex::encode(mac.finalize().into_bytes()))
}

pub async fn deliver(state: AppState, event: Event) {
    let target = {
        let db = state.db.lock().unwrap();
        db.query_row(
            "SELECT webhook_url, webhook_secret, name FROM merchants WHERE id = ?1 AND webhook_url IS NOT NULL",
            [event.merchant_id],
            |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?)),
        )
        .optional()
    };
    let (url, secret, merchant) = match target {
        Ok(Some(t)) => t,
        Ok(None) => return, // merchant has no webhook configured
        Err(e) => return eprintln!("webhook: lookup failed: {e:#}"),
    };

    let body = json!({
        "id": ids::prefixed_id("evt"),
        "type": event.kind,
        "created": now(),
        "data": event.data,
    })
    .to_string();
    let signature = sign(&secret, &body);

    let client = reqwest::Client::new();
    for attempt in 1..=3u32 {
        let sent = client
            .post(&url)
            .header("content-type", "application/json")
            .header("zide-signature", &signature)
            .body(body.clone())
            .timeout(Duration::from_secs(10))
            .send()
            .await;
        match sent {
            Ok(resp) if resp.status().is_success() => {
                return eprintln!("webhook: {} delivered to {merchant}", event.kind);
            }
            Ok(resp) => eprintln!("webhook: attempt {attempt} to {url} got {}", resp.status()),
            Err(e) => eprintln!("webhook: attempt {attempt} to {url} failed: {e}"),
        }
        tokio::time::sleep(Duration::from_secs(2u64.pow(attempt))).await;
    }
}
