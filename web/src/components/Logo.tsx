// The Zide mark: a shield whose negative space forms a Z, crossed by a teal band.
// Vector redraw of the brand logo (web/public/brand/zide-logo.png).

export const BRAND_NAVY = '#1f3a5f'
export const BRAND_TEAL = '#19c9b1'

const SHIELD = 'M4 7 L26 2 L60 6 L60 50 L32 69 L4 56 Z'

export function ZideMark({ size = 28, title }: { size?: number; title?: string }) {
  const id = 'zide-shield-clip'
  return (
    <svg width={size} height={size * (72 / 64)} viewBox="0 0 64 72" role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      <defs>
        <clipPath id={id}>
          <path d={SHIELD} />
        </clipPath>
      </defs>
      <path d={SHIELD} fill={BRAND_NAVY} />
      <g clipPath={`url(#${id})`}>
        {/* Z counters (the white gaps) */}
        <path d="M4 22 L26 22 L4 44 Z" fill="#fff" />
        <path d="M60 24 L60 46 L38 46 Z" fill="#fff" />
        {/* Teal band between the counters */}
        <path d="M0 48 L48 0 L84 0 L0 84 Z" fill={BRAND_TEAL} />
      </g>
    </svg>
  )
}

/** Mark + wordmark on a white chip, as in the brand site's nav. */
export default function Logo({ size = 24 }: { size?: number }) {
  return (
    <span className="logo-chip">
      <ZideMark size={size} />
      <span className="logo-word">zide</span>
    </span>
  )
}
