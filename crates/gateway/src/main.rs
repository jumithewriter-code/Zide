//! Zide gateway: a payment gateway whose payments settle through shielded Zcash.
//!
//! HTTP API for merchants (checkout sessions, plans, webhooks) and for the hosted payment page,
//! plus a background task that matches shielded payments to invoices and notifies merchants.

mod api;
mod db;
mod ids;
mod inspect;
mod matcher;
mod merchants;
mod p2p;
mod sessions;
mod webhook;

use std::{
    net::SocketAddr,
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};

use anyhow::{anyhow, Context, Result};
use rusqlite::Connection;
use scanner::{keys, lwd::Lwd, rpc::ZebraRpc, source::Source};
use zcash_keys::keys::UnifiedFullViewingKey;
use zcash_protocol::consensus::Network;

pub struct Config {
    pub network: Network,
    pub ufvk: UnifiedFullViewingKey,
    /// Testnet stand-in for a price feed: USD per ZEC.
    pub zec_usd: f64,
    pub min_confirmations: u32,
    pub invoice_ttl_secs: i64,
    /// Where the hosted payment page is served; session URLs are built from it.
    pub public_url: String,
}

#[derive(Clone)]
pub struct AppState {
    pub db: Arc<Mutex<Connection>>,
    pub config: Arc<Config>,
    /// Separate chain connection for the demo transaction inspector (None when disabled).
    pub inspector: Option<Arc<tokio::sync::Mutex<Source>>>,
}

pub fn now() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).expect("clock before 1970").as_secs() as i64
}

fn env_or(key: &str, default: &str) -> String {
    std::env::var(key).ok().filter(|v| !v.is_empty()).unwrap_or_else(|| default.to_string())
}

fn env_parse<T: std::str::FromStr>(key: &str, default: &str) -> Result<T> {
    env_or(key, default).parse().map_err(|_| anyhow!("{key} is not a valid value"))
}

#[tokio::main]
async fn main() -> Result<()> {
    dotenvy::dotenv().ok();

    let network = match env_or("ZIDE_NETWORK", "test").as_str() {
        "main" => Network::MainNetwork,
        "test" => Network::TestNetwork,
        other => return Err(anyhow!("ZIDE_NETWORK must be main or test, got {other}")),
    };
    let ufvk_str = std::env::var("ZIDE_UFVK").context("set ZIDE_UFVK (run `scanner keygen`)")?;
    let config = Config {
        network,
        ufvk: keys::load_ufvk(&network, &ufvk_str)?,
        zec_usd: env_parse("ZIDE_ZEC_USD", "500")?,
        min_confirmations: env_parse("ZIDE_MIN_CONF", "1")?,
        invoice_ttl_secs: env_parse("ZIDE_INVOICE_TTL_SECS", "900")?,
        public_url: env_or("ZIDE_PUBLIC_URL", "http://localhost:5173").trim_end_matches('/').to_string(),
    };

    let conn = db::open(&env_or("ZIDE_DB", "zide.sqlite"))?;
    let new_lp_keys = db::seed(&conn)?;
    if !new_lp_keys.is_empty() {
        save_lp_keys(&env_or("ZIDE_LP_KEYS", "lp-keys.json"), &new_lp_keys)?;
    }

    let source = connect_source().await?;
    let scan_from: Option<u32> = std::env::var("ZIDE_SCAN_FROM").ok().and_then(|v| v.parse().ok());

    // The transaction inspector decrypts with Zide's key on request, so it is a demo feature:
    // anyone who can reach the API could look up amounts paid to Zide. Disable with ZIDE_TX_INSPECTOR=0.
    let inspector = if env_or("ZIDE_TX_INSPECTOR", "1") != "0" {
        Some(Arc::new(tokio::sync::Mutex::new(connect_source().await?)))
    } else {
        None
    };

    let state = AppState { db: Arc::new(Mutex::new(conn)), config: Arc::new(config), inspector };
    tokio::spawn(matcher::run(state.clone(), source, scan_from));

    let addr: SocketAddr = env_parse("ZIDE_HTTP_ADDR", "127.0.0.1:8080")?;
    let listener = tokio::net::TcpListener::bind(addr).await?;
    eprintln!("gateway API listening on http://{addr}");
    axum::serve(listener, api::router(state)).await?;
    Ok(())
}

/// Demo only: hands the simulated LPs their keys via a local (gitignored) file.
fn save_lp_keys(path: &str, keys: &[(String, String)]) -> Result<()> {
    let mut all: serde_json::Map<String, serde_json::Value> = std::fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();
    for (handle, key) in keys {
        all.insert(handle.clone(), key.clone().into());
    }
    std::fs::write(path, serde_json::to_string_pretty(&all)?).with_context(|| format!("writing {path}"))?;
    let handles: Vec<&str> = keys.iter().map(|(h, _)| h.as_str()).collect();
    eprintln!("issued LP keys for {} -> {path}", handles.join(", "));
    Ok(())
}

async fn connect_source() -> Result<Source> {
    Ok(match env_or("ZIDE_SOURCE", "lightwalletd").as_str() {
        "zebra" => Source::Zebra(ZebraRpc::new(
            env_or("ZEBRA_RPC_URL", "http://127.0.0.1:18232"),
            std::env::var("ZEBRA_RPC_USER").ok(),
            std::env::var("ZEBRA_RPC_PASSWORD").ok(),
            std::env::var("ZEBRA_RPC_COOKIE").ok().filter(|v| !v.is_empty()),
        )?),
        _ => {
            let url = env_or("ZIDE_LWD_URL", "https://testnet.zec.rocks:443");
            eprintln!("chain source: lightwalletd {url}");
            Source::Lightwalletd(Lwd::connect(&url).await?)
        }
    })
}
