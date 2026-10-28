// @zide/node — server-side SDK for the Zide shielded payment gateway. Zero dependencies (Node 18+).
//
//   import { Zide, verifyWebhook } from '@zide/node'
//   const zide = new Zide(process.env.ZIDE_SECRET_KEY)
//   const session = await zide.checkout.sessions.create({
//     mode: 'payment', amount_usd_cents: 500, description: 'Coffee',
//     reference: 'order_42', success_url: 'https://shop.example/thanks', cancel_url: 'https://shop.example/cart',
//   })
//   // redirect the customer to session.url

import { createHmac, timingSafeEqual } from 'node:crypto'

const DEFAULT_BASE_URL = 'http://127.0.0.1:8080'

export class ZideError extends Error {
  constructor(message, status) {
    super(message)
    this.name = 'ZideError'
    this.status = status
  }
}

async function request(baseUrl, secretKey, method, path, body) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(secretKey ? { authorization: `Bearer ${secretKey}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new ZideError(data.error ?? `Zide API error ${res.status}`, res.status)
  return data
}

export class Zide {
  /**
   * @param {string} secretKey  `sk_test_…` from sign-up. Keep it on your server.
   * @param {{ baseUrl?: string }} [options]
   */
  constructor(secretKey, { baseUrl = DEFAULT_BASE_URL } = {}) {
    if (!secretKey) throw new ZideError('A Zide secret key is required')
    const call = (method, path, body) => request(baseUrl, secretKey, method, path, body)

    this.checkout = {
      sessions: {
        /**
         * @param {{
         *   mode: 'payment' | 'subscription',
         *   amount_usd_cents?: number, description?: string,
         *   plan_id?: number, subscription_id?: string,
         *   reference?: string, success_url: string, cancel_url: string,
         * }} params  `reference` must be an opaque id (no emails or names).
         *            `{SESSION_ID}` in success_url is replaced with the session id.
         */
        create: (params) => call('POST', '/v1/checkout/sessions', params),
        retrieve: (id) => call('GET', `/v1/checkout/sessions/${encodeURIComponent(id)}`),
        list: () => call('GET', '/v1/checkout/sessions').then((r) => r.data),
      },
    }
    this.subscriptions = {
      retrieve: (id) => call('GET', `/v1/subscriptions/${encodeURIComponent(id)}`),
    }
    this.plans = {
      /** Idempotent: the same name, price and period returns the existing plan. */
      create: (params) => call('POST', '/v1/plans', params),
      list: () => call('GET', '/v1/plans').then((r) => r.plans),
    }
    this.merchant = {
      retrieve: () => call('GET', '/v1/merchant'),
      update: (params) => call('PATCH', '/v1/merchant', params),
    }
  }

  /**
   * Creates a merchant account. Returns `{ merchant, secret_key, webhook_secret }`;
   * the secret key is shown only once.
   * @param {{ name: string, webhook_url?: string }} params
   */
  static signUp(params, { baseUrl = DEFAULT_BASE_URL } = {}) {
    return request(baseUrl, null, 'POST', '/v1/merchants', params)
  }
}

/**
 * Checks a webhook's `zide-signature` header and returns the parsed event.
 * Always pass the raw request body, not re-serialised JSON.
 * @param {string | Buffer} rawBody
 * @param {string | undefined} signatureHeader
 * @param {string} webhookSecret
 */
export function verifyWebhook(rawBody, signatureHeader, webhookSecret) {
  const body = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8')
  const expected = `sha256=${createHmac('sha256', webhookSecret).update(body).digest('hex')}`
  const got = String(signatureHeader ?? '')
  const valid =
    got.length === expected.length && timingSafeEqual(Buffer.from(got), Buffer.from(expected))
  if (!valid) throw new ZideError('Invalid webhook signature', 400)
  return JSON.parse(body)
}
