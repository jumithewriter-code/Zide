import { useEffect, useState } from 'react'
import { paymentQr } from '../qr'
import { api, period, usd, zecShort, type PayPage } from '../api'
import CashPay from '../components/CashPay'
import CopyButton from '../components/CopyButton'
import { ShieldCheckIcon } from '../components/Icons'
import Logo from '../components/Logo'

// Zide's hosted payment page. Merchants redirect here from a Checkout Session; the payer pays in
// cash (via an LP) or from a Zcash wallet, then returns to the merchant's success_url.

const REDIRECT_SECONDS = 5

export default function Pay({ sessionId }: { sessionId: string }) {
  const [page, setPage] = useState<PayPage | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<'cash' | 'wallet'>('cash')
  const [qr, setQr] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now() / 1000)
  const [redirectIn, setRedirectIn] = useState<number | null>(null)

  // Poll the session until it settles; the gateway does the chain watching.
  useEffect(() => {
    let stop = false
    const poll = async () => {
      try {
        const p = await api.pay(sessionId)
        if (stop) return
        setPage(p)
        setError(null)
        if (p.status === 'paid' || p.status === 'expired') return
      } catch (e) {
        if (!stop) setError((e as Error).message)
      }
      if (!stop) setTimeout(poll, 3000)
    }
    poll()
    const tick = setInterval(() => setNow(Date.now() / 1000), 1000)
    return () => {
      stop = true
      clearInterval(tick)
    }
  }, [sessionId])

  const uri = page?.payment_uri
  useEffect(() => {
    if (uri) paymentQr(uri).then(setQr, () => setQr(null))
  }, [uri])

  // After payment, count down and return to the merchant.
  const paid = page?.status === 'paid'
  useEffect(() => {
    if (!paid) return
    setRedirectIn(REDIRECT_SECONDS)
    const t = setInterval(() => setRedirectIn((s) => (s === null ? null : s - 1)), 1000)
    return () => clearInterval(t)
  }, [paid])
  useEffect(() => {
    if (redirectIn === 0 && page) window.location.assign(page.success_url)
  }, [redirectIn, page])

  if (!page) {
    return (
      <PayShell>
        {error ? <p className="notice notice-error">{error}</p> : <p className="muted">Loading payment…</p>}
      </PayShell>
    )
  }

  const left = Math.max(0, Math.floor(page.expires_at - now))
  return (
    <PayShell merchant={page.merchant_name} cancelUrl={paid ? undefined : page.cancel_url}>
      <div className="pay-summary">
        <span className="pay-merchant">
          <i aria-hidden>{page.merchant_name[0]}</i>
          {page.merchant_name}
        </span>
        <h1 className="pay-title">{page.description}</h1>
        <div className="pay-price">
          {usd(page.price_usd_cents)}
          {page.period_days && <small> / {period(page.period_days)}</small>}
        </div>
      </div>

      {paid ? (
        <div className="card card-success">
          <div className="success-mark" aria-hidden>
            ✓
          </div>
          <h2>Payment complete</h2>
          <p className="muted">
            {page.merchant_name} was told this payment is complete. It never received your name, bank, card or wallet.
          </p>
          <div className="row">
            <a className="btn btn-primary" href={page.success_url}>
              Return to {page.merchant_name}
              {redirectIn !== null && redirectIn > 0 ? ` (${redirectIn})` : ''}
            </a>
            {page.txids[0] && (
              <a className="btn btn-ghost" href={`#/tx/${page.txids[0]}`} onClick={() => setRedirectIn(null)}>
                See what the blockchain shows
              </a>
            )}
          </div>
        </div>
      ) : page.status === 'expired' ? (
        <div className="card">
          <h2>This payment link expired</h2>
          <p className="muted">ZEC quotes are only valid for a short time. Go back and start the payment again.</p>
          <a className="btn btn-primary" href={page.cancel_url}>
            Back to {page.merchant_name}
          </a>
        </div>
      ) : (
        <div className="card">
          {page.status === 'pending' ? (
            <p className="status status-pending">
              <span className="dot" /> Payment detected. Waiting for the next block…
            </p>
          ) : (
            <p className="status">
              <span className="dot" /> Waiting for payment…
            </p>
          )}
          <div className="amount">
            <span className="amount-zec">{zecShort(page.amount_zec)} ZEC</span>
            <span className="muted">
              {usd(page.price_usd_cents)} · quote valid {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}
            </span>
          </div>

          <div className="tabs" role="tablist">
            <button role="tab" aria-selected={tab === 'cash'} className={tab === 'cash' ? 'on' : ''} onClick={() => setTab('cash')}>
              Cash (P2P)
            </button>
            <button role="tab" aria-selected={tab === 'wallet'} className={tab === 'wallet' ? 'on' : ''} onClick={() => setTab('wallet')}>
              Zcash wallet
            </button>
          </div>

          {tab === 'cash' ? (
            <CashPay invoiceId={page.invoice_id} priceCents={page.price_usd_cents} />
          ) : (
            <div className="pay-wallet">
              {qr && <img className="qr" src={qr} alt="Payment QR code" width={240} height={240} />}
              <div className="pay-fields">
                <Field label="Send to (one-time shielded address)" value={page.address} />
                <Field label="Amount" value={`${page.amount_zec} ZEC`} copy={page.amount_zec} />
                <Field label="Memo (optional)" value={page.memo} />
                <p className="muted small">Scan the QR with a Zcash wallet and the address, amount and memo fill in automatically.</p>
              </div>
            </div>
          )}
        </div>
      )}
      {page.period_days && !paid && (
        <p className="muted small center">
          Covers one {period(page.period_days)}. Nothing is charged automatically: you renew by paying again.
        </p>
      )}
    </PayShell>
  )
}

function PayShell({ children, merchant, cancelUrl }: { children: React.ReactNode; merchant?: string; cancelUrl?: string }) {
  return (
    <div className="pay-shell">
      <header className="pay-top">
        {cancelUrl ? (
          <a href={cancelUrl} className="back">
            ← Back to {merchant}
          </a>
        ) : (
          <span />
        )}
        <span className="badge">Testnet</span>
      </header>
      <main className="narrow">
        {children}
        <p className="pay-shield">
          <ShieldCheckIcon /> Your name, bank, card and wallet are never shared with the merchant.
        </p>
      </main>
      <footer className="pay-foot">
        Secured by <Logo size={16} />
      </footer>
    </div>
  )
}

function Field({ label, value, copy }: { label: string; value: string; copy?: string }) {
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      <div className="field-row">
        <code className="field-value">{value}</code>
        <CopyButton text={copy ?? value} small />
      </div>
    </div>
  )
}
