// Demo helper: prints everything Zide stores, to show there is no personal data in it,
// plus explorer links for the shielded payments it has seen.
// Usage (from the project root): node tools/show-db.mjs [path/to/zide.sqlite]
import { DatabaseSync } from 'node:sqlite'

const db = new DatabaseSync(process.argv[2] ?? 'zide.sqlite', { readOnly: true })
const explorer = 'https://testnet.zcashexplorer.app/transactions/'
const short = (v) => (typeof v === 'string' && v.length > 28 ? `${v.slice(0, 14)}…${v.slice(-8)}` : v)
const time = (unix) => (unix ? new Date(unix * 1000).toISOString().replace('T', ' ').slice(0, 16) : '')

function show(title, sql, map = (r) => r) {
  const rows = db.prepare(sql).all().map(map)
  console.log(`\n== ${title} (${rows.length})`)
  if (rows.length) console.table(rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, short(v)]))))
}

console.log('Columns Zide stores, per table:')
for (const { name } of db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all()) {
  const cols = db.prepare(`PRAGMA table_info(${name})`).all().map((c) => c.name)
  console.log(`  ${name.padEnd(14)} ${cols.join(', ')}`)
}

show(
  'Merchants: a name and a webhook URL (keys are stored only as hashes, in api_keys)',
  'SELECT id, name, webhook_url FROM merchants ORDER BY id',
)
show(
  "Checkout sessions: the merchant's own opaque reference, never a person",
  `SELECT s.id, s.mode, s.reference, i.description, i.price_usd_cents AS usd_cents, i.status
   FROM checkout_sessions s JOIN invoices i ON i.id = s.invoice_id ORDER BY s.created_at DESC LIMIT 8`,
)
show(
  'Subscriptions',
  'SELECT id, reference, status, current_period_end FROM subscriptions ORDER BY rowid DESC LIMIT 8',
  (r) => ({ ...r, current_period_end: time(r.current_period_end) }),
)
show(
  'Cash orders: an amount and a random reference',
  `SELECT o.reference, l.handle AS lp, o.fiat_cents, o.status FROM lp_orders o JOIN lps l ON l.id = o.lp_id
   ORDER BY o.created_at DESC LIMIT 8`,
)

const payments = db
  .prepare('SELECT txid, pool, value_zat, mined_height FROM payments ORDER BY mined_height DESC')
  .all()
console.log(`\n== Shielded payments (${payments.length}): open any of these in a block explorer`)
for (const p of payments) {
  console.log(`  block ${p.mined_height ?? 'mempool'}  ${p.pool.padEnd(8)} ${explorer}${p.txid}`)
}
console.log('\nNo names, emails, card numbers, bank details or sender addresses: there are no columns for them.')
