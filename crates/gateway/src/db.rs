//! SQLite schema (gateway model) and seed data. There are deliberately no columns for names,
//! emails, card/bank details or sender addresses — merchants pass an opaque `reference` instead.

use anyhow::Result;
use rusqlite::{params, Connection, OptionalExtension};

const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS merchants (
    id             INTEGER PRIMARY KEY,
    slug           TEXT NOT NULL UNIQUE,
    name           TEXT NOT NULL,
    webhook_url    TEXT,
    webhook_secret TEXT NOT NULL,
    created_at     INTEGER NOT NULL
);
-- Secret API keys, stored only as SHA-256 hashes.
CREATE TABLE IF NOT EXISTS api_keys (
    key_hash    TEXT PRIMARY KEY,
    merchant_id INTEGER NOT NULL REFERENCES merchants(id),
    created_at  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS plans (
    id              INTEGER PRIMARY KEY,
    merchant_id     INTEGER NOT NULL REFERENCES merchants(id),
    name            TEXT NOT NULL,
    price_usd_cents INTEGER NOT NULL,
    period_days     INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS subscriptions (
    id                 TEXT PRIMARY KEY,
    merchant_id        INTEGER NOT NULL REFERENCES merchants(id),
    plan_id            INTEGER NOT NULL REFERENCES plans(id),
    reference          TEXT,
    status             TEXT NOT NULL CHECK (status IN ('pending', 'active')),
    current_period_end INTEGER
);
CREATE TABLE IF NOT EXISTS invoices (
    id              TEXT PRIMARY KEY,
    code            TEXT NOT NULL UNIQUE,
    merchant_id     INTEGER NOT NULL REFERENCES merchants(id),
    subscription_id TEXT REFERENCES subscriptions(id),
    div_index       INTEGER NOT NULL UNIQUE,
    address         TEXT NOT NULL,
    amount_zat      INTEGER NOT NULL,
    price_usd_cents INTEGER NOT NULL,
    description     TEXT NOT NULL,
    status          TEXT NOT NULL CHECK (status IN ('open', 'pending', 'paid', 'expired')),
    created_at      INTEGER NOT NULL,
    expires_at      INTEGER NOT NULL,
    paid_at         INTEGER
);
CREATE TABLE IF NOT EXISTS checkout_sessions (
    id          TEXT PRIMARY KEY,
    merchant_id INTEGER NOT NULL REFERENCES merchants(id),
    invoice_id  TEXT NOT NULL UNIQUE REFERENCES invoices(id),
    mode        TEXT NOT NULL CHECK (mode IN ('payment', 'subscription')),
    reference   TEXT,
    success_url TEXT NOT NULL,
    cancel_url  TEXT NOT NULL,
    created_at  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS payments (
    txid         TEXT NOT NULL,
    pool         TEXT NOT NULL,
    output_index INTEGER NOT NULL,
    invoice_id   TEXT NOT NULL REFERENCES invoices(id),
    value_zat    INTEGER NOT NULL,
    mined_height INTEGER,
    PRIMARY KEY (txid, pool, output_index)
);
-- Peer-to-peer liquidity providers: they take the customer's fiat and send shielded ZEC.
-- They see an amount and a random reference, never the merchant or what was bought.
CREATE TABLE IF NOT EXISTS lps (
    id       INTEGER PRIMARY KEY,
    handle   TEXT NOT NULL UNIQUE,
    method   TEXT NOT NULL,
    pay_to   TEXT NOT NULL,
    key_hash TEXT UNIQUE          -- SHA-256 of the LP's lp_test_… key
);
CREATE TABLE IF NOT EXISTS lp_orders (
    id          TEXT PRIMARY KEY,
    invoice_id  TEXT NOT NULL UNIQUE REFERENCES invoices(id),
    lp_id       INTEGER NOT NULL REFERENCES lps(id),
    reference   TEXT NOT NULL UNIQUE,
    fiat_cents  INTEGER NOT NULL,
    status      TEXT NOT NULL CHECK (status IN ('awaiting_fiat', 'fiat_sent', 'fiat_received')),
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS kv (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"#;

/// Diversifier indexes below this were used by the v1 (marketplace) database on testnet;
/// starting above them guarantees no invoice address is ever reused.
pub const FIRST_INVOICE_INDEX: u32 = 1000;

pub fn open(path: &str) -> Result<Connection> {
    let conn = Connection::open(path)?;
    conn.execute_batch("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;")?;
    let old_schema: bool = conn
        .query_row(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'subscriptions'
             AND sql LIKE '%license_hash%'",
            [],
            |_| Ok(true),
        )
        .optional()?
        .unwrap_or(false);
    anyhow::ensure!(!old_schema, "{path} uses the old marketplace schema; move it aside (e.g. zide-v1.sqlite)");
    conn.execute_batch(SCHEMA)?;
    // Databases created before LP keys existed lack the column.
    let has_lp_keys: bool = conn
        .query_row("SELECT 1 FROM pragma_table_info('lps') WHERE name = 'key_hash'", [], |_| Ok(true))
        .optional()?
        .unwrap_or(false);
    if !has_lp_keys {
        conn.execute_batch("ALTER TABLE lps ADD COLUMN key_hash TEXT")?;
    }
    Ok(conn)
}

pub fn kv_get(conn: &Connection, key: &str) -> Result<Option<String>> {
    Ok(conn
        .query_row("SELECT value FROM kv WHERE key = ?1", [key], |r| r.get(0))
        .optional()?)
}

pub fn kv_set(conn: &Connection, key: &str, value: &str) -> Result<()> {
    conn.execute(
        "INSERT INTO kv (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )?;
    Ok(())
}

/// Demo liquidity providers, inserted once into an empty table. Merchants sign up via the API.
/// Any LP without a key gets one; the new `(handle, key)` pairs are returned so the caller can
/// hand them to the LP (keys are stored only as hashes).
pub fn seed(conn: &Connection) -> Result<Vec<(String, String)>> {
    let lp_count: i64 = conn.query_row("SELECT COUNT(*) FROM lps", [], |r| r.get(0))?;
    if lp_count == 0 {
        for (handle, method, pay_to) in [
            ("amber", "Bank transfer (SEPA)", "IBAN DE89 3704 0044 0532 0130 00 (demo)"),
            ("kite", "UPI", "kite-lp@upi (demo)"),
        ] {
            conn.execute(
                "INSERT INTO lps (handle, method, pay_to) VALUES (?1, ?2, ?3)",
                params![handle, method, pay_to],
            )?;
        }
    }

    let mut stmt = conn.prepare("SELECT id, handle FROM lps WHERE key_hash IS NULL")?;
    let keyless: Vec<(i64, String)> = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?.collect::<Result<_, _>>()?;
    let mut issued = Vec::new();
    for (id, handle) in keyless {
        let key = crate::ids::lp_key();
        conn.execute("UPDATE lps SET key_hash = ?2 WHERE id = ?1", params![id, crate::ids::sha256_hex(&key)])?;
        issued.push((handle, key));
    }
    Ok(issued)
}
