//! Viewing-key loading and per-invoice address derivation (ZIP 316 diversified addresses).

use std::io::Write;

use anyhow::{anyhow, bail, Context, Result};
use orchard::keys::DiversifierIndex;
use zcash_keys::keys::{UnifiedAddressRequest, UnifiedFullViewingKey, UnifiedSpendingKey};
use zcash_protocol::consensus::Network;
use zip32::AccountId;

/// Generates a fresh 32-byte seed, derives account 0, and appends the seed and UFVK to `out`.
pub fn keygen(network: &Network, out: &str) -> Result<UnifiedFullViewingKey> {
    if std::fs::read_to_string(out).is_ok_and(|s| s.contains("ZIDE_SEED=")) {
        bail!("{out} already contains ZIDE_SEED; refusing to overwrite a key");
    }
    let mut seed = [0u8; 32];
    getrandom::fill(&mut seed).map_err(|e| anyhow!("OS randomness unavailable: {e}"))?;
    let usk = UnifiedSpendingKey::from_seed(network, &seed, AccountId::ZERO)
        .map_err(|e| anyhow!("key derivation failed: {e:?}"))?;
    let ufvk = usk.to_unified_full_viewing_key();
    let encoded = ufvk.encode(network).map_err(|e| anyhow!("encoding UFVK: {e:?}"))?;

    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(out)
        .with_context(|| format!("opening {out}"))?;
    writeln!(file, "# Zide gateway key. ZIDE_SEED can spend funds: keep it secret.")?;
    writeln!(file, "ZIDE_SEED={}", hex::encode(seed))?;
    writeln!(file, "ZIDE_UFVK={encoded}")?;
    Ok(ufvk)
}

pub fn load_ufvk(network: &Network, encoded: &str) -> Result<UnifiedFullViewingKey> {
    UnifiedFullViewingKey::decode(network, encoded.trim())
        .map_err(|e| anyhow!("invalid UFVK for this network: {e:?}"))
}

/// Derives the shielded Unified Address for an invoice.
///
/// Not every index yields a valid Sapling diversifier, so the search starts at `index` and may
/// land on a higher one; the index actually used is returned and must be stored on the invoice.
pub fn invoice_address(
    network: &Network,
    ufvk: &UnifiedFullViewingKey,
    index: u32,
) -> Result<(String, u128)> {
    let (ua, j) = ufvk
        .find_address(DiversifierIndex::from(index), UnifiedAddressRequest::SHIELDED)
        .map_err(|e| anyhow!("address derivation failed at index {index}: {e:?}"))?;
    Ok((ua.encode(network), u128::from(j)))
}
