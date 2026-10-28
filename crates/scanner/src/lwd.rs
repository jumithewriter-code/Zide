//! lightwalletd gRPC client (the server Zcash mobile wallets use).
//!
//! We fetch the full transaction for every shielded tx in each block, so the server learns
//! nothing about which transactions are ours.

use anyhow::{bail, Context, Result};
use tonic::transport::{Channel, ClientTlsConfig};
use zcash_client_backend::proto::service::{
    compact_tx_streamer_client::CompactTxStreamerClient, BlockId, ChainSpec, GetMempoolTxRequest,
    TxFilter,
};

pub struct Lwd {
    client: CompactTxStreamerClient<Channel>,
}

pub struct LwdTx {
    pub data: Vec<u8>,
    pub mined_height: Option<u32>,
}

impl Lwd {
    /// `url` like `https://testnet.zec.rocks:443`.
    pub async fn connect(url: &str) -> Result<Self> {
        let mut endpoint = Channel::from_shared(url.to_string()).context("invalid lightwalletd URL")?;
        if url.starts_with("https://") {
            endpoint = endpoint.tls_config(ClientTlsConfig::new().with_webpki_roots())?;
        }
        let channel = endpoint
            .connect()
            .await
            .with_context(|| format!("connecting to lightwalletd at {url}"))?;
        Ok(Self { client: CompactTxStreamerClient::new(channel) })
    }

    pub async fn tip_height(&mut self) -> Result<u32> {
        let tip = self.client.get_latest_block(ChainSpec {}).await?.into_inner();
        Ok(u32::try_from(tip.height)?)
    }

    /// Txids (display hex) of the shielded transactions in a block, plus the block hash.
    pub async fn block_txids(&mut self, height: u32) -> Result<(String, Vec<String>)> {
        let block = self
            .client
            .get_block(BlockId { height: height.into(), hash: vec![] })
            .await?
            .into_inner();
        if block.height != u64::from(height) {
            bail!("server returned block {} for height {height}", block.height);
        }
        let txids = block.vtx.iter().map(|tx| display_hex(&tx.txid)).collect();
        Ok((display_hex(&block.hash), txids))
    }

    pub async fn mempool_txids(&mut self) -> Result<Vec<String>> {
        let mut stream = self
            .client
            .get_mempool_tx(GetMempoolTxRequest { exclude_txid_suffixes: vec![], pool_types: vec![] })
            .await?
            .into_inner();
        let mut txids = Vec::new();
        while let Some(tx) = stream.message().await? {
            txids.push(display_hex(&tx.txid));
        }
        Ok(txids)
    }

    pub async fn transaction(&mut self, txid: &str) -> Result<LwdTx> {
        let mut hash = hex::decode(txid).context("txid is not hex")?;
        hash.reverse(); // display order -> protocol order
        let raw = self
            .client
            .get_transaction(TxFilter { block: None, index: 0, hash })
            .await
            .with_context(|| format!("fetching {txid}"))?
            .into_inner();
        // height 0 = mempool, u64::MAX = mined on a fork (treat as unmined).
        let mined_height = match raw.height {
            0 | u64::MAX => None,
            h => Some(u32::try_from(h)?),
        };
        Ok(LwdTx { data: raw.data, mined_height })
    }
}

/// Hashes on the wire are in protocol (little-endian) order; humans and explorers use reversed hex.
fn display_hex(bytes: &[u8]) -> String {
    let mut b = bytes.to_vec();
    b.reverse();
    hex::encode(b)
}
