//! Where the scanner reads the chain from: a public lightwalletd server or our own Zebra node.

use anyhow::Result;

use crate::{lwd::Lwd, rpc::ZebraRpc};

pub enum Source {
    Lightwalletd(Lwd),
    Zebra(ZebraRpc),
}

pub struct Block {
    pub hash: String,
    pub txids: Vec<String>,
}

pub struct Tx {
    pub data: Vec<u8>,
    pub mined_height: Option<u32>,
}

impl Source {
    pub async fn tip_height(&mut self) -> Result<u32> {
        match self {
            Source::Lightwalletd(l) => l.tip_height().await,
            Source::Zebra(z) => z.tip_height().await,
        }
    }

    pub async fn block(&mut self, height: u32) -> Result<Block> {
        match self {
            Source::Lightwalletd(l) => {
                let (hash, txids) = l.block_txids(height).await?;
                Ok(Block { hash, txids })
            }
            Source::Zebra(z) => {
                let b = z.block(height).await?;
                anyhow::ensure!(b.height == height, "node returned block {} for {height}", b.height);
                Ok(Block { hash: b.hash, txids: b.tx })
            }
        }
    }

    pub async fn mempool_txids(&mut self) -> Result<Vec<String>> {
        match self {
            Source::Lightwalletd(l) => l.mempool_txids().await,
            Source::Zebra(z) => z.mempool().await,
        }
    }

    pub async fn transaction(&mut self, txid: &str) -> Result<Tx> {
        match self {
            Source::Lightwalletd(l) => {
                let t = l.transaction(txid).await?;
                Ok(Tx { data: t.data, mined_height: t.mined_height })
            }
            Source::Zebra(z) => {
                let raw = z.raw_tx(txid).await?;
                Ok(Tx { data: hex::decode(&raw.hex)?, mined_height: raw.mined_height() })
            }
        }
    }
}
