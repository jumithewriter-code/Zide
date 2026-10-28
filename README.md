# Zide

**A payment gateway whose payments settle through shielded Zcash.** Any app adds a
"Pay privately" button; the customer pays with cash (through a peer-to-peer provider) or from a
Zcash wallet; the app gets a signed webhook. Nothing public links the customer to the app, and
Zide never asks who they are.

Hackathon track: **Shielded Payments** — "money that moves without publishing who paid whom."
Everything runs on the public Zcash **testnet** (NU7, including the Ironwood pool).

## Quick start

```
powershell -ExecutionPolicy Bypass -File tools\start-demo.ps1
```

Opens the gateway API (`:8080`), the website and hosted checkout (`:5173`) and the PrivateVPN
example merchant (`:4000`). See [DEMO.md](DEMO.md) for the 3-minute demo script.

First time only: `cargo run -p scanner -- keygen` creates the gateway key in `.env`, and
`cd web && npm install` installs the website.

## How it works

```
Merchant server ──POST /v1/checkout/sessions (secret key)──▶ Zide gateway ──▶ one-time shielded address
       ◀────────────── { url } ───────────────
Customer ──▶ hosted payment page ──▶ pays cash to an LP, or from a Zcash wallet
Zide scanner (viewing key, librustzcash) sees the shielded payment ──▶ session complete
Zide ──signed checkout.completed webhook──▶ merchant ──▶ unlocks the customer's account
Customer is redirected back to the merchant's success_url
```

| Party | Knows | Never learns |
|---|---|---|
| Merchant | Its own `reference` got paid | Customer's name, email, card, bank, wallet |
| Zcash blockchain | A shielded transaction happened | Sender, receiver, amount, memo |
| Zide | Which merchant was paid | Who the customer is |
| Cash provider (LP) | Who paid them cash | Which merchant it was for |

## Repository

| Path | What |
|---|---|
| `crates/scanner` | Rust library + CLI: detects shielded payments with a viewing key (librustzcash; Sapling, Orchard, Ironwood), from lightwalletd or Zebra; per-invoice ZIP 316 addresses; public-view inspector |
| `crates/gateway` | The gateway: merchant API, checkout sessions, hosted-page API, payment matcher, P2P LP flow, signed webhooks |
| `sdk/node` | `@zide/node`: `checkout.sessions.create`, `plans`, `subscriptions`, `verifyWebhook` |
| `sdk/js/zide.js` | Drop-in "Pay privately" button (served by the gateway at `/zide.js`) |
| `examples/privatevpn` | A complete example merchant: anonymous accounts, subscriptions, webhook fulfilment |
| `web` | Landing page, developer docs, merchant dashboard, hosted payment page, LP dashboard, payment proof |
| `tools/show-db.mjs` | Prints everything Zide stores (to show there's no personal data) |

## API

Authenticate with `Authorization: Bearer sk_test_…`. Full docs at `http://localhost:5173/#/docs`.

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/v1/merchants` | Sign up; returns the secret key once |
| `GET` / `PATCH` | `/v1/merchant` | Account and `webhook_url` |
| `GET` / `POST` | `/v1/plans` | Subscription plans (create is idempotent) |
| `POST` | `/v1/checkout/sessions` | `mode: payment` (`amount_usd_cents`, `description`) or `mode: subscription` (`plan_id`, optional `subscription_id` to renew); `reference`, `success_url`, `cancel_url` |
| `GET` | `/v1/checkout/sessions/{id}` | `status: open \| complete \| expired`, `payment_status: unpaid \| processing \| paid` |
| `GET` | `/v1/subscriptions/{id}` | `active`, `current_period_end` |

`reference` must be an opaque id (letters, digits, `- _ . :`); emails and names are rejected so
integrators can't leak personal data by accident. Webhooks carry `zide-signature: sha256=<HMAC>`
and the merchant's own session object — no txids, addresses or payer data.

Public (hosted page): `GET /v1/pay/{session}`, P2P cash orders under `/v1/invoices/{id}/p2p`,
and the demo transaction inspector `GET /v1/tx/{txid}`.

Liquidity providers authenticate with their own key (`Authorization: Bearer lp_test_…`):
`GET /v1/lp`, `GET /v1/lp/orders` and `POST /v1/lp/orders/{id}/confirm` only ever touch that LP's
orders. On first start the gateway issues keys for the two demo LPs (amber, kite) and writes them
to `lp-keys.json` (gitignored); the LP dashboard is linked from the site footer.

## Configuration (`.env`)

| Variable | Default | Meaning |
|---|---|---|
| `ZIDE_UFVK` / `ZIDE_SEED` | — | Gateway keys, written by `scanner keygen` |
| `ZIDE_NETWORK` | `test` | `test` or `main` |
| `ZIDE_SOURCE` | `lightwalletd` | or `zebra` (own node, `ZEBRA_RPC_URL`, `ZEBRA_RPC_COOKIE`) |
| `ZIDE_LWD_URL` | `https://testnet.zec.rocks:443` | lightwalletd server |
| `ZIDE_PUBLIC_URL` | `http://localhost:5173` | where the hosted payment page lives |
| `ZIDE_ZEC_USD` | `500` | testnet stand-in for a price feed |
| `ZIDE_MIN_CONF` | `1` | confirmations before a payment counts |
| `ZIDE_INVOICE_TTL_SECS` | `900` | quote lifetime (cash orders extend to 60 min) |
| `ZIDE_TX_INSPECTOR` | `1` | demo inspector; set `0` outside demos (it decrypts on request) |

On Windows, keep `CARGO_TARGET_DIR` on a short path (e.g. `%USERPROFILE%\zide-target`) if the
linker fails with LNK1104.

## Honest limits (testnet MVP)

- Custodial between payment and merchant payout: invoice addresses come from Zide's key (the
  running gateway only needs the viewing key; the seed can stay offline). Merchant payouts and
  the fiat off-ramp are roadmap.
- LP trades are simulated: no escrow and the LP confirms fiat with a button (roadmap: FROST
  threshold escrow + zkTLS proof of payment).
- Merchant sign-up is open and the dashboard signs in with the API key.
- Fixed ZEC price; no chain-reorg rollback yet.

## Status

- [x] Payment detection on testnet (`scanner`), including NU7 Ironwood outputs
- [x] Gateway: merchants, API keys, plans, checkout sessions (one-off + subscriptions), signed webhooks
- [x] Hosted payment page: cash via LP or Zcash wallet, live status, return to merchant
- [x] `zide.js`, `@zide/node`, developer docs, merchant dashboard
- [x] PrivateVPN example: verified end to end on testnet (payment → webhook → account unlocked)
- [x] Payment proof page (public testnet explorers are on the pre-NU7 fork)
