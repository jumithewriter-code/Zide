# Ember Coffee (example)

A small online coffee shop that takes **one-off payments** through Zide: menu, cart, checkout,
and an order page that turns "Paid" when Zide confirms the shielded payment. Plain Node, no
packages to install.

## Run it

Zide must be running (`tools\start-demo.ps1` from the repo root). Then, once:

1. Create a merchant for the shop, with its webhook pointing at the shop:
   ```
   curl -X POST http://127.0.0.1:8080/v1/merchants -H "content-type: application/json" ^
     -d "{\"name\":\"Ember Coffee\",\"webhook_url\":\"http://127.0.0.1:3000/payments/webhook\"}"
   ```
2. Save the `secret_key` and `webhook_secret` from the answer in `.zide-keys.json` in this folder:
   ```json
   { "secret_key": "sk_test_…", "webhook_secret": "…" }
   ```
   (The file is gitignored; never commit it.)

Then start the shop:

```
powershell -ExecutionPolicy Bypass -File start.ps1
```

Open http://localhost:3000, add something, **Checkout → Pay**, and pay on Zide's page.

## How the integration works

All of it is in `server.mjs`:

1. **Orders** are priced on the server from its own menu and saved in `orders.json`.
2. **PAYMENT HOOK** (`POST /api/orders/{id}/pay`): creates a Zide Checkout Session in `payment`
   mode for `order.total_cents`, with `reference: order.id`, and returns `{ url }`. The order page
   sends the customer to that Zide payment page.
3. **Webhook** (`POST /payments/webhook`): `verifyWebhook` checks Zide's HMAC signature, and on
   `checkout.completed` the shop calls `markOrderPaid(event.data.reference)`.
4. Zide sends the customer back to `order.html?id=…`, which polls until the order shows **Paid**.

The shop only ever knows its own order id. Zide never receives customer details, and the shop
never learns who paid.
