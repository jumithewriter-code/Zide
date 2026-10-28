// Small stroke icons used across the site. 24×24, inherit currentColor.

type P = { className?: string }
const base = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' } as const

export const ShieldIcon = (p: P) => (
  <svg {...base} {...p} aria-hidden>
    <path d="M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5z" />
  </svg>
)

export const ShieldCheckIcon = (p: P) => (
  <svg {...base} {...p} aria-hidden>
    <path d="M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5z" />
    <path d="m8.5 12 2.5 2.5 4.5-5" />
  </svg>
)

export const UserShieldIcon = (p: P) => (
  <svg {...base} {...p} aria-hidden>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M2.5 20c.6-3.6 3.3-5.5 6.5-5.5 1.2 0 2.3.3 3.2.8" />
    <path d="M18 12.5 14.5 14v2.4c0 2.2 1.5 4 3.5 4.6 2-.6 3.5-2.4 3.5-4.6V14z" />
  </svg>
)

export const LockKeyIcon = (p: P) => (
  <svg {...base} {...p} aria-hidden>
    <rect x="4" y="10" width="16" height="11" rx="2" />
    <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    <circle cx="12" cy="15.5" r="1.5" />
  </svg>
)

export const SlidersIcon = (p: P) => (
  <svg {...base} {...p} aria-hidden>
    <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
    <circle cx="16" cy="7" r="2" />
    <circle cx="10" cy="17" r="2" />
  </svg>
)

export const CheckoutIcon = (p: P) => (
  <svg {...base} {...p} aria-hidden>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="M3 10h18M7 15h4" />
  </svg>
)

export const CashIcon = (p: P) => (
  <svg {...base} {...p} aria-hidden>
    <rect x="2.5" y="6" width="19" height="12" rx="2" />
    <circle cx="12" cy="12" r="2.6" />
    <path d="M6 9.5v5M18 9.5v5" />
  </svg>
)

export const RepeatIcon = (p: P) => (
  <svg {...base} {...p} aria-hidden>
    <path d="M17 2l3 3-3 3" />
    <path d="M4 11V9a4 4 0 0 1 4-4h12" />
    <path d="M7 22l-3-3 3-3" />
    <path d="M20 13v2a4 4 0 0 1-4 4H4" />
  </svg>
)

export const CodeIcon = (p: P) => (
  <svg {...base} {...p} aria-hidden>
    <path d="m8 7-5 5 5 5M16 7l5 5-5 5M14 4l-4 16" />
  </svg>
)

export const EyeOffIcon = (p: P) => (
  <svg {...base} {...p} aria-hidden>
    <path d="M3 3l18 18" />
    <path d="M10.6 5.1A9.7 9.7 0 0 1 12 5c5 0 9 4.5 10 7-.4 1-1.2 2.3-2.4 3.5M6.6 6.6C4.3 8 2.7 10.2 2 12c1 2.5 5 7 10 7 1.7 0 3.3-.5 4.7-1.3" />
    <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
  </svg>
)
