//! Zide scanner — Phase 1 payment detector.
//!
//! Derives per-invoice shielded addresses from the gateway UFVK and watches the chain
//! (lightwalletd or Zebra; mempool + new blocks) for payments to them.

use std::{collections::HashSet, time::Duration};

use anyhow::{bail, Result};
use clap::{Parser, Subcommand, ValueEnum};
use zcash_keys::keys::UnifiedFullViewingKey;
use zcash_protocol::consensus::Network;

use scanner::{
    decrypt::{decrypt_incoming, IncomingPayment},
    keys,
    lwd::Lwd,
    rpc::ZebraRpc,
    source::Source,
};

#[derive(Parser)]
#[command(name = "scanner", about = "Detect shielded payments to Zide invoices")]
struct Cli {
    #[arg(long, env = "ZIDE_NETWORK", value_enum, default_value = "test")]
    network: NetworkArg,

    /// Gateway Unified Full Viewing Key (uview... / uviewtest...).
    #[arg(long, env = "ZIDE_UFVK", hide_env_values = true)]
    ufvk: Option<String>,

    /// Where to read the chain from.
    #[arg(long, env = "ZIDE_SOURCE", value_enum, default_value = "lightwalletd")]
    source: SourceArg,

    #[arg(long, env = "ZIDE_LWD_URL", default_value = "https://testnet.zec.rocks:443")]
    lwd_url: String,

    #[arg(long, env = "ZEBRA_RPC_URL", default_value = "http://127.0.0.1:18232")]
    rpc_url: String,

    #[arg(long, env = "ZEBRA_RPC_USER")]
    rpc_user: Option<String>,

    #[arg(long, env = "ZEBRA_RPC_PASSWORD", hide_env_values = true)]
    rpc_password: Option<String>,

    /// Path to Zebra's `.cookie` file (used when no user/password is given).
    #[arg(long, env = "ZEBRA_RPC_COOKIE")]
    rpc_cookie: Option<String>,

    #[command(subcommand)]
    command: Command,
}

#[derive(Clone, Copy, ValueEnum)]
enum NetworkArg {
    Main,
    Test,
}

#[derive(Clone, Copy, ValueEnum)]
enum SourceArg {
    Lightwalletd,
    Zebra,
}

#[derive(Subcommand)]
enum Command {
    /// Create a new gateway key and append ZIDE_SEED / ZIDE_UFVK to an env file.
    /// The seed is written only to that file, never printed.
    Keygen {
        #[arg(long, default_value = ".env")]
        out: String,
    },
    /// Print the invoice address(es) starting at a diversifier index.
    Address {
        #[arg(long, default_value_t = 1)]
        index: u32,
        #[arg(long, default_value_t = 1)]
        count: u32,
    },
    /// Decrypt a single transaction by txid.
    ScanTx { txid: String },
    /// Follow the mempool and new blocks, printing every incoming payment.
    Watch {
        /// First block height to scan (default: current tip).
        #[arg(long)]
        from: Option<u32>,
        #[arg(long, default_value_t = 5)]
        poll_secs: u64,
    },
}

#[tokio::main]
async fn main() -> Result<()> {
    dotenvy::dotenv().ok(); // pick up .env written by `keygen`
    let cli = Cli::parse();
    let network = match cli.network {
        NetworkArg::Main => Network::MainNetwork,
        NetworkArg::Test => Network::TestNetwork,
    };
    if let Command::Keygen { out } = &cli.command {
        let ufvk = keys::keygen(&network, out)?;
        let (ua, j) = keys::invoice_address(&network, &ufvk, 0)?;
        println!("wrote ZIDE_SEED and ZIDE_UFVK to {out}");
        println!("gateway address (index {j}), use it for faucet funds:\n{ua}");
        return Ok(());
    }

    let Some(encoded_ufvk) = cli.ufvk.as_deref() else {
        bail!("set ZIDE_UFVK (or run `scanner keygen` first)");
    };
    let ufvk = keys::load_ufvk(&network, encoded_ufvk)?;

    if let Command::Address { index, count } = cli.command {
        let mut next = index;
        for _ in 0..count {
            let (ua, j) = keys::invoice_address(&network, &ufvk, next)?;
            println!("{j}\t{ua}");
            next = u32::try_from(j + 1)?;
        }
        return Ok(());
    }

    let mut source = match cli.source {
        SourceArg::Lightwalletd => {
            eprintln!("using lightwalletd at {}", cli.lwd_url);
            Source::Lightwalletd(Lwd::connect(&cli.lwd_url).await?)
        }
        SourceArg::Zebra => Source::Zebra(ZebraRpc::new(
            cli.rpc_url,
            cli.rpc_user,
            cli.rpc_password,
            cli.rpc_cookie,
        )?),
    };
    match cli.command {
        Command::ScanTx { txid } => {
            let tip = source.tip_height().await?;
            let hits = scan_txid(&mut source, &network, &ufvk, &txid, tip).await?;
            if hits.is_empty() {
                println!("no outputs in {txid} are addressed to this viewing key");
            }
            hits.iter().for_each(|p| print_payment(p, tip));
        }
        Command::Watch { from, poll_secs } => {
            watch(&mut source, &network, &ufvk, from, poll_secs).await?
        }
        Command::Keygen { .. } | Command::Address { .. } => unreachable!(),
    }
    Ok(())
}

async fn scan_txid(
    source: &mut Source,
    network: &Network,
    ufvk: &UnifiedFullViewingKey,
    txid: &str,
    tip: u32,
) -> Result<Vec<IncomingPayment>> {
    let tx = source.transaction(txid).await?;
    decrypt_incoming(network, &tx.data, tx.mined_height, tip, ufvk)
}

async fn watch(
    source: &mut Source,
    network: &Network,
    ufvk: &UnifiedFullViewingKey,
    from: Option<u32>,
    poll_secs: u64,
) -> Result<()> {
    let mut next_height = match from {
        Some(h) => h,
        None => source.tip_height().await? + 1,
    };
    let mut seen_in_mempool: HashSet<String> = HashSet::new();
    eprintln!("watching from height {next_height} (poll every {poll_secs}s)");

    loop {
        let tip = source.tip_height().await?;

        while next_height <= tip {
            let block = source.block(next_height).await?;
            if !block.txids.is_empty() {
                eprintln!("block {next_height}: {} shielded tx(s)", block.txids.len());
            }
            for txid in &block.txids {
                match scan_txid(source, network, ufvk, txid, tip).await {
                    Ok(hits) => hits.iter().for_each(|p| print_payment(p, tip)),
                    Err(e) => eprintln!("skipping {txid} in block {next_height}: {e:#}"),
                }
            }
            next_height += 1;
        }

        let mempool = source.mempool_txids().await?;
        for txid in &mempool {
            if seen_in_mempool.contains(txid) {
                continue;
            }
            match scan_txid(source, network, ufvk, txid, tip).await {
                Ok(hits) => hits.iter().for_each(|p| print_payment(p, tip)),
                Err(e) => eprintln!("skipping mempool tx {txid}: {e:#}"),
            }
            seen_in_mempool.insert(txid.clone());
        }
        // Forget txids that left the mempool (mined or evicted).
        let current: HashSet<&String> = mempool.iter().collect();
        seen_in_mempool.retain(|t| current.contains(t));

        tokio::time::sleep(Duration::from_secs(poll_secs)).await;
    }
}

fn print_payment(p: &IncomingPayment, tip: u32) {
    let status = match p.mined_height {
        Some(h) => format!("mined@{h} ({} conf)", tip.saturating_sub(h) + 1),
        None => "MEMPOOL".to_string(),
    };
    let index = p.diversifier_index.map_or("?".to_string(), |j| j.to_string());
    println!(
        "{status}\t{} ZEC\tindex={index}\t{}:{}#{}\tmemo={:?}",
        format_zec(p.value_zat),
        p.pool,
        p.txid,
        p.output_index,
        p.memo.as_deref().unwrap_or(""),
    );
}

fn format_zec(zat: u64) -> String {
    format!("{}.{:08}", zat / 100_000_000, zat % 100_000_000)
}
