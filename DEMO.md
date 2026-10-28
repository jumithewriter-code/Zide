# Zide: demo guide

Everything runs on the **public Zcash testnet** (NU7, ~25 s blocks). Test coins (TAZ) have no value.

**Pitch, one line:** Stripe for shielded payments. Any app takes payments that don't publish who
paid whom, in a few lines of code.

## 30 minutes before

1. Close any old demo windows, then `powershell -ExecutionPolicy Bypass -File tools\start-demo.ps1`.
   It opens three windows (gateway, website, PrivateVPN) and two browser tabs.
2. In the **gateway** window, check for no repeating `matcher:` errors. If the public testnet
   server is down, see "If something breaks".
3. Open the faucet (`fauzec`) in a tab and check it still sends TAZ. It plays the LP's wallet.
4. Arrange windows:
   - **Left:** PrivateVPN at `http://localhost:4000` (click "Remove account from this device" for a fresh start)
   - **Right:** LP dashboard at `http://localhost:5173/#/lp` (footer link "For liquidity providers").
     Sign in with the LP key from `lp-keys.json`. A cash order goes to either amber or kite, so
     sign in as the LP named on the checkout page (open a second tab for the other one if needed).
   - **Behind:** docs `#/docs`, merchant dashboard `#/dashboard`, the PrivateVPN terminal window
5. Do one full dry run, then reset PrivateVPN again.
6. **Start a screen recording (Win+Alt+R) and keep it running.** It's your backup.

## The 3-minute script

| Time | Do | Say |
|---|---|---|
| 0:00–0:20 | Zide landing page | "Every payment app today learns who you are. Zide is a payment gateway where the merchant gets paid and nobody learns who paid whom." |
| 0:20–0:40 | Switch to **PrivateVPN** → "Create anonymous account" | "This is an ordinary app that integrated Zide. No email, no password: an account number." |
| 0:40–1:00 | Click **Pay privately** (Monthly) → lands on Zide's hosted page | "That button is zide.js. The app's server made one API call with its secret key and its own account number as the reference." |
| 1:00–1:20 | **Pay with cash** → show LP + reference → "I've sent the money" | "You pay normal money to a peer-to-peer provider. No wallet needed." |
| 1:20–1:45 | **LP dashboard** (signed in as that LP): "$5.00, ref ZR-…" → **Cash received** → copy the address to the faucet and send | "The provider sees an amount and a random reference, not which app this is for. They send shielded ZEC to a one-time address." |
| 1:45–2:10 | Hosted page: *Payment detected* → **Payment complete** → returns to PrivateVPN → **Connect** | "Zide found the payment with a viewing key that can't spend, signed a webhook to PrivateVPN, and sent you back. Unlocked." |
| 2:10–2:30 | Point at "What PrivateVPN knows about you" and the PrivateVPN terminal (`webhook: verified`) | "The app knows an account number and a date. That's it." |
| 2:30–2:50 | **See what the blockchain shows** (or `#/tx/<txid>`) | "The real transaction: no sender, no receiver, no amount. Our key sees the amount and the invoice. Even we can't see who sent it." |
| 2:50–3:00 | Flash `#/docs` | "Four steps to integrate: keys, one API call, a button, a webhook. Plus an open-source Rust scanner that already handles NU7's Ironwood pool." |

Fill a slow block with the docs page or the dashboard (`#/dashboard`, sign in with the key from
`examples/privatevpn/.zide-keys.json`): it shows the payment with only PrivateVPN's own reference.

## If something breaks

| Problem | What to do |
|---|---|
| Gateway shows `dns error` / `connection reset` | Public testnet server (`testnet.zec.rocks`) hiccup; it recovered by itself in minutes earlier. Switch to the recording. |
| "Pay privately" buttons look unstyled | `zide.js` didn't load: check the gateway window is running (it serves `/zide.js`). |
| Port already in use | An old demo window is still open. Close it, run the start script again. |
| Faucet slow or empty | Ask organisers/Discord for TAZ beforehand; any testnet wallet can play the LP. |
| Page reloaded by accident | Fine: the hosted page URL contains the session and resumes. |
| Total network failure | Recording + `node tools/show-db.mjs` (works offline). |

Verified on build day (testnet), full dry run from `start-demo.ps1`: PrivateVPN Monthly → hosted
page → cash via LP "amber" (ref ZR-XMXKWB) → shielded payment → `checkout.completed` webhook
verified by PrivateVPN → account unlocked. Payments to inspect at `#/tx/<txid>`:

```
a1816558497d18b585f0f321c5d86a2758392bd98f5a6396de1462a55e100d23   gateway dry run, PrivateVPN Monthly via LP
8d683ca9cf254b7d568e547fb9758ba561e052df5b763deca2e6704b09d88db0   earlier prototype, $50 via LP "amber"
4e0993e723ded3c051f3d9b89594b616b5c64a1bedc7855004296150ccd2a308
354fecdbaee694dc1687987f2fcadadbb950b58b55297ac2c28c7b496f184511
```

Public testnet explorers (e.g. zcashexplorer.app) are still on the pre-NU7 fork and can't show
these, which is why Zide has its own "Payment proof" page.

## Questions judges may ask

**Who could link a customer to the merchant?** Nobody alone. The LP knows the customer but not the
merchant; Zide knows the merchant but not the customer; the chain shows nothing; the merchant knows
only its own reference. Two parties would have to collude *and* match timing.

**How is this different from Stripe or BTCPay?** Stripe sees everyone. Crypto processors usually
need the customer's own wallet and use transparent chains. Zide takes cash, settles in the shielded
pool, and its API rejects personal data in references.

**Isn't Zide custodial?** Partly, and we say so. Invoice addresses come from Zide's key, so funds sit
in Zide's shielded wallet until payout, like a Stripe balance. The running gateway only needs the
viewing key; the spending seed can stay offline. Roadmap: merchant-owned receiving keys (Zide keeps
an incoming viewing key only), FROST escrow for LP trades, zkTLS proof of the fiat payment.

**Why a viewing key?** It detects payments but can't spend, so a gateway breach can't steal funds.

**What if the LP takes the cash and doesn't send ZEC?** Today: reputation and disputes (simulated).
Roadmap: the LP's ZEC is locked in escrow before the customer pays.

**What about KYC?** The fiat leg is between the customer and the LP; Zide never touches fiat, so it
never asks for identity.

**How hard is integration?** One API call to create a session, a script tag for the button, and a
webhook handler. The PrivateVPN example is about 100 lines including its UI.

**Why Zcash and NU7?** Shielded payments with viewing keys are exactly what a gateway needs. Our
scanner already handles the new Ironwood pool on the NU7 testnet.
