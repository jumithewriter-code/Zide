// Ember Coffee — a small online coffee shop that takes one-off payments through Zide.
// Plain Node, no dependencies besides the Zide SDK in this repo.
//
// Run:  powershell -ExecutionPolicy Bypass -File start.ps1   →  http://localhost:3000
//
// The Zide integration is two pieces: the PAYMENT HOOK (create a checkout session) and the
// /payments/webhook route (verify Zide's signed event, then mark the order paid).

import { createServer } from 'node:http'
import { randomBytes } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Zide, verifyWebhook } from '../../sdk/node/index.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PORT ?? 3000)
const PUBLIC = join(here, 'public')
const ORDERS_FILE = join(here, 'orders.json')
const zide = new Zide(process.env.ZIDE_SECRET_KEY)
const ZIDE_WEBHOOK_SECRET = process.env.ZIDE_WEBHOOK_SECRET

// ---------------------------------------------------------------------------------------------
// Menu (prices in US cents)
export const MENU = [
  { id: 'espresso', name: 'Espresso', desc: 'Double shot, dark roast', price_cents: 250, category: 'Coffee' },
  { id: 'americano', name: 'Americano', desc: 'Espresso with hot water', price_cents: 300, category: 'Coffee' },
  { id: 'latte', name: 'Latte', desc: 'Espresso, steamed milk, light foam', price_cents: 400, category: 'Coffee' },
  { id: 'cappuccino', name: 'Cappuccino', desc: 'Equal parts espresso, milk, foam', price_cents: 380, category: 'Coffee' },
  { id: 'flat-white', name: 'Flat White', desc: 'Ristretto with velvety milk', price_cents: 420, category: 'Coffee' },
  { id: 'cold-brew', name: 'Cold Brew', desc: 'Steeped 18 hours, served over ice', price_cents: 450, category: 'Cold' },
  { id: 'iced-mocha', name: 'Iced Mocha', desc: 'Espresso, chocolate, cold milk', price_cents: 480, category: 'Cold' },
  { id: 'croissant', name: 'Butter Croissant', desc: 'Baked this morning', price_cents: 300, category: 'Bakery' },
  { id: 'banana-bread', name: 'Banana Bread', desc: 'Thick slice, walnuts', price_cents: 350, category: 'Bakery' },
]
const MENU_BY_ID = Object.fromEntries(MENU.map((m) => [m.id, m]))

// ---------------------------------------------------------------------------------------------
// Orders: { id, items: [{ id, name, qty, price_cents }], total_cents, status, created_at, paid_at }
// status: 'awaiting_payment' | 'paid'
const orders = existsSync(ORDERS_FILE) ? JSON.parse(readFileSync(ORDERS_FILE, 'utf8')) : {}
const saveOrders = () => writeFile(ORDERS_FILE, JSON.stringify(orders, null, 2))

function createOrder(items) {
  if (!Array.isArray(items) || items.length === 0) throw new Error('Your cart is empty')
  const lines = []
  for (const { id, qty } of items) {
    const item = MENU_BY_ID[id]
    const n = Number(qty)
    if (!item || !Number.isInteger(n) || n < 1 || n > 20) throw new Error('Invalid item in cart')
    lines.push({ id, name: item.name, qty: n, price_cents: item.price_cents })
  }
  const order = {
    id: 'order_' + randomBytes(5).toString('hex'),
    items: lines,
    total_cents: lines.reduce((sum, l) => sum + l.qty * l.price_cents, 0),
    status: 'awaiting_payment',
    created_at: new Date().toISOString(),
    paid_at: null,
  }
  orders[order.id] = order
  saveOrders()
  return order
}

/** Call this when your payment provider confirms a payment (e.g. from a webhook). */
export function markOrderPaid(orderId) {
  const order = orders[orderId]
  if (!order || order.status === 'paid') return false
  order.status = 'paid'
  order.paid_at = new Date().toISOString()
  saveOrders()
  console.log(`Order ${orderId} paid`)
  return true
}

// ---------------------------------------------------------------------------------------------
// HTTP helpers
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml' }

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (chunk) => {
      data += chunk
      if (data.length > 100_000) req.destroy()
    })
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })
}

async function serveStatic(res, pathname) {
  const file = normalize(join(PUBLIC, pathname === '/' ? 'index.html' : pathname))
  if (!file.startsWith(PUBLIC)) return json(res, 404, { error: 'not found' })
  try {
    const body = await readFile(file)
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' })
    res.end(body)
  } catch {
    json(res, 404, { error: 'not found' })
  }
}

// ---------------------------------------------------------------------------------------------
// Routes
const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`)
  try {
    if (req.method === 'GET' && url.pathname === '/api/menu') return json(res, 200, { menu: MENU })

    if (req.method === 'POST' && url.pathname === '/api/orders') {
      const { items } = JSON.parse((await readBody(req)) || '{}')
      return json(res, 200, createOrder(items))
    }

    const orderMatch = url.pathname.match(/^\/api\/orders\/(order_[0-9a-f]{10})$/)
    if (req.method === 'GET' && orderMatch) {
      const order = orders[orderMatch[1]]
      return order ? json(res, 200, order) : json(res, 404, { error: 'Order not found' })
    }

    const payMatch = url.pathname.match(/^\/api\/orders\/(order_[0-9a-f]{10})\/pay$/)
    if (req.method === 'POST' && payMatch) {
      const order = orders[payMatch[1]]
      if (!order) return json(res, 404, { error: 'Order not found' })
      if (order.status === 'paid') return json(res, 400, { error: 'This order is already paid' })

      // ===================================================================================
      // PAYMENT HOOK — connect your payment gateway here.
      //
      // You have: order.id (use it as your reference), order.total_cents, order.items.
      // Typically you would:
      //   1. ask your payment provider for a checkout/payment page for this order,
      //   2. return its URL:  return json(res, 200, { url: theCheckoutUrl })
      //      (the order page sends the customer there automatically),
      //   3. when the provider confirms the payment (usually a webhook to a route you add
      //      below), call markOrderPaid(order.id).
      // After paying, send the customer back to:  http://localhost:3000/order.html?id=<order.id>
      // ===================================================================================
      // Ask Zide for a payment page for this order.
      const session = await zide.checkout.sessions.create({
        mode: 'payment',
        amount_usd_cents: order.total_cents,
        description: 'Ember Coffee order',
        reference: order.id,                         // our order id, never customer details
        success_url: `http://localhost:${PORT}/order.html?id=${order.id}`,
        cancel_url: `http://localhost:${PORT}/order.html?id=${order.id}`,
      })
      return json(res, 200, { url: session.url })   // the order page redirects there
    }

    // Zide tells us a payment is complete. verifyWebhook rejects anything not signed by Zide.
    if (req.method === 'POST' && url.pathname === '/payments/webhook') {
      const event = verifyWebhook(await readBody(req), req.headers['zide-signature'], ZIDE_WEBHOOK_SECRET)
      if (event.type === 'checkout.completed') markOrderPaid(event.data.reference)
      return json(res, 200, { received: true })
    }

    if (req.method === 'GET') return serveStatic(res, url.pathname)
    json(res, 404, { error: 'not found' })
  } catch (e) {
    json(res, 400, { error: e.message })
  }
})

server.listen(PORT, () => console.log(`Ember Coffee on http://localhost:${PORT}`))
