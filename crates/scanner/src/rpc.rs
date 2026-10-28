//! Minimal JSON-RPC client for the handful of Zebra methods the scanner needs.

use anyhow::{anyhow, bail, Context, Result};
use serde::{de::DeserializeOwned, Deserialize};
use serde_json::{json, Value};

pub struct ZebraRpc {
    client: reqwest::Client,
    url: String,
    auth: Option<(String, String)>,
}

#[derive(Debug, Deserialize)]
pub struct BlockInfo {
    pub hash: String,
    pub height: u32,
    pub tx: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub struct RawTx {
    pub hex: String,
    /// Absent (or negative) while the transaction is still in the mempool.
    pub height: Option<i64>,
}

impl RawTx {
    pub fn mined_height(&self) -> Option<u32> {
        self.height.filter(|h| *h >= 0).map(|h| h as u32)
    }
}

impl ZebraRpc {
    /// `cookie_file` is Zebra's `.cookie` file (`__cookie__:<password>`); it is used when no
    /// explicit user/password is given.
    pub fn new(
        url: String,
        user: Option<String>,
        password: Option<String>,
        cookie_file: Option<String>,
    ) -> Result<Self> {
        let auth = match (user, password, cookie_file) {
            (Some(u), Some(p), _) => Some((u, p)),
            (_, _, Some(path)) => {
                let raw = std::fs::read_to_string(&path)
                    .with_context(|| format!("reading Zebra cookie file {path}"))?;
                let (u, p) = raw
                    .trim()
                    .split_once(':')
                    .ok_or_else(|| anyhow!("cookie file {path} is not in user:password form"))?;
                Some((u.to_string(), p.to_string()))
            }
            _ => None,
        };
        Ok(Self { client: reqwest::Client::new(), url, auth })
    }

    async fn call<T: DeserializeOwned>(&self, method: &str, params: Value) -> Result<T> {
        let mut req = self
            .client
            .post(&self.url)
            .json(&json!({ "jsonrpc": "2.0", "id": 1, "method": method, "params": params }));
        if let Some((u, p)) = &self.auth {
            req = req.basic_auth(u, Some(p));
        }
        let resp: Value = req
            .send()
            .await
            .with_context(|| format!("calling {method} on {}", self.url))?
            .json()
            .await
            .with_context(|| format!("decoding {method} response"))?;
        if !resp["error"].is_null() {
            bail!("rpc {method} failed: {}", resp["error"]);
        }
        serde_json::from_value(resp["result"].clone())
            .with_context(|| format!("unexpected {method} result shape"))
    }

    pub async fn tip_height(&self) -> Result<u32> {
        let info: Value = self.call("getblockchaininfo", json!([])).await?;
        info["blocks"]
            .as_u64()
            .map(|h| h as u32)
            .ok_or_else(|| anyhow!("getblockchaininfo has no `blocks` field"))
    }

    /// Verbosity 1: block header fields plus the list of txids.
    pub async fn block(&self, height: u32) -> Result<BlockInfo> {
        self.call("getblock", json!([height.to_string(), 1])).await
    }

    pub async fn raw_tx(&self, txid: &str) -> Result<RawTx> {
        self.call("getrawtransaction", json!([txid, 1])).await
    }

    pub async fn mempool(&self) -> Result<Vec<String>> {
        self.call("getrawmempool", json!([])).await
    }
}
