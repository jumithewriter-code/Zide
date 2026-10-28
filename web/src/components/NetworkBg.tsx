// Decorative node-and-line mesh for the hero, generated once from a fixed seed so it is stable.

function mulberry32(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const W = 1200
const H = 700
const rand = mulberry32(7)
const NODES = Array.from({ length: 46 }, () => ({ x: rand() * W, y: rand() * H, r: 1 + rand() * 2.2 }))
const EDGES: [number, number][] = []
NODES.forEach((a, i) => {
  NODES.forEach((b, j) => {
    if (j > i && Math.hypot(a.x - b.x, a.y - b.y) < 190) EDGES.push([i, j])
  })
})

export default function NetworkBg() {
  return (
    <svg className="netbg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" aria-hidden>
      <defs>
        <radialGradient id="net-fade" cx="50%" cy="45%" r="60%">
          <stop offset="0" stopColor="#000" stopOpacity="0.85" />
          <stop offset="0.55" stopColor="#000" stopOpacity="0.35" />
          <stop offset="1" stopColor="#000" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="net-line" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#2fd8b9" stopOpacity="0.15" />
          <stop offset="1" stopColor="#2fd8b9" stopOpacity="0.45" />
        </linearGradient>
      </defs>
      <g stroke="url(#net-line)" strokeWidth="0.8">
        {EDGES.map(([i, j]) => (
          <line key={`${i}-${j}`} x1={NODES[i].x} y1={NODES[i].y} x2={NODES[j].x} y2={NODES[j].y} />
        ))}
      </g>
      <g fill="#5cf0d4">
        {NODES.map((n, i) => (
          <circle key={i} cx={n.x} cy={n.y} r={n.r} opacity={0.35 + (i % 5) * 0.12} />
        ))}
      </g>
      {/* darken the centre so the headline stays readable */}
      <rect width={W} height={H} fill="url(#net-fade)" />
    </svg>
  )
}
