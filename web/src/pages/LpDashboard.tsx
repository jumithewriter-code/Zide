import { useEffect, useState } from 'react'
import { paymentQr } from '../qr'
import { lpApi, usd, type LpOrder } from '../api'
import CopyButton from '../components/CopyButton'

// Liquidity-provider console. LPs sign in with their own key and only ever see their own
// orders. The key is kept for this browser tab only (sessionStorage).

const KEY_STORE = 'zide.lp.key'
const keyStore = {
  get: () => {
    try {
      return sessionStorage.getItem(KEY_STORE) ?? ''
    } catch {
      return ''
    }
  },
  set: (v: string) => {
    try {
      if (v) sessionStorage.setItem(KEY_STORE, v)
      else sessionStorage.removeItem(KEY_STORE)
    } catch {
      /* storage unavailable: stays signed in until reload */
    }
  },
}

const CHIP: Record<LpOrder['status'], string> = {
  awaiting_fiat: 'Awaiting cash',
  fiat_sent: 'Customer says sent',
  fiat_received: 'Send ZEC',
  zec_sent: 'ZEC in mempool',
  completed: 'Completed',
  expired: 'Expired',
}

export default function LpDashboard() {
  const [key, setKey] = useState(keyStore.get)
  const [lp, setLp] = useState<{ handle: string; method: string } | null>(null)
  const [orders, setOrders] = useState<LpOrder[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [newKey, setNewKey] = useState<string | null>(null)

  // Check the key, then follow this LP's orders.
  useEffect(() => {
    if (!key) return setLp(null)
    let stop = false
    lpApi.me(key).then(
      (me) => {
        if (stop) return
        setLp(me)
        keyStore.set(key)
        setError(null)
      },
      (e: Error) => {
        if (stop) return
        setError(e.message)
        keyStore.set('')
        setKey('')
      },
    )
    return () => {
      stop = true
    }
  }, [key])

  useEffect(() => {
    if (!lp) return
    let stop = false
    const load = () => lpApi.orders(key).then((o) => !stop && setOrders(o), () => {})
    load()
    const timer = setInterval(load, 3000)
    return () => {
      stop = true
      clearInterval(timer)
    }
  }, [lp, key])

  if (!lp) {
    return <Auth onKey={(k, fresh) => (setError(null), setNewKey(fresh ? k : null), setKey(k))} error={error} />
  }

  return (
    <section className="lp">
      <div className="dash-head">
        <div>
          <p className="eyebrow">Liquidity provider</p>
          <h1>{lp.handle}</h1>
          <p className="muted">
            {lp.method} · you see an amount and a reference, <strong>never which merchant the customer is paying</strong>.
          </p>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={() => (keyStore.set(''), setKey(''), setOrders(null), setNewKey(null))}>
          Sign out
        </button>
      </div>
      {newKey && (
        <div className="card card-key lp-newkey">
          <h2>Your LP key</h2>
          <p className="muted">Shown once. Save it: it's how you sign in to this dashboard.</p>
          <div className="field-row">
            <code className="field-value">{newKey}</code>
            <CopyButton text={newKey} small />
          </div>
        </div>
      )}
      {orders === null && <p className="muted">Loading orders…</p>}
      {orders?.length === 0 && <p className="muted">No orders yet. They appear here when a customer chooses to pay with cash.</p>}
      <div className="lp-orders">
        {orders?.map((o) => <OrderCard key={o.order_id} order={o} lpKey={key} />)}
      </div>
    </section>
  )
}

const METHODS = ['Bank transfer (SEPA)', 'UPI', 'Revolut', 'PIX', 'M-Pesa', 'Cash in person']

function Auth({ onKey, error }: { onKey: (key: string, fresh: boolean) => void; error: string | null }) {
  const [value, setValue] = useState('')
  const [handle, setHandle] = useState('')
  const [method, setMethod] = useState(METHODS[0])
  const [payTo, setPayTo] = useState('')
  const [busy, setBusy] = useState(false)
  const [signUpError, setSignUpError] = useState<string | null>(null)

  async function signUp() {
    setBusy(true)
    setSignUpError(null)
    try {
      const r = await lpApi.signUp(handle.trim(), method, payTo.trim())
      onKey(r.lp_key, true)
    } catch (e) {
      setSignUpError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="lp">
      <p className="eyebrow">Liquidity providers</p>
      <h1>Sell shielded ZEC for cash</h1>
      <p className="muted">
        LPs take a customer's cash payment and send shielded ZEC in return, earning the spread. You see an amount and a
        reference, never which merchant the customer is paying.
      </p>
      <div className="dash-auth">
        <form
          className="card"
          onSubmit={(e) => {
            e.preventDefault()
            signUp()
          }}
        >
          <h2>Become a liquidity provider</h2>
          <p className="muted small">Testnet. No ID needed.</p>
          <label className="field-label" htmlFor="lp-handle">
            Handle
          </label>
          <input id="lp-handle" className="input" value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="e.g. river-lp" autoComplete="off" />
          <label className="field-label" htmlFor="lp-method">
            How customers pay you
          </label>
          <select id="lp-method" className="input" value={method} onChange={(e) => setMethod(e.target.value)}>
            {METHODS.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
          <label className="field-label" htmlFor="lp-payto">
            Your payment details (shown to customers)
          </label>
          <input id="lp-payto" className="input" value={payTo} onChange={(e) => setPayTo(e.target.value)} placeholder="IBAN, UPI id, phone number…" autoComplete="off" />
          {signUpError && <p className="notice notice-error">{signUpError}</p>}
          <button className="btn btn-primary" disabled={busy || !handle.trim() || !payTo.trim()}>
            {busy ? 'Creating…' : 'Create LP account'}
          </button>
        </form>
        <form
          className="card"
          onSubmit={(e) => {
            e.preventDefault()
            if (value.trim()) onKey(value.trim(), false)
          }}
        >
          <h2>Sign in</h2>
          <p className="muted small">Your key stays in this browser tab only.</p>
        <label className="field-label" htmlFor="lp-key">
          LP key
        </label>
        <input
          id="lp-key"
          className="input mono"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="lp_test_…"
          autoComplete="off"
          spellCheck={false}
        />
        {error && <p className="notice notice-error">{error}</p>}
        <button className="btn btn-ghost" disabled={!value.trim()}>
          Sign in
        </button>
        <p className="muted small">Testnet demo: the demo LPs' keys are in lp-keys.json next to the gateway.</p>
        </form>
      </div>
    </section>
  )
}

function OrderCard({ order, lpKey }: { order: LpOrder; lpKey: string }) {
  const [busy, setBusy] = useState(false)
  const [qr, setQr] = useState<string | null>(null)
  const uri = order.send?.payment_uri

  useEffect(() => {
    if (uri) paymentQr(uri).then(setQr, () => setQr(null))
  }, [uri])

  async function confirm() {
    setBusy(true)
    try {
      await lpApi.confirm(lpKey, order.order_id)
    } finally {
      setBusy(false)
    }
  }

  return (
    <article className={`card lp-order lp-${order.status}`}>
      <header className="lp-order-head">
        <div>
          <div className="lp-amount">{usd(order.fiat_cents)}</div>
          <div className="muted small">
            Ref <code>{order.reference}</code> · {new Date(order.created_at * 1000).toLocaleTimeString()}
          </div>
        </div>
        <span className="chip">{CHIP[order.status]}</span>
      </header>

      {(order.status === 'awaiting_fiat' || order.status === 'fiat_sent') && (
        <>
          <p className="muted small">
            Check your account for {usd(order.fiat_cents)} with reference {order.reference}. Only confirm once the money
            has really arrived.
          </p>
          <button className="btn btn-primary" disabled={busy} onClick={confirm}>
            Cash received
          </button>
        </>
      )}

      {order.status === 'fiat_received' && order.send && (
        <div className="pay-wallet">
          {qr && <img className="qr qr-sm" src={qr} alt="Payment QR code" width={160} height={160} />}
          <div className="pay-fields">
            <p className="small">Send from your shielded wallet:</p>
            <div className="field">
              <span className="field-label">Amount</span>
              <div className="field-row">
                <code className="field-value">{order.send.amount_zec} ZEC</code>
                <CopyButton text={order.send.amount_zec} small />
              </div>
            </div>
            <div className="field">
              <span className="field-label">To (one-time address, reveals nothing about the merchant)</span>
              <div className="field-row">
                <code className="field-value">{order.send.address}</code>
                <CopyButton text={order.send.address} small />
              </div>
            </div>
            <div className="field">
              <span className="field-label">Memo</span>
              <div className="field-row">
                <code className="field-value">{order.send.memo}</code>
                <CopyButton text={order.send.memo} small />
              </div>
            </div>
          </div>
        </div>
      )}

      {order.status === 'zec_sent' && <p className="muted small">Payment seen. Waiting for the next block…</p>}
      {order.status === 'completed' && <p className="small ok">Trade complete. You earned the spread.</p>}
    </article>
  )
}
