import { useCallback, useEffect, useState } from 'react'
import { date, merchantApi, period, usd, type Merchant, type Plan, type Session } from '../api'
import CopyButton from '../components/CopyButton'

// Merchant dashboard. The secret key is kept for this browser tab only (sessionStorage);
// a production dashboard would use a proper login instead of the API key.

const SK_KEY = 'zide.dashboard.sk'
const skStore = {
  get: () => {
    try {
      return sessionStorage.getItem(SK_KEY) ?? ''
    } catch {
      return ''
    }
  },
  set: (v: string) => {
    try {
      if (v) sessionStorage.setItem(SK_KEY, v)
      else sessionStorage.removeItem(SK_KEY)
    } catch {
      /* storage unavailable: stays signed in until reload */
    }
  },
}

export default function Dashboard() {
  const [sk, setSk] = useState(skStore.get)
  const [merchant, setMerchant] = useState<Merchant | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [newKey, setNewKey] = useState<string | null>(null)

  useEffect(() => {
    if (!sk) return setMerchant(null)
    merchantApi.me(sk).then(
      (m) => {
        setMerchant(m)
        skStore.set(sk)
      },
      (e: Error) => {
        setError(e.message)
        setSk('')
        skStore.set('')
      },
    )
  }, [sk])

  if (!sk || !merchant) {
    return <SignIn onKey={(key, fresh) => (setError(null), setNewKey(fresh ? key : null), setSk(key))} error={error} />
  }

  return (
    <section className="dash">
      <header className="dash-head">
        <div>
          <p className="eyebrow">Merchant dashboard</p>
          <h1>{merchant.name}</h1>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={() => (skStore.set(''), setSk(''), setNewKey(null))}>
          Sign out
        </button>
      </header>
      {newKey && (
        <div className="card card-key">
          <h2>Your secret key</h2>
          <p className="muted">Shown once. Put it in your server's environment as ZIDE_SECRET_KEY, never in browser code.</p>
          <div className="field-row">
            <code className="field-value">{newKey}</code>
            <CopyButton text={newKey} small />
          </div>
        </div>
      )}
      <div className="dash-grid">
        <Payments sk={sk} />
        <div className="dash-side">
          <Webhook sk={sk} merchant={merchant} onChange={setMerchant} />
          <Plans sk={sk} />
        </div>
      </div>
    </section>
  )
}

function SignIn({ onKey, error }: { onKey: (key: string, fresh: boolean) => void; error: string | null }) {
  const [key, setKey] = useState('')
  const [name, setName] = useState('')
  const [webhook, setWebhook] = useState('')
  const [busy, setBusy] = useState(false)
  const [signUpError, setSignUpError] = useState<string | null>(null)

  async function signUp() {
    setBusy(true)
    setSignUpError(null)
    try {
      const r = await merchantApi.signUp(name.trim(), webhook.trim())
      onKey(r.secret_key, true)
    } catch (e) {
      setSignUpError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="dash">
      <p className="eyebrow">Merchant dashboard</p>
      <h1>Accept shielded payments</h1>
      <div className="dash-auth">
        <form
          className="card"
          onSubmit={(e) => {
            e.preventDefault()
            signUp()
          }}
        >
          <h2>Create a merchant account</h2>
          <p className="muted small">Testnet. No email or ID needed.</p>
          <label className="field-label" htmlFor="m-name">Business name</label>
          <input id="m-name" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme VPN" />
          <label className="field-label" htmlFor="m-hook">Webhook URL (optional)</label>
          <input id="m-hook" className="input" value={webhook} onChange={(e) => setWebhook(e.target.value)} placeholder="https://acme.example/zide/webhook" />
          {signUpError && <p className="notice notice-error">{signUpError}</p>}
          <button className="btn btn-primary" disabled={busy || !name.trim()}>
            {busy ? 'Creating…' : 'Create account'}
          </button>
        </form>
        <form
          className="card"
          onSubmit={(e) => {
            e.preventDefault()
            if (key.trim()) onKey(key.trim(), false)
          }}
        >
          <h2>Sign in with your secret key</h2>
          <p className="muted small">Your key stays in this browser tab only.</p>
          <label className="field-label" htmlFor="m-key">Secret key</label>
          <input id="m-key" className="input mono" value={key} onChange={(e) => setKey(e.target.value)} placeholder="sk_test_…" autoComplete="off" />
          {error && <p className="notice notice-error">{error}</p>}
          <button className="btn btn-ghost" disabled={!key.trim()}>
            Sign in
          </button>
        </form>
      </div>
    </section>
  )
}

const STATUS_LABEL: Record<string, string> = { paid: 'Paid', processing: 'Processing', unpaid: 'Unpaid' }

function Payments({ sk }: { sk: string }) {
  const [sessions, setSessions] = useState<Session[] | null>(null)

  const load = useCallback(() => merchantApi.sessions(sk).then(setSessions, () => {}), [sk])
  useEffect(() => {
    load()
    const t = setInterval(load, 4000)
    return () => clearInterval(t)
  }, [load])

  const paid = sessions?.filter((s) => s.payment_status === 'paid') ?? []
  const volume = paid.reduce((sum, s) => sum + s.amount_usd_cents, 0)

  return (
    <div className="card dash-payments">
      <div className="dash-stats">
        <div>
          <span className="muted small">Paid volume</span>
          <strong>{usd(volume)}</strong>
        </div>
        <div>
          <span className="muted small">Payments</span>
          <strong>{paid.length}</strong>
        </div>
        <div>
          <span className="muted small">Customer data stored</span>
          <strong>None</strong>
        </div>
      </div>
      <h2>Payments</h2>
      {sessions === null && <p className="muted">Loading…</p>}
      {sessions?.length === 0 && <p className="muted">No payments yet. Create a Checkout Session from your server (see the docs).</p>}
      {sessions && sessions.length > 0 && (
        <div className="table-wrap">
          <table className="who dash-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Description</th>
                <th>Amount</th>
                <th>Your reference</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr key={s.id}>
                  <td>{date(s.created_at)}</td>
                  <td>
                    {s.description}
                    {s.mode === 'subscription' && <span className="sub">subscription</span>}
                  </td>
                  <td>{usd(s.amount_usd_cents)}</td>
                  <td>
                    <code title={s.reference ?? undefined}>{s.reference ?? '—'}</code>
                  </td>
                  <td>
                    <span className={`chip chip-${s.status === 'expired' ? 'expired' : s.payment_status}`}>
                      {s.status === 'expired' ? 'Expired' : STATUS_LABEL[s.payment_status]}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted small">This is everything Zide can tell you about a payer: what they paid for and the reference you chose.</p>
    </div>
  )
}

function Webhook({ sk, merchant, onChange }: { sk: string; merchant: Merchant; onChange: (m: Merchant) => void }) {
  const [url, setUrl] = useState(merchant.webhook_url ?? '')
  const [msg, setMsg] = useState<string | null>(null)
  const [reveal, setReveal] = useState(false)

  async function save() {
    try {
      onChange(await merchantApi.updateWebhook(sk, url.trim() || null))
      setMsg('Saved')
    } catch (e) {
      setMsg((e as Error).message)
    }
  }

  return (
    <div className="card">
      <h2>Webhook</h2>
      <p className="muted small">Zide POSTs a signed <code>checkout.completed</code> event here.</p>
      <div className="field-row">
        <input className="input" style={{ margin: 0 }} value={url} onChange={(e) => (setUrl(e.target.value), setMsg(null))} placeholder="https://…" />
        <button className="btn btn-ghost btn-sm" onClick={save}>
          Save
        </button>
      </div>
      {msg && <p className="muted small">{msg}</p>}
      <span className="field-label" style={{ marginTop: 14 }}>
        Signing secret
      </span>
      <div className="field-row">
        <code className="field-value">{reveal ? merchant.webhook_secret : '•'.repeat(24)}</code>
        <button className="btn btn-ghost btn-sm" onClick={() => setReveal((r) => !r)}>
          {reveal ? 'Hide' : 'Reveal'}
        </button>
      </div>
    </div>
  )
}

function Plans({ sk }: { sk: string }) {
  const [plans, setPlans] = useState<Plan[] | null>(null)
  const [name, setName] = useState('Monthly')
  const [price, setPrice] = useState('5.00')
  const [days, setDays] = useState('30')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    merchantApi.plans(sk).then(setPlans, () => setPlans([]))
  }, [sk])

  async function add() {
    setError(null)
    try {
      const plan = await merchantApi.createPlan(sk, {
        name: name.trim(),
        price_usd_cents: Math.round(Number(price) * 100),
        period_days: Number(days),
      })
      setPlans((p) => [...(p ?? []).filter((x) => x.id !== plan.id), plan])
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <div className="card">
      <h2>Subscription plans</h2>
      {plans?.length === 0 && <p className="muted small">No plans yet. One-off payments don't need a plan.</p>}
      <ul className="dash-plans">
        {plans?.map((p) => (
          <li key={p.id}>
            <span className="plan-name">{p.name}</span>
            <span className="plan-meta">
              {usd(p.price_usd_cents)}/{period(p.period_days)}
              <CopyButton text={String(p.id)} small label="Copy plan ID" />
            </span>
          </li>
        ))}
      </ul>
      <div className="dash-plan-form">
        <label>
          <span className="field-label">Plan name</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Monthly" />
        </label>
        <label>
          <span className="field-label">Price (USD)</span>
          <input className="input" value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" placeholder="5.00" />
        </label>
        <label>
          <span className="field-label">Billing period (days)</span>
          <input className="input" value={days} onChange={(e) => setDays(e.target.value)} inputMode="numeric" placeholder="30" />
        </label>
      </div>
      {error && <p className="notice notice-error">{error}</p>}
      <button className="btn btn-ghost btn-sm" onClick={add}>
        Add plan
      </button>
    </div>
  )
}
