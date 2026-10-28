import { useEffect, useState } from 'react'
import { api, usd, type P2POrder } from '../api'
import CopyButton from './CopyButton'

const STATUS_TEXT: Record<P2POrder['status'], (lp: string) => string> = {
  awaiting_fiat: () => 'Send the money, then tell us below.',
  fiat_sent: (lp) => `Waiting for ${lp} to confirm your payment arrived…`,
  fiat_received: (lp) => `${lp} confirmed your payment and is sending shielded ZEC…`,
  zec_sent: () => 'Shielded ZEC is on its way. Waiting for the next block…',
  completed: () => 'Done.',
  expired: () => 'This order expired.',
}

export default function CashPay({ invoiceId, priceCents }: { invoiceId: string; priceCents: number }) {
  const [order, setOrder] = useState<P2POrder | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run(action: () => Promise<P2POrder>) {
    setBusy(true)
    setError(null)
    try {
      setOrder(await action())
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  // After a reload, pick up a cash order that was already started for this invoice.
  useEffect(() => {
    api.existingP2P(invoiceId).then(setOrder, () => {})
  }, [invoiceId])

  // Follow the order while the LP works through it.
  const orderId = order?.order_id
  useEffect(() => {
    if (!orderId) return
    const timer = setInterval(() => {
      api.p2p(orderId).then(setOrder, () => {})
    }, 3000)
    return () => clearInterval(timer)
  }, [orderId])

  if (!order) {
    return (
      <div className="pay-cash">
        <p>
          Pay <strong>{usd(priceCents)}</strong> in your local currency to a liquidity provider (LP). The LP then sends
          shielded ZEC to this invoice for you. You don't need a crypto wallet.
        </p>
        <ul className="muted">
          <li>The LP sees who paid them, but not which app you bought.</li>
          <li>Zide sees which app was paid, but not who you are.</li>
        </ul>
        {error && <p className="notice notice-error">{error}</p>}
        <button className="btn btn-primary" disabled={busy} onClick={() => run(() => api.startP2P(invoiceId))}>
          {busy ? 'Finding an LP…' : 'Pay with cash'}
        </button>
        <p className="muted small">Testnet demo: LPs are simulated on the LP dashboard.</p>
      </div>
    )
  }

  const { lp } = order
  return (
    <div className="pay-cash">
      <p>
        Matched with LP <strong>{lp.handle}</strong>. Send exactly <strong>{usd(order.fiat_cents)}</strong>:
      </p>
      <div className="lp-details">
        <div className="field">
          <span className="field-label">Method</span>
          <span>{lp.method}</span>
        </div>
        <div className="field">
          <span className="field-label">Pay to</span>
          <div className="field-row">
            <code className="field-value">{lp.pay_to}</code>
            <CopyButton text={lp.pay_to} small />
          </div>
        </div>
        <div className="field">
          <span className="field-label">Payment reference (include it so the LP can match your payment)</span>
          <div className="field-row">
            <code className="field-value ref">{order.reference}</code>
            <CopyButton text={order.reference} small />
          </div>
        </div>
      </div>
      <p className={`status${order.status === 'awaiting_fiat' ? '' : ' status-pending'}`}>
        <span className="dot" /> {STATUS_TEXT[order.status](lp.handle)}
      </p>
      {error && <p className="notice notice-error">{error}</p>}
      {order.status === 'awaiting_fiat' && (
        <button className="btn btn-primary" disabled={busy} onClick={() => run(() => api.p2pSent(order.order_id))}>
          I've sent the money
        </button>
      )}
    </div>
  )
}
