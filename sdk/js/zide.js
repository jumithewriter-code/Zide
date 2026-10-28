/*!
 * zide.js — drop-in "Pay privately" button for the Zide shielded payment gateway.
 *
 *   <script src="https://YOUR-ZIDE-API/zide.js" defer></script>
 *   <button data-zide-checkout="/api/checkout" data-zide-body='{"plan":"monthly"}'>Pay privately</button>
 *
 * On click it POSTs the JSON body to YOUR server endpoint, which creates a Checkout Session with
 * its secret key and returns { url }. The browser is then sent to Zide's hosted payment page.
 * Your secret key never touches the browser.
 */
;(function () {
  if (window.Zide) return

  var STYLE =
    '.zide-button{display:inline-flex;align-items:center;gap:10px;border:0;border-radius:999px;' +
    'padding:12px 22px;font:600 15px/1 system-ui,-apple-system,"Segoe UI",sans-serif;cursor:pointer;' +
    'color:#04222a;background:linear-gradient(135deg,#46dbd6,#3b9bdc);box-shadow:0 6px 22px rgba(63,211,216,.3)}' +
    '.zide-button:hover{filter:brightness(1.07)}.zide-button[disabled]{opacity:.6;cursor:wait}' +
    '.zide-button svg{width:18px;height:18px}'
  var ICON =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 1 3 5v6c0 5.5 3.8 10.7 9 12 5.2-1.3 9-6.5 9-12V5z"/></svg>'

  function checkout(endpoint, body) {
    return fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body || {}),
    })
      .then(function (r) {
        return r.json().then(function (data) {
          if (!r.ok || !data.url) throw new Error(data.error || 'Could not start checkout')
          window.location.assign(data.url)
        })
      })
  }

  function mount(root) {
    var buttons = (root || document).querySelectorAll('[data-zide-checkout]:not([data-zide-ready])')
    Array.prototype.forEach.call(buttons, function (btn) {
      btn.setAttribute('data-zide-ready', '')
      btn.classList.add('zide-button')
      if (!btn.querySelector('svg')) btn.insertAdjacentHTML('afterbegin', ICON)
      btn.addEventListener('click', function (e) {
        e.preventDefault()
        var body = {}
        try {
          body = JSON.parse(btn.getAttribute('data-zide-body') || '{}')
        } catch (_) {}
        btn.disabled = true
        checkout(btn.getAttribute('data-zide-checkout'), body).catch(function (err) {
          btn.disabled = false
          alert(err.message)
        })
      })
    })
  }

  var style = document.createElement('style')
  style.textContent = STYLE
  document.head.appendChild(style)

  window.Zide = { checkout: checkout, mount: mount }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { mount() })
  else mount()
})()
