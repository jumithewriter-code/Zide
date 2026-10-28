//! Background task: follow the chain, record payments to invoice addresses, and settle invoices.

use std::{collections::HashSet, time::Duration};

use anyhow::Result;
use rusqlite::{params, Connection, OptionalExtension};
use scanner::{
    decrypt::{decrypt_incoming, IncomingPayment},
    source::Source,
};

use crate::{db, now, webhook, AppState};

const POLL: Duration = Duration::from_secs(5);

pub async fn run(state: AppState, mut source: Source, scan_from: Option<u32>) {
    let mut seen_in_mempool = HashSet::new();
    loop {
        if let Err(e) = tick(&state, &mut source, scan_from, &mut seen_in_mempool).await {
            eprintln!("matcher: {e:#}");
        }
        tokio::time::sleep(POLL).await;
    }
}

async fn tick(
    state: &AppState,
    source: &mut Source,
    scan_from: Option<u32>,
    seen_in_mempool: &mut HashSet<String>,
) -> Result<()> {
    let tip = source.tip_height().await?;
    let last_scanned: Option<u32> = {
        let db = state.db.lock().unwrap();
        db::kv_get(&db, "scan_height")?.map(|v| v.parse()).transpose()?
    };
    let mut next = match last_scanned {
        Some(h) => h + 1,
        None => scan_from.unwrap_or(tip),
    };

    while next <= tip {
        let block = source.block(next).await?;
        for txid in &block.txids {
            match fetch_and_decrypt(state, source, txid, tip).await {
                Ok(hits) => record(state, &hits)?,
                Err(e) => eprintln!("matcher: skipping {txid} in block {next}: {e:#}"),
            }
        }
        let db = state.db.lock().unwrap();
        db::kv_set(&db, "scan_height", &next.to_string())?;
        next += 1;
    }

    let mempool = source.mempool_txids().await?;
    for txid in &mempool {
        if seen_in_mempool.insert(txid.clone()) {
            match fetch_and_decrypt(state, source, txid, tip).await {
                Ok(hits) => record(state, &hits)?,
                Err(e) => eprintln!("matcher: skipping mempool tx {txid}: {e:#}"),
            }
        }
    }
    let current: HashSet<&String> = mempool.iter().collect();
    seen_in_mempool.retain(|t| current.contains(t));

    let events = {
        let db = state.db.lock().unwrap();
        settle(&db, tip, state.config.min_confirmations, &state.config.public_url)?
    };
    for event in events {
        tokio::spawn(webhook::deliver(state.clone(), event));
    }
    Ok(())
}

async fn fetch_and_decrypt(
    state: &AppState,
    source: &mut Source,
    txid: &str,
    tip: u32,
) -> Result<Vec<IncomingPayment>> {
    let tx = source.transaction(txid).await?;
    decrypt_incoming(&state.config.network, &tx.data, tx.mined_height, tip, &state.config.ufvk)
}

/// Matches each output to an invoice — by receiving address (diversifier index) first,
/// then by `ZIDE1:<code>` memo — and stores it.
fn record(state: &AppState, hits: &[IncomingPayment]) -> Result<()> {
    if hits.is_empty() {
        return Ok(());
    }
    let db = state.db.lock().unwrap();
    for p in hits {
        let Some(invoice_id) = find_invoice(&db, p)? else {
            eprintln!("matcher: unmatched payment {}#{} ({} zat)", p.txid, p.output_index, p.value_zat);
            continue;
        };
        db.execute(
            "INSERT INTO payments (txid, pool, output_index, invoice_id, value_zat, mined_height)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(txid, pool, output_index)
             DO UPDATE SET mined_height = COALESCE(excluded.mined_height, payments.mined_height)",
            params![p.txid, p.pool, p.output_index as i64, invoice_id, p.value_zat as i64, p.mined_height],
        )?;
        let moved = db.execute(
            "UPDATE invoices SET status = 'pending' WHERE id = ?1 AND status = 'open'",
            [&invoice_id],
        )?;
        let state_label = if p.mined_height.is_some() { "mined" } else { "mempool" };
        eprintln!(
            "matcher: {state_label} payment of {} zat for {invoice_id}{}",
            p.value_zat,
            if moved > 0 { " -> pending" } else { "" }
        );
    }
    Ok(())
}

pub(crate) fn find_invoice(db: &Connection, p: &IncomingPayment) -> Result<Option<String>> {
    if let Some(j) = p.diversifier_index.and_then(|j| i64::try_from(j).ok()) {
        let by_index = db
            .query_row("SELECT id FROM invoices WHERE div_index = ?1", [j], |r| r.get(0))
            .optional()?;
        if by_index.is_some() {
            return Ok(by_index);
        }
    }
    let code = p
        .memo
        .as_deref()
        .and_then(|m| m.trim().strip_prefix("ZIDE1:"))
        .map(|c| c.trim().to_ascii_uppercase());
    match code {
        Some(code) => Ok(db
            .query_row("SELECT id FROM invoices WHERE code = ?1", [code], |r| r.get(0))
            .optional()?),
        None => Ok(None),
    }
}

/// Marks invoices paid once enough confirmed value has arrived, activates or extends their
/// subscription, and expires untouched invoices. Returns webhook events to send.
fn settle(db: &Connection, tip: u32, min_conf: u32, public_url: &str) -> Result<Vec<webhook::Event>> {
    let now = now();
    db.execute(
        "UPDATE invoices SET status = 'expired' WHERE status = 'open' AND expires_at < ?1",
        [now],
    )?;

    // Confirmations = tip - height + 1, so "mined at or below this height" means confirmed.
    let confirmed_at_or_below = i64::from(tip) - i64::from(min_conf.max(1)) + 1;
    let mut stmt = db.prepare(
        "SELECT i.id, i.merchant_id, i.subscription_id, i.amount_zat,
                (SELECT COALESCE(SUM(value_zat), 0) FROM payments p
                  WHERE p.invoice_id = i.id AND p.mined_height IS NOT NULL AND p.mined_height <= ?1)
         FROM invoices i WHERE i.status = 'pending'",
    )?;
    let ready: Vec<(String, i64, Option<String>, i64, i64)> = stmt
        .query_map([confirmed_at_or_below], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)))?
        .collect::<Result<_, _>>()?;

    let mut events = Vec::new();
    for (invoice_id, merchant_id, sub_id, amount, received) in ready {
        // 1% tolerance for rounding in wallets / price display.
        if received * 100 < amount * 99 {
            continue;
        }
        db.execute(
            "UPDATE invoices SET status = 'paid', paid_at = ?2 WHERE id = ?1",
            params![invoice_id, now],
        )?;

        let mut renewal = false;
        if let Some(sub_id) = &sub_id {
            let (was_active, period_end, period_days): (bool, Option<i64>, i64) = db.query_row(
                "SELECT s.status = 'active', s.current_period_end, p.period_days
                 FROM subscriptions s JOIN plans p ON p.id = s.plan_id WHERE s.id = ?1",
                [sub_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )?;
            let new_end = period_end.unwrap_or(0).max(now) + period_days * 86_400;
            db.execute(
                "UPDATE subscriptions SET status = 'active', current_period_end = ?2 WHERE id = ?1",
                params![sub_id, new_end],
            )?;
            renewal = was_active;
        }
        eprintln!("matcher: {invoice_id} PAID");

        let session_id: Option<String> = db
            .query_row("SELECT id FROM checkout_sessions WHERE invoice_id = ?1", [&invoice_id], |r| r.get(0))
            .optional()?;
        if let Some(session_id) = session_id {
            if let Some(mut session) =
                crate::sessions::session_json(db, &session_id, public_url, Some(merchant_id)).map_err(|e| match e {
                    crate::api::ApiError::Internal(e) => e,
                    _ => anyhow::anyhow!("session lookup failed"),
                })?
            {
                session["renewal"] = renewal.into();
                events.push(webhook::Event { merchant_id, kind: "checkout.completed", data: session });
            }
        }
    }
    Ok(events)
}
