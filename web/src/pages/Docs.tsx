import CodeBlock from '../components/CodeBlock'

// Developer docs: everything a merchant needs to integrate, on one page.

const API = 'http://127.0.0.1:8080'

const SIGN_UP = `curl -X POST ${API}/v1/merchants \\
  -H 'content-type: application/json' \\
  -d '{"name":"Acme VPN","webhook_url":"https://acme.example/zide/webhook"}'
# -> { "secret_key": "sk_test_…", "webhook_secret": "…" }  (shown once)`

const SERVER = `import { Zide } from '@zide/node'          // sdk/node in this repo
const zide = new Zide(process.env.ZIDE_SECRET_KEY)

app.post('/api/checkout', async (req, res) => {
  const session = await zide.checkout.sessions.create({
    mode: 'payment',                          // or 'subscription' with plan_id
    amount_usd_cents: 500,
    description: 'Pro plan',
    reference: req.user.anonymousId,          // your opaque id, never an email
    success_url: 'https://acme.example/thanks?session={SESSION_ID}',
    cancel_url: 'https://acme.example/pricing',
  })
  res.json({ url: session.url })
})`

const BUTTON = `<script src="${API}/zide.js" defer></script>
<button data-zide-checkout="/api/checkout">Pay privately</button>`

const WEBHOOK = `import { verifyWebhook } from '@zide/node'

app.post('/zide/webhook', express.raw({ type: '*/*' }), (req, res) => {
  const event = verifyWebhook(req.body, req.headers['zide-signature'], process.env.ZIDE_WEBHOOK_SECRET)
  if (event.type === 'checkout.completed') {
    const session = event.data   // { reference, amount_usd_cents, subscription, ... }
    unlockAccount(session.reference, session.subscription?.current_period_end)
  }
  res.sendStatus(200)
})`

const CURL_SESSION = `curl -X POST ${API}/v1/checkout/sessions \\
  -H "authorization: Bearer $ZIDE_SECRET_KEY" -H 'content-type: application/json' \\
  -d '{"mode":"subscription","plan_id":1,"reference":"acct_8f2k",
       "success_url":"https://acme.example/ok","cancel_url":"https://acme.example/"}'`

const ENDPOINTS: [string, string, string][] = [
  ['POST', '/v1/merchants', 'Create a merchant account. Returns the secret key once.'],
  ['GET / PATCH', '/v1/merchant', 'Read your account; set webhook_url.'],
  ['GET / POST', '/v1/plans', 'List or create subscription plans (create is idempotent).'],
  ['POST', '/v1/checkout/sessions', 'Start a one-off payment or a subscription. Returns url.'],
  ['GET', '/v1/checkout/sessions/{id}', 'status: open | complete | expired; payment_status: unpaid | processing | paid.'],
  ['GET', '/v1/checkout/sessions', 'Your latest 50 sessions.'],
  ['GET', '/v1/subscriptions/{id}', 'active, current_period_end, reference.'],
]

export default function Docs() {
  return (
    <section className="docs">
      <p className="eyebrow">Developers</p>
      <h1>Add shielded checkout in four steps</h1>
      <p className="lede left">
        Zide works like the payment APIs you know. The difference: the payment settles through shielded Zcash, so nothing
        public links your customer to you, and Zide never asks who they are.
      </p>

      <ol className="docs-steps">
        <li>
          <h2>Get your keys</h2>
          <p className="muted">
            Create an account in the <a href="#/dashboard">dashboard</a> or with one API call. Keep the secret key on your
            server.
          </p>
          <CodeBlock lang="shell" code={SIGN_UP} />
        </li>
        <li>
          <h2>Create a Checkout Session on your server</h2>
          <p className="muted">
            Identify the customer with your own <code>reference</code>, such as an anonymous account number. Zide rejects
            emails and names in references, so personal data can't leak by accident.
          </p>
          <CodeBlock lang="node" code={SERVER} />
        </li>
        <li>
          <h2>Add the button</h2>
          <p className="muted">
            <code>zide.js</code> calls your endpoint and sends the customer to Zide's hosted payment page. They can pay in
            cash through a peer-to-peer provider or from any Zcash wallet.
          </p>
          <CodeBlock lang="html" code={BUTTON} />
        </li>
        <li>
          <h2>Fulfil on the webhook</h2>
          <p className="muted">
            Zide signs every event with HMAC-SHA256. The payload is your own session: description, amount, your reference,
            subscription period. No transaction ids, addresses or anything about the payer.
          </p>
          <CodeBlock lang="node" code={WEBHOOK} />
        </li>
      </ol>

      <h2 className="docs-h2">API reference</h2>
      <p className="muted">
        Base URL <code>{API}</code>. Authenticate with <code>Authorization: Bearer sk_test_…</code>.
      </p>
      <div className="table-wrap">
        <table className="who">
          <thead>
            <tr>
              <th>Method</th>
              <th>Path</th>
              <th>What it does</th>
            </tr>
          </thead>
          <tbody>
            {ENDPOINTS.map(([m, p, d]) => (
              <tr key={p + m}>
                <td>
                  <code>{m}</code>
                </td>
                <td>
                  <code>{p}</code>
                </td>
                <td>{d}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <CodeBlock lang="shell" code={CURL_SESSION} />

      <h2 className="docs-h2">Under the hood</h2>
      <ul className="docs-notes">
        <li>Every session gets a fresh one-time shielded address (ZIP 316 diversified address).</li>
        <li>
          Payments are detected with a viewing key that can read but never spend, using the open-source{' '}
          <code>scanner</code> crate (librustzcash; Sapling, Orchard and the NU7 Ironwood pool).
        </li>
        <li>Quotes lock the ZEC price for 15 minutes (60 for cash payments). Over-payments are accepted.</li>
        <li>
          Testnet only. Use the <a href="#/tx">payment proof</a> page to see what the public chain shows for any payment.
        </li>
      </ul>
    </section>
  )
}
