// Order page: shows the order, a "Pay" button, and refreshes until the order is paid.

const usd = (cents) => (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
const id = new URLSearchParams(location.search).get('id')
const box = document.getElementById('order')

async function load() {
  const res = await fetch(`/api/orders/${encodeURIComponent(id ?? '')}`)
  if (!res.ok) {
    box.textContent = 'Order not found.'
    return null
  }
  return res.json()
}

function render(order) {
  const paid = order.status === 'paid'
  box.innerHTML = `
    <p class="muted">Order <code>${order.id}</code></p>
    <h1>${paid ? 'Paid. Thank you!' : 'Almost there'}</h1>
    <span class="status ${paid ? 'paid' : ''}">${paid ? 'Paid' : 'Awaiting payment'}</span>
    <ul class="order-lines"></ul>
    <div class="total"><span>Total</span><span>${usd(order.total_cents)}</span></div>
    ${paid ? '<p>Your order is being prepared. See you soon.</p>' : '<button class="btn btn-accent btn-wide" id="pay">Pay ' + usd(order.total_cents) + '</button><p class="error" id="pay-error" hidden></p>'}
  `
  const list = box.querySelector('.order-lines')
  for (const line of order.items) {
    const li = document.createElement('li')
    li.innerHTML = '<span></span><span></span>'
    li.firstChild.textContent = `${line.qty} × ${line.name}`
    li.lastChild.textContent = usd(line.qty * line.price_cents)
    list.append(li)
  }
  const pay = document.getElementById('pay')
  if (pay) pay.addEventListener('click', () => startPayment(order))
}

// Asks the server for a payment page. Until a gateway is connected, the server marks the order paid.
async function startPayment(order) {
  const btn = document.getElementById('pay')
  const err = document.getElementById('pay-error')
  btn.disabled = true
  err.hidden = true
  try {
    const res = await fetch(`/api/orders/${order.id}/pay`, { method: 'POST' })
    const body = await res.json()
    if (!res.ok) throw new Error(body.error)
    if (body.url) location.href = body.url // your payment page
    else if (body.status === 'paid') render(body) // no gateway yet: marked paid immediately
  } catch (e) {
    err.textContent = e.message
    err.hidden = false
    btn.disabled = false
  }
}

// Render once, then check every 4 s until the order is paid (e.g. after returning from payment).
async function start() {
  const order = await load()
  if (!order) return
  render(order)
  if (order.status === 'paid') return
  const timer = setInterval(async () => {
    const latest = await load()
    if (latest?.status === 'paid') {
      clearInterval(timer)
      render(latest)
    }
  }, 4000)
}

start()
