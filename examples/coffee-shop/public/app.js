// Menu + cart. The cart lives in the browser; the server prices the order on checkout.

const usd = (cents) => (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
const cart = new Map() // itemId -> qty
let menu = []

const $ = (id) => document.getElementById(id)

async function loadMenu() {
  const res = await fetch('/api/menu')
  menu = (await res.json()).menu
  const byCategory = Map.groupBy ? Map.groupBy(menu, (m) => m.category) : group(menu)
  $('menu').innerHTML = ''
  for (const [category, items] of byCategory) {
    const h = document.createElement('h2')
    h.className = 'category'
    h.textContent = category
    const grid = document.createElement('div')
    grid.className = 'menu'
    for (const item of items) {
      const card = document.createElement('article')
      card.className = 'item'
      card.innerHTML = `<h3></h3><p></p><div class="item-foot"><span class="price"></span><button class="btn">Add</button></div>`
      card.querySelector('h3').textContent = item.name
      card.querySelector('p').textContent = item.desc
      card.querySelector('.price').textContent = usd(item.price_cents)
      card.querySelector('button').addEventListener('click', () => change(item.id, 1))
      grid.append(card)
    }
    $('menu').append(h, grid)
  }
}

function group(items) {
  const m = new Map()
  for (const i of items) m.set(i.category, [...(m.get(i.category) ?? []), i])
  return m
}

function change(id, delta) {
  const qty = (cart.get(id) ?? 0) + delta
  if (qty <= 0) cart.delete(id)
  else cart.set(id, Math.min(qty, 20))
  renderCart()
}

function renderCart() {
  const lines = $('cart-lines')
  lines.innerHTML = ''
  let total = 0
  for (const [id, qty] of cart) {
    const item = menu.find((m) => m.id === id)
    total += item.price_cents * qty
    const li = document.createElement('li')
    li.className = 'cart-line'
    li.innerHTML = `<span class="name"></span><span>${usd(item.price_cents * qty)}</span>
      <span class="qty"><button aria-label="Remove one">−</button><span>${qty}</span><button aria-label="Add one">+</button></span>`
    li.querySelector('.name').textContent = item.name
    const [minus, plus] = li.querySelectorAll('button')
    minus.addEventListener('click', () => change(id, -1))
    plus.addEventListener('click', () => change(id, 1))
    lines.append(li)
  }
  $('cart-total').textContent = usd(total)
  $('cart-empty').hidden = cart.size > 0
  $('checkout').disabled = cart.size === 0
}

$('checkout').addEventListener('click', async () => {
  $('cart-error').hidden = true
  $('checkout').disabled = true
  try {
    const res = await fetch('/api/orders', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ items: [...cart].map(([id, qty]) => ({ id, qty })) }),
    })
    const body = await res.json()
    if (!res.ok) throw new Error(body.error)
    location.href = `/order.html?id=${body.id}`
  } catch (e) {
    $('cart-error').textContent = e.message
    $('cart-error').hidden = false
    $('checkout').disabled = false
  }
})

loadMenu().catch(() => ($('menu').textContent = 'Could not load the menu.'))
