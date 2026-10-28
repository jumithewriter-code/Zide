//! Trial decryption of shielded outputs with the gateway's viewing key.

use std::collections::HashMap;

use anyhow::{Context, Result};
use orchard::keys::Scope;
use zcash_client_backend::{decrypt_transaction, TransferType};
use zcash_keys::keys::UnifiedFullViewingKey;
use zcash_primitives::transaction::Transaction;
use zcash_protocol::{
    consensus::{BlockHeight, BranchId, Network},
    memo::{Memo, MemoBytes},
};

/// One shielded output paid to an address derived from our viewing key.
#[derive(Debug, Clone)]
pub struct IncomingPayment {
    pub txid: String,
    pub pool: &'static str,
    pub output_index: usize,
    pub value_zat: u64,
    /// ZIP 302 text memo, if the sender attached one.
    pub memo: Option<String>,
    /// Diversifier index of the receiving address — identifies the invoice.
    pub diversifier_index: Option<u128>,
    pub mined_height: Option<u32>,
}

/// Parses a raw transaction and returns every incoming output our UFVK can decrypt.
/// Change (`AccountInternal`) and outgoing outputs are skipped.
pub fn decrypt_incoming(
    network: &Network,
    tx_bytes: &[u8],
    mined_height: Option<u32>,
    tip_height: u32,
    ufvk: &UnifiedFullViewingKey,
) -> Result<Vec<IncomingPayment>> {
    // Mempool transactions will be mined in the next block, so parse them with its branch.
    let parse_height = BlockHeight::from_u32(mined_height.unwrap_or(tip_height + 1));
    let tx = Transaction::read(tx_bytes, BranchId::for_height(network, parse_height))
        .context("parsing transaction")?;
    let txid = tx.txid().to_string();

    let ufvks = HashMap::from([(0u32, ufvk.clone())]);
    let dtx = decrypt_transaction(
        network,
        mined_height.map(BlockHeight::from_u32),
        Some(BlockHeight::from_u32(tip_height)),
        &tx,
        &ufvks,
    );

    let mut found = Vec::new();

    let orchard_like = dtx
        .orchard_outputs()
        .iter()
        .map(|o| ("orchard", o))
        .chain(dtx.ironwood_outputs().iter().map(|o| ("ironwood", o)));
    for (pool, out) in orchard_like {
        if out.transfer_type() != TransferType::Incoming {
            continue;
        }
        let (note, _) = out.note();
        let diversifier_index = ufvk
            .orchard()
            .and_then(|fvk| fvk.to_ivk(Scope::External).diversifier_index(&note.recipient()))
            .map(u128::from);
        found.push(IncomingPayment {
            txid: txid.clone(),
            pool,
            output_index: out.index(),
            value_zat: note.value().inner(),
            memo: text_memo(out.memo()),
            diversifier_index,
            mined_height,
        });
    }

    for out in dtx.sapling_outputs() {
        if out.transfer_type() != TransferType::Incoming {
            continue;
        }
        let note = out.note();
        let diversifier_index = ufvk
            .sapling()
            .and_then(|dfvk| dfvk.decrypt_diversifier(&note.recipient()))
            .map(|(j, _scope)| u128::from(j));
        found.push(IncomingPayment {
            txid: txid.clone(),
            pool: "sapling",
            output_index: out.index(),
            value_zat: note.value().inner(),
            memo: text_memo(out.memo()),
            diversifier_index,
            mined_height,
        });
    }

    Ok(found)
}

/// ZIP 302: returns the memo only when it is a UTF-8 text memo (first byte <= 0xF4).
fn text_memo(bytes: &MemoBytes) -> Option<String> {
    match Memo::try_from(bytes).ok()? {
        Memo::Text(text) => Some(text.to_string()),
        _ => None,
    }
}
