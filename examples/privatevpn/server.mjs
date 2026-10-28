// PrivateVPN — an example merchant app that takes payments through Zide.
//
// It shows the whole integration: sign up as a merchant, define plans, create Checkout Sessions
// for an anonymous account number, and activate the account from a verified webhook.
// It never asks for an email, name or card: the account number is the only identifier.
//
// Run: node examples/privatevpn/server.mjs   (needs the Zide gateway on :8080 and website on :5173)

import { createServer } from 'node:http'
import { randomInt } from 'node:crypto'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Zide, verifyWebhook } from '../../sdk/node/index.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PORT ?? 4000)
const SELF = `http://localhost:${PORT}`
const ZIDE_API = process.env.ZIDE_API ?? 'http://127.0.0.1:8080'
// Browsers load zide.js from the gateway; localhost works for the demo.
const ZIDE_API_PUBLIC = process.env.ZIDE_API_PUBLIC ?? 'http://localhost:8080'
const KEYS_FILE = join(here, '.zide-keys.json')
const ACCOUNTS_FILE = join(here, 'accounts.json')

// 1. Merchant onboarding: sign up once and keep the keys next to the app (gitignored).
async function loadKeys() {
  if (existsSync(KEYS_FILE)) return JSON.parse(readFileSync(KEYS_FILE, 'utf8'))
  const { secret_key, webhook_secret, merchant } = await Zide.signUp(
    { name: 'PrivateVPN', webhook_url: `http://127.0.0.1:${PORT}/zide/webhook` },
    { baseUrl: ZIDE_API },
  )
  const keys = { secret_key, webhook_secret, merchant_id: merchant.id }
  writeFileSync(KEYS_FILE, JSON.stringify(keys, null, 2))
  console.log(`Signed up with Zide as merchant ${merchant.slug}`)
  return keys
}

// The gateway may still be starting (it connects to the chain before listening), so retry.
async function withRetry(what, fn, attempts = 30) {
  for (let i = 1; ; i++) {
    try {
      return await fn()
    } catch (e) {
      if (i >= attempts || e.status) throw e // e.status: the gateway answered with a real error
      if (i === 1) console.log(`Waiting for the Zide gateway at ${ZIDE_API} (${what})...`)
      await new Promise((r) => setTimeout(r, 2000))
    }
  }
}

const keys = await withRetry('sign-up', loadKeys)
const zide = new Zide(keys.secret_key, { baseUrl: ZIDE_API })

// 2. Plans (idempotent, so this is safe on every start).
const PLANS = await withRetry('plans', async () => ({
  monthly: await zide.plans.create({ name: 'Monthly', price_usd_cents: 500, period_days: 30 }),
  yearly: await zide.plans.create({ name: 'Yearly', price_usd_cents: 5000, period_days: 365 }),
}))

// Accounts: an anonymous number -> subscription state. This is everything PrivateVPN stores.
const accounts = existsSync(ACCOUNTS_FILE) ? JSON.parse(readFileSync(ACCOUNTS_FILE, 'utf8')) : {}
const saveAccounts = () => writeFileSync(ACCOUNTS_FILE, JSON.stringify(accounts, null, 2))

function newAccountNumber() {
  let n = ''
  for (let i = 0; i < 16; i++) n += randomInt(10)
  return `acct_${n}`
}

const json = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

const readBody = (req) =>
  new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (c) => (data += c))
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })

const server = createServer(async (req, res) => {
  const url = new URL(req.url, SELF)
  try {
    if (req.method === 'GET' && url.pathname === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      return res.end(PAGE)
    }

    // Anonymous sign-up: no email, no password — just a random account number.
    if (req.method === 'POST' && url.pathname === '/api/accounts') {
      const id = newAccountNumber()
      accounts[id] = { active_until: null, subscription_id: null }
      saveAccounts()
      return json(res, 200, { account: id })
    }

    const acct = url.pathname.match(/^\/api\/accounts\/(acct_\d{16})$/)
    if (req.method === 'GET' && acct) {
      const a = accounts[acct[1]]
      if (!a) return json(res, 404, { error: 'unknown account' })
      return json(res, 200, { account: acct[1], ...a, active: !!a.active_until && a.active_until * 1000 > Date.now() })
    }

    // 3. Create a Checkout Session. This is the whole server-side integration.
    if (req.method === 'POST' && url.pathname === '/api/checkout') {
      const { account, plan } = JSON.parse((await readBody(req)) || '{}')
      if (!accounts[account] || !PLANS[plan]) return json(res, 400, { error: 'unknown account or plan' })
      const a = accounts[account]
      // Renew the existing subscription only when staying on the same plan.
      const renewing = a.subscription_id && a.plan === plan
      const session = await zide.checkout.sessions.create({
        mode: 'subscription',
        plan_id: PLANS[plan].id,
        subscription_id: renewing ? a.subscription_id : undefined,
        reference: account, // our own opaque id; Zide never learns more
        success_url: `${SELF}/?paid={SESSION_ID}`,
        cancel_url: `${SELF}/`,
      })
      a.subscription_id = session.subscription_id
      a.plan = plan
      saveAccounts()
      return json(res, 200, { url: session.url })
    }

    // 4. Webhook: verify Zide's signature, then activate the account named by `reference`.
    if (req.method === 'POST' && url.pathname === '/zide/webhook') {
      const raw = await readBody(req)
      let event
      try {
        event = verifyWebhook(raw, req.headers['zide-signature'], keys.webhook_secret)
      } catch {
        console.log('webhook: REJECTED (bad signature)')
        return json(res, 400, { error: 'bad signature' })
      }
      const session = event.data
      if (event.type === 'checkout.completed' && accounts[session.reference]) {
        accounts[session.reference].active_until = session.subscription?.current_period_end ?? null
        accounts[session.reference].subscription_id = session.subscription_id
        saveAccounts()
        console.log(`webhook: verified ${event.type} -> ${session.reference} active until ${new Date(accounts[session.reference].active_until * 1000).toISOString()}`)
      }
      return json(res, 200, { received: true })
    }

    json(res, 404, { error: 'not found' })
  } catch (e) {
    console.error(e)
    json(res, 500, { error: e.message })
  }
})

server.listen(PORT, '127.0.0.1', () => console.log(`PrivateVPN demo on ${SELF}`))

// ---------------------------------------------------------------------------------------------
// The app's UI: a deliberately different brand from Zide, to read as a third-party app.
const PAGE = /* html */ `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>PrivateVPN</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='8' fill='%23071521'/><path d='M16 5l9 4v6c0 6-4 10-9 12-5-2-9-6-9-12V9z' fill='%234fd1ff'/></svg>">
<script src="${ZIDE_API_PUBLIC}/zide.js" defer></script>
<style>
  *{box-sizing:border-box} body{margin:0;min-height:100vh;font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;color:#e6f1f8;
  background:radial-gradient(1200px 600px at 50% -10%,#12324a,#071521 60%)}
  header{display:flex;justify-content:space-between;align-items:center;max-width:960px;margin:0 auto;padding:20px 16px}
  .logo{font-weight:800;font-size:1.2rem;display:flex;gap:10px;align-items:center}.logo b{color:#4fd1ff}
  main{display:grid;place-items:center;padding:24px 16px 80px}
  .card{width:100%;max-width:460px;background:rgba(10,30,45,.85);border:1px solid #1d4560;border-radius:20px;padding:28px;text-align:center}
  h1{font-size:1.6rem;margin:0 0 8px} .muted{color:#8fb3c8} .small{font-size:.85rem}
  .acct{font:600 1.15rem ui-monospace,Consolas,monospace;letter-spacing:.06em;background:#06141f;border:1px dashed #4fd1ff;border-radius:12px;padding:12px;margin:14px 0}
  .btn{width:100%;padding:13px;border:0;border-radius:12px;background:#4fd1ff;color:#032333;font:700 1rem system-ui;cursor:pointer}
  .plans{display:grid;gap:10px;margin:18px 0}
  .plan{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:12px 14px;border:1px solid #1d4560;border-radius:12px;background:#06141f;text-align:left}
  .plan strong{display:block}
  .power{width:150px;height:150px;border-radius:50%;border:3px solid #1d4560;background:#06141f;color:#8fb3c8;font:700 1.1rem system-ui;cursor:pointer;margin:8px auto 12px;display:block;transition:all .25s}
  .power.on{border-color:#3ddc97;color:#3ddc97;box-shadow:0 0 40px rgba(61,220,151,.35)}
  .knows{text-align:left;background:#06141f;border:1px solid #1d4560;border-radius:12px;padding:14px;margin:16px 0;font-size:.9rem}
  .knows p{margin:6px 0 0;color:#8fb3c8} .link{background:none;border:0;color:#8fb3c8;text-decoration:underline;cursor:pointer}
  .pending{color:#f0b429}
</style></head>
<body>
<header><span class="logo"><b>&#9670;</b> PrivateVPN</span><span class="muted small">Payments by Zide</span></header>
<main><div class="card" id="app">Loading…</div></main>
<script>
const app = document.getElementById('app')
const KEY = 'privatevpn.account'
const store = { get(){ try { return localStorage.getItem(KEY) } catch { return null } }, set(v){ try { v ? localStorage.setItem(KEY, v) : localStorage.removeItem(KEY) } catch {} } }
const fmt = (a) => a.replace('acct_','').replace(/(\\d{4})(?=\\d)/g,'$1 ')
const day = (t) => new Date(t*1000).toLocaleDateString('en-US',{year:'numeric',month:'short',day:'numeric'})

async function render() {
  const acct = store.get()
  if (!acct) {
    app.innerHTML = '<h1>Get PrivateVPN</h1><p class="muted">No email. No password. We give you an account number, that is all we know about you.</p><button class="btn" id="new">Create anonymous account</button>'
    document.getElementById('new').onclick = async () => { const r = await fetch('/api/accounts',{method:'POST'}).then(r=>r.json()); store.set(r.account); render() }
    return
  }
  const res = await fetch('/api/accounts/'+acct)
  if (!res.ok) { store.set(null); return render() }
  const a = await res.json()
  const justPaid = new URLSearchParams(location.search).has('paid')
  if (!a.active) {
    app.innerHTML = '<h1>Choose a plan</h1><p class="muted small">Your account number</p><div class="acct">'+fmt(acct)+'</div>'
      + (justPaid ? '<p class="pending">Payment received by Zide. Activating your account…</p>' : '')
      + '<div class="plans">'
      + '<div class="plan"><span><strong>Monthly</strong><span class="muted small">$5.00 / month</span></span><button data-zide-checkout="/api/checkout" data-zide-body=\\'{"plan":"monthly","account":"'+acct+'"}\\'>Pay privately</button></div>'
      + '<div class="plan"><span><strong>Yearly</strong><span class="muted small">$50.00 / year</span></span><button data-zide-checkout="/api/checkout" data-zide-body=\\'{"plan":"yearly","account":"'+acct+'"}\\'>Pay privately</button></div>'
      + '</div><p class="muted small">Pay with cash or Zcash. Your payment is shielded: we never see your bank, card or wallet.</p>'
    if (window.Zide) window.Zide.mount(app); else window.addEventListener('load', () => window.Zide && window.Zide.mount(app))
    if (justPaid) setTimeout(render, 3000)
    return
  }
  let on = false
  app.innerHTML = '<button class="power" id="power">Connect</button><p id="state"><strong>Not connected</strong></p>'
    + '<div class="knows"><strong>What PrivateVPN knows about you</strong><p>Account '+fmt(acct)+', paid until '+day(a.active_until)+'. That is all.</p></div>'
    + '<button class="link" id="out">Remove account from this device</button>'
  document.getElementById('power').onclick = (e) => { on = !on; e.target.classList.toggle('on', on); e.target.textContent = on ? 'Connected' : 'Connect'; document.getElementById('state').innerHTML = on ? '<strong>Protected via Zurich, CH</strong>' : '<strong>Not connected</strong>' }
  document.getElementById('out').onclick = () => { store.set(null); history.replaceState(null,'','/'); render() }
  if (justPaid) history.replaceState(null,'','/')
}
render()
</script>
</body></html>`
