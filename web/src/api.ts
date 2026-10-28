// Typed client for the Zide gateway API (proxied at /v1 in dev).

export type InvoiceStatus = 'open' | 'pending' | 'paid' | 'expired'

/** What the hosted payment page needs for one checkout session. */
export interface PayPage {
  session_id: string
  merchant_name: string
  mode: 'payment' | 'subscription'
  description: string
  price_usd_cents: number
  period_days: number | null
  status: InvoiceStatus
  invoice_id: string
  address: string
  memo: string
  amount_zec: string
  payment_uri: string
  expires_at: number
  received_zat: number
  txids: string[]
  success_url: string
  cancel_url: string
}

export type P2PStatus = 'awaiting_fiat' | 'fiat_sent' | 'fiat_received' | 'zec_sent' | 'completed' | 'expired'

export interface P2POrder {
  order_id: string
  invoice_id: string
  reference: string
  fiat_cents: number
  status: P2PStatus
  expires_at: number
  lp: { handle: string; method: string; pay_to: string }
}

export interface LpOrder {
  order_id: string
  reference: string
  fiat_cents: number
  status: P2PStatus
  created_at: number
  send?: { address: string; amount_zec: string; memo: string; payment_uri: string }
}

export interface TxInspection {
  confirmations: number | null
  public: {
    txid: string
    version: string
    mined_height: number | null
    transparent_inputs: number
    transparent_outputs: number
    sapling_spends: number
    sapling_outputs: number
    orchard_actions: number
    ironwood_actions: number
    fee_zat: number | null
    note_ciphertext_bytes: number | null
  }
  zide_view: { pool: string; amount_zec: string; memo: string | null; invoice: { id: string; status: string } | null }[]
}

export interface Merchant {
  id: number
  slug: string
  name: string
  webhook_url: string | null
  webhook_secret: string
}

export interface Plan {
  id: number
  name: string
  price_usd_cents: number
  period_days: number
}

export interface Session {
  id: string
  mode: 'payment' | 'subscription'
  status: 'open' | 'complete' | 'expired'
  payment_status: 'unpaid' | 'processing' | 'paid'
  description: string
  amount_usd_cents: number
  amount_zec: string
  reference: string | null
  created_at: number
  paid_at: number | null
  url: string
  subscription?: { id: string; active: boolean; current_period_end: number | null } | null
}

async function call<T>(path: string, init?: RequestInit, secretKey?: string): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(secretKey ? { authorization: `Bearer ${secretKey}` } : {}),
      ...init?.headers,
    },
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`)
  return body as T
}

export const api = {
  pay: (sessionId: string) => call<PayPage>(`/v1/pay/${encodeURIComponent(sessionId)}`),
  inspectTx: (txid: string) => call<TxInspection>(`/v1/tx/${encodeURIComponent(txid)}`),
  existingP2P: (invoiceId: string) => call<P2POrder>(`/v1/invoices/${encodeURIComponent(invoiceId)}/p2p`),
  startP2P: (invoiceId: string) =>
    call<P2POrder>(`/v1/invoices/${encodeURIComponent(invoiceId)}/p2p`, { method: 'POST' }),
  p2p: (orderId: string) => call<P2POrder>(`/v1/p2p/${encodeURIComponent(orderId)}`),
  p2pSent: (orderId: string) => call<P2POrder>(`/v1/p2p/${encodeURIComponent(orderId)}/sent`, { method: 'POST' }),
}

/** Liquidity-provider calls, authenticated with the LP's own key (lp_test_…). */
export const lpApi = {
  signUp: (handle: string, method: string, pay_to: string) =>
    call<{ lp: { handle: string; method: string }; lp_key: string }>('/v1/lps', {
      method: 'POST',
      body: JSON.stringify({ handle, method, pay_to }),
    }),
  me: (key: string) => call<{ handle: string; method: string }>('/v1/lp', undefined, key),
  orders: (key: string) => call<{ orders: LpOrder[] }>('/v1/lp/orders', undefined, key).then((r) => r.orders),
  confirm: (key: string, orderId: string) =>
    call<{ status: string }>(`/v1/lp/orders/${encodeURIComponent(orderId)}/confirm`, { method: 'POST' }, key),
}

/** Merchant dashboard calls, authenticated with the merchant's secret key. */
export const merchantApi = {
  signUp: (name: string, webhook_url?: string) =>
    call<{ merchant: Merchant; secret_key: string; webhook_secret: string }>('/v1/merchants', {
      method: 'POST',
      body: JSON.stringify({ name, webhook_url: webhook_url || undefined }),
    }),
  me: (sk: string) => call<Merchant>('/v1/merchant', undefined, sk),
  updateWebhook: (sk: string, webhook_url: string | null) =>
    call<Merchant>('/v1/merchant', { method: 'PATCH', body: JSON.stringify({ webhook_url }) }, sk),
  plans: (sk: string) => call<{ plans: Plan[] }>('/v1/plans', undefined, sk).then((r) => r.plans),
  createPlan: (sk: string, plan: Omit<Plan, 'id'>) =>
    call<Plan>('/v1/plans', { method: 'POST', body: JSON.stringify(plan) }, sk),
  sessions: (sk: string) => call<{ data: Session[] }>('/v1/checkout/sessions', undefined, sk).then((r) => r.data),
}

export const usd = (cents: number) =>
  (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })

export const period = (days: number) =>
  days === 30 ? 'month' : days === 365 ? 'year' : `${days} days`

export const date = (unix: number) =>
  new Date(unix * 1000).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })

export const zecShort = (zec: string) => zec.replace(/0+$/, '').replace(/\.$/, '')
