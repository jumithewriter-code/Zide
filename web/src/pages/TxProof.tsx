import { useEffect, useState } from 'react'
import { api, type TxInspection } from '../api'

// Public testnet explorers don't follow NU7 yet, so the gateway reads the transaction from the
// chain and this page shows the explorer's view next to what Zide's viewing key reveals.

const zec = (zat: number) => `${(zat / 1e8).toFixed(8).replace(/0+$/, '').replace(/\.$/, '')} ZEC`

export default function TxProof({ txid }: { txid?: string }) {
  const [input, setInput] = useState(txid ?? '')
  const [data, setData] = useState<TxInspection | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!txid) return
    setBusy(true)
    setError(null)
    setData(null)
    api.inspectTx(txid).then(setData, (e: Error) => setError(e.message)).finally(() => setBusy(false))
  }, [txid])

  const pub = data?.public
  const actions = pub ? pub.orchard_actions + pub.ironwood_actions + pub.sapling_outputs : 0

  return (
    <section className="proof">
      <h1>What the blockchain shows</h1>
      <p className="muted">
        Paste a payment's transaction id to compare what the whole world can see with what Zide's viewing key sees.
      </p>
      <form
        className="proof-form"
        onSubmit={(e) => {
          e.preventDefault()
          if (input.trim()) window.location.hash = `#/tx/${input.trim()}`
        }}
      >
        <input
          className="input mono"
          placeholder="Transaction id (64 hex characters)"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          aria-label="Transaction id"
          spellCheck={false}
        />
        <button className="btn btn-primary" disabled={!input.trim() || busy}>
          {busy ? 'Reading chain…' : 'Inspect'}
        </button>
      </form>
      {error && <p className="notice notice-error">{error}</p>}

      {pub && data && (
        <div className="proof-grid">
          <div className="card">
            <p className="eyebrow">Anyone on the internet</p>
            <h2>Public view</h2>
            <dl className="facts">
              <dt>Sender</dt>
              <dd className="hidden-val">hidden</dd>
              <dt>Receiver</dt>
              <dd className="hidden-val">hidden</dd>
              <dt>Amount</dt>
              <dd className="hidden-val">hidden</dd>
              <dt>Memo</dt>
              <dd className="hidden-val">encrypted{pub.note_ciphertext_bytes ? ` (${pub.note_ciphertext_bytes}-byte ciphertext)` : ''}</dd>
              <dt>Shielded actions</dt>
              <dd>{actions} (real and dummy outputs look identical)</dd>
              <dt>Transparent in / out</dt>
              <dd>
                {pub.transparent_inputs} / {pub.transparent_outputs}
              </dd>
              <dt>Fee</dt>
              <dd>{pub.fee_zat !== null ? zec(pub.fee_zat) : 'unknown'}</dd>
              <dt>Block</dt>
              <dd>
                {pub.mined_height ?? 'mempool'}
                {data.confirmations ? ` · ${data.confirmations} confirmations` : ''}
              </dd>
              <dt>Format</dt>
              <dd>{pub.version} transaction</dd>
            </dl>
          </div>

          <div className="card card-key">
            <p className="eyebrow">Zide's viewing key only</p>
            <h2>Gateway view</h2>
            {data.zide_view.length === 0 ? (
              <p className="muted">Nothing in this transaction was sent to Zide.</p>
            ) : (
              data.zide_view.map((o, i) => (
                <dl className="facts" key={i}>
                  <dt>Amount</dt>
                  <dd>{o.amount_zec.replace(/0+$/, '').replace(/\.$/, '')} ZEC</dd>
                  <dt>Invoice</dt>
                  <dd>{o.invoice ? `${o.invoice.id} (${o.invoice.status})` : 'not matched'}</dd>
                  <dt>Memo</dt>
                  <dd className="memo">{o.memo ?? '(none)'}</dd>
                  <dt>Sender</dt>
                  <dd className="hidden-val">still hidden, even from Zide</dd>
                </dl>
              ))
            )}
            <p className="muted small">
              The viewing key can read payments to Zide but cannot spend them, and never reveals who sent them.
            </p>
          </div>
        </div>
      )}
    </section>
  )
}
