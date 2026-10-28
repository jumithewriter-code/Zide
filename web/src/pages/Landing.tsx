import CodeBlock from '../components/CodeBlock'
import {
  CheckoutIcon,
  CodeIcon,
  EyeOffIcon,
  LockKeyIcon,
  RepeatIcon,
  ShieldIcon,
  SlidersIcon,
  UserShieldIcon,
} from '../components/Icons'
import NetworkBg from '../components/NetworkBg'

const DEMO_STORE = 'http://localhost:4000'

// One payment, seen from three places.
const VIEWS = [
  { label: 'The customer sees', value: '$5.00 cash', note: 'paid to a peer-to-peer provider. No wallet needed.', kind: 'you' },
  { label: 'The blockchain sees', value: '', note: 'sender, receiver, amount and memo, all encrypted.', kind: 'chain' },
  { label: 'The merchant sees', value: 'acct_8f2k · paid', note: 'its own reference, now paid. Nothing else.', kind: 'app' },
] as const

const PRINCIPLES = [
  {
    icon: UserShieldIcon,
    title: 'Privacy',
    text: 'Your identity never enters the payment. Merchants get an opaque reference, the chain gets ciphertext, and Zide never asks who you are.',
  },
  {
    icon: LockKeyIcon,
    title: 'Secure Payment',
    text: 'Every payment settles in the Zcash shielded pool and is verified with a viewing key that can read payments but can never spend them.',
  },
  {
    icon: SlidersIcon,
    title: 'User First',
    text: 'Pay with cash through a peer-to-peer provider or from any Zcash wallet. No account, no app to install, nothing to remember.',
  },
]

const OFFERINGS = [
  {
    icon: CheckoutIcon,
    eyebrow: 'Hosted checkout',
    title: 'Private Checkout',
    text: 'One redirect to a payment page that shows the price and how to pay, and nothing about the customer.',
    meta: [
      ['Pay with', 'Cash (P2P) or any Zcash wallet'],
      ['Settles in', 'Zcash shielded pool, one-time address per payment'],
    ],
  },
  {
    icon: RepeatIcon,
    eyebrow: 'Payments & subscriptions',
    title: 'One-off or Recurring',
    text: 'Point-of-sale style payments and subscriptions with renewals, on the same Checkout Sessions API.',
    meta: [
      ['Modes', 'payment, subscription'],
      ['Customer id', 'Your opaque reference; emails are rejected'],
    ],
  },
  {
    icon: CodeIcon,
    eyebrow: 'Developer toolkit',
    title: 'SDK, Button & Webhooks',
    text: 'A Node SDK, a drop-in "Pay privately" button and HMAC-signed webhooks carrying only your own reference.',
    meta: [
      ['Ships with', '@zide/node, zide.js, example app'],
      ['Open source', 'Rust scanner on librustzcash, NU7 Ironwood ready'],
    ],
  },
]

const WHO_KNOWS = [
  { who: 'The merchant', knows: 'That its reference got paid', never: 'Your name, email, card, bank or wallet' },
  { who: 'Zcash blockchain', knows: 'That a shielded transaction happened', never: 'Sender, receiver, amount, memo' },
  { who: 'Zide', knows: 'Which merchant was paid', never: 'Who you are' },
  { who: 'Cash provider (LP)', knows: 'Who paid them cash', never: 'Which merchant it was for' },
]

const SNIPPET = `const session = await zide.checkout.sessions.create({
  mode: 'payment',
  amount_usd_cents: 500,
  reference: 'acct_8f2k',        // your id, never an email
  success_url: 'https://you.example/thanks',
  cancel_url: 'https://you.example/cart',
})
res.redirect(session.url)`

function Redacted() {
  return (
    <span className="redacted" aria-label="encrypted">
      <i style={{ width: '44%' }} />
      <i style={{ width: '30%' }} />
      <i style={{ width: '18%' }} />
    </span>
  )
}

export default function Landing() {
  return (
    <>
      <section className="band band-glow hero" id="overview">
        <NetworkBg />
        <div className="hero-in">
          <span className="badge-outline">
            <ShieldIcon /> Privacy-first gateway
          </span>
          <h1>
            Privacy Without <span className="hl">Compromise</span>
          </h1>
          <p className="lede">
            Zide is a privacy-first payment gateway that lets people subscribe to apps and pay merchants online without
            revealing their identity.
          </p>
          <div className="hero-actions">
            <a className="btn btn-primary btn-lg" href="#/docs">
              Start integrating
            </a>
            <a className="btn btn-ghost btn-lg" href={DEMO_STORE}>
              Try the demo app
            </a>
          </div>
        </div>
      </section>

      <section className="band band-line">
        <div className="wrap identity">
          <div>
            <p className="eyebrow">Total identity protection</p>
            <h2>Anonymous Transactions Built For The Modern Web</h2>
            <p>
              Online payments usually mean handing over your name, card and purchase history. Zide moves the payment
              through the Zcash shielded pool, so nothing public links you to the merchant you paid.
            </p>
            <div className="callout">
              Subscribe to apps, buy online and pay merchants directly, while the merchant learns only that its own
              reference was paid.
            </div>
          </div>
          <ol className="views" aria-label="One payment, three points of view">
            {VIEWS.map((v) => (
              <li key={v.kind} className={`view view-${v.kind}`}>
                <span className="view-num" aria-hidden />
                <span className="view-label">{v.label}</span>
                <span className="view-value">{v.kind === 'chain' ? <Redacted /> : v.value}</span>
                <span className="view-note">{v.note}</span>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="band band-glow band-line" id="values">
        <div className="wrap">
          <div className="section-head">
            <p className="eyebrow">Guiding principles</p>
            <h2>Built On Three Commitments</h2>
            <p>What every payment through Zide is designed around, from the API to the blockchain.</p>
          </div>
          <div className="principles">
            {PRINCIPLES.map(({ icon: Icon, title, text }) => (
              <article className="principle" key={title}>
                <span className="icon-tile">
                  <Icon />
                </span>
                <h3>{title}</h3>
                <p>{text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="band band-line" id="products">
        <div className="wrap">
          <div className="section-head">
            <p className="eyebrow">Gateway offerings</p>
            <h2>Featured Solutions</h2>
            <p>Everything an app needs to take payments that don't publish who paid whom.</p>
          </div>
          <div className="offerings">
            {OFFERINGS.map(({ icon: Icon, eyebrow, title, text, meta }) => (
              <article className="offering" key={title}>
                <div className="offering-art">
                  <Icon />
                </div>
                <div className="offering-body">
                  <p className="eyebrow">{eyebrow}</p>
                  <h3>{title}</h3>
                  <p>{text}</p>
                  <div className="offering-meta">
                    {meta.map(([k, v]) => (
                      <span key={k}>
                        {k}: <b>{v}</b>
                      </span>
                    ))}
                  </div>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="band band-glow-top band-line" id="developers">
        <div className="wrap split">
          <div>
            <p className="eyebrow">For developers</p>
            <h2>A Few Lines On Your Server</h2>
            <p className="muted">
              Create a Checkout Session, redirect, and fulfil on the signed webhook. Or drop in <code>zide.js</code> for a
              ready-made "Pay privately" button.
            </p>
            <a className="btn btn-ghost" href="#/docs">
              Read the docs
            </a>
          </div>
          <CodeBlock lang="node" code={SNIPPET} />
        </div>
      </section>

      <section className="band band-line" id="ecosystem">
        <div className="wrap">
          <div className="section-head">
            <p className="eyebrow">The privacy model</p>
            <h2>Who Knows What</h2>
            <p>No single party can connect a customer to the merchant they paid.</p>
          </div>
          <div className="table-wrap">
            <table className="who">
              <thead>
                <tr>
                  <th>Party</th>
                  <th>Knows</th>
                  <th>Never learns</th>
                </tr>
              </thead>
              <tbody>
                {WHO_KNOWS.map((r) => (
                  <tr key={r.who}>
                    <td>{r.who}</td>
                    <td>{r.knows}</td>
                    <td className="never">{r.never}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="band band-glow band-line cta">
        <div className="wrap">
          <span className="icon-tile" style={{ margin: '0 auto 22px' }}>
            <EyeOffIcon />
          </span>
          <h2>
            Take Payments. <span className="hl">Leave No Trace.</span>
          </h2>
          <p className="lede">Create a merchant account in seconds on testnet and send your first private payment.</p>
          <div className="hero-actions">
            <a className="btn btn-primary btn-lg" href="#/dashboard">
              Create merchant account
            </a>
            <a className="btn btn-ghost btn-lg" href="#/tx">
              Inspect a real payment
            </a>
          </div>
        </div>
      </section>
    </>
  )
}

