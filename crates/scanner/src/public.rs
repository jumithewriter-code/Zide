//! What anyone can learn from a transaction without a viewing key — the same information a
//! block explorer shows. Used to demonstrate that a Zide payment reveals nothing useful.

use anyhow::{Context, Result};
use zcash_primitives::transaction::Transaction;
use zcash_protocol::consensus::{BlockHeight, BranchId, Network};

#[derive(Debug, Clone, serde::Serialize)]
pub struct PublicView {
    pub txid: String,
    pub version: String,
    pub mined_height: Option<u32>,
    pub transparent_inputs: usize,
    pub transparent_outputs: usize,
    pub sapling_spends: usize,
    pub sapling_outputs: usize,
    pub orchard_actions: usize,
    pub ironwood_actions: usize,
    /// Net value leaving the shielded pools. For a fully shielded transaction this is the fee.
    pub shielded_value_balance_zat: i64,
    /// Only computable when there are no transparent inputs (their values aren't in the tx).
    pub fee_zat: Option<i64>,
    /// Size of each encrypted note (recipient, amount and memo are all inside).
    pub note_ciphertext_bytes: Option<usize>,
}

pub fn public_view(
    network: &Network,
    tx_bytes: &[u8],
    mined_height: Option<u32>,
    tip_height: u32,
) -> Result<PublicView> {
    let parse_height = BlockHeight::from_u32(mined_height.unwrap_or(tip_height + 1));
    let tx = Transaction::read(tx_bytes, BranchId::for_height(network, parse_height))
        .context("parsing transaction")?;

    let (t_in, t_out) = tx.transparent_bundle().map_or((0, 0), |b| (b.vin.len(), b.vout.len()));
    let (s_spends, s_outputs, s_balance) = tx.sapling_bundle().map_or((0, 0, 0), |b| {
        (b.shielded_spends().len(), b.shielded_outputs().len(), i64::from(*b.value_balance()))
    });
    let orchard = tx.orchard_bundle();
    let ironwood = tx.ironwood_bundle();
    let o_balance = orchard.map_or(0, |b| i64::from(*b.value_balance()));
    let i_balance = ironwood.map_or(0, |b| i64::from(*b.value_balance()));
    let note_ciphertext_bytes = orchard
        .or(ironwood)
        .map(|b| b.actions().first().encrypted_note().enc_ciphertext.as_ref().len());

    let shielded_value_balance_zat = s_balance + o_balance + i_balance;
    Ok(PublicView {
        txid: tx.txid().to_string(),
        version: format!("{:?}", tx.version()),
        mined_height,
        transparent_inputs: t_in,
        transparent_outputs: t_out,
        sapling_spends: s_spends,
        sapling_outputs: s_outputs,
        orchard_actions: orchard.map_or(0, |b| b.actions().len()),
        ironwood_actions: ironwood.map_or(0, |b| b.actions().len()),
        shielded_value_balance_zat,
        fee_zat: (t_in == 0 && t_out == 0).then_some(shielded_value_balance_zat),
        note_ciphertext_bytes,
    })
}
