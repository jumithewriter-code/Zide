import { useEffect, useState } from 'react'
import Logo from './components/Logo'
import Dashboard from './pages/Dashboard'
import Docs from './pages/Docs'
import Landing from './pages/Landing'
import LpDashboard from './pages/LpDashboard'
import Pay from './pages/Pay'
import TxProof from './pages/TxProof'

// Hash routes keep the app a static bundle:
// #/  #/docs  #/dashboard  #/pay/<session>  #/lp  #/tx/<txid>
function useHashRoute(): string[] {
  const parse = () => window.location.hash.replace(/^#\/?/, '').split('/').filter(Boolean)
  const [parts, setParts] = useState(parse)
  useEffect(() => {
    const onChange = () => {
      setParts(parse())
      window.scrollTo(0, 0)
    }
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return parts
}

export default function App() {
  const [page, arg] = useHashRoute()

  const on = (name: string) => (page === name ? 'on' : '')

  // The hosted payment page is shown to merchants' customers, so it has its own minimal chrome.
  if (page === 'pay' && arg) return <Pay key={arg} sessionId={arg} />

  return (
    <div className="shell">
      <header className="topbar">
        <div className="topbar-in">
          <a href="#/" className="brand" aria-label="Zide home">
            <Logo />
          </a>
          <nav className="topnav">
            <a href="#/docs" className={on('docs')} aria-current={page === 'docs' ? 'page' : undefined}>Docs</a>
            <a href="#/tx" className={on('tx')} aria-current={page === 'tx' ? 'page' : undefined}>Payment proof</a>
            <a href="#/lp" className={on('lp')} aria-current={page === 'lp' ? 'page' : undefined}>LP sign up / in</a>
            <a href="#/dashboard" className={on('dashboard')} aria-current={page === 'dashboard' ? 'page' : undefined}>Merchant sign up / in</a>
            <span className="badge">Testnet</span>
          </nav>
        </div>
      </header>
      <main>
        {page === 'docs' ? (
          <Docs />
        ) : page === 'dashboard' ? (
          <Dashboard />
        ) : page === 'lp' ? (
          <LpDashboard />
        ) : page === 'tx' ? (
          <TxProof key={arg ?? ''} txid={arg} />
        ) : (
          <Landing />
        )}
      </main>
      <footer className="footer">
        <div className="footer-in">
          <Logo size={18} />
          <span>Privacy-first payment gateway · Settles through shielded Zcash</span>
          <a href="#/lp" className="footer-link">For liquidity providers</a>
        </div>
      </footer>
    </div>
  )
}
