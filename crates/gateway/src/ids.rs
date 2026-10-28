//! Random identifiers, API keys and hashing. Nothing here is derived from user data.

use sha2::{Digest, Sha256};

/// Crockford base32: no I, L, O, U, so codes are easy to read aloud and type.
const CROCKFORD: &[u8; 32] = b"0123456789ABCDEFGHJKMNPQRSTVWXYZ";

fn random_bytes<const N: usize>() -> [u8; N] {
    let mut buf = [0u8; N];
    getrandom::fill(&mut buf).expect("OS randomness unavailable");
    buf
}

fn crockford(bytes: &[u8]) -> String {
    let mut out = String::new();
    let (mut acc, mut bits) = (0u32, 0u32);
    for &b in bytes {
        acc = (acc << 8) | u32::from(b);
        bits += 8;
        while bits >= 5 {
            bits -= 5;
            out.push(CROCKFORD[((acc >> bits) & 31) as usize] as char);
        }
    }
    if bits > 0 {
        out.push(CROCKFORD[((acc << (5 - bits)) & 31) as usize] as char);
    }
    out
}

/// 16 Crockford chars (80 bits) — goes in the ZIP 302 memo as `ZIDE1:<code>`.
pub fn invoice_code() -> String {
    crockford(&random_bytes::<10>())
}

/// `sk_test_…` (160 bits). Shown to the merchant once; only its hash is stored.
pub fn secret_key() -> String {
    format!("sk_test_{}", crockford(&random_bytes::<20>()).to_ascii_lowercase())
}

/// `lp_test_…` (160 bits): a liquidity provider's key for the LP dashboard and API.
pub fn lp_key() -> String {
    format!("lp_test_{}", crockford(&random_bytes::<20>()).to_ascii_lowercase())
}

pub fn sha256_hex(value: &str) -> String {
    hex::encode(Sha256::digest(value.trim().as_bytes()))
}

pub fn prefixed_id(prefix: &str) -> String {
    format!("{prefix}_{}", crockford(&random_bytes::<10>()).to_ascii_lowercase())
}

pub fn secret_hex() -> String {
    hex::encode(random_bytes::<32>())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn secret_key_format() {
        let key = secret_key();
        assert!(key.starts_with("sk_test_"));
        assert_eq!(key.len(), "sk_test_".len() + 32);
        assert_eq!(sha256_hex(&key), sha256_hex(&format!(" {key} ")));
    }

    #[test]
    fn invoice_code_is_16_crockford_chars() {
        let code = invoice_code();
        assert_eq!(code.len(), 16);
        assert!(code.bytes().all(|b| CROCKFORD.contains(&b)));
    }
}
