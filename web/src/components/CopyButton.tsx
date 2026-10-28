import { useState } from 'react'

export default function CopyButton({ text, small, label = 'Copy' }: { text: string; small?: boolean; label?: string }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard blocked: the value is still visible to select manually */
    }
  }

  return (
    <button className={`btn btn-ghost${small ? ' btn-sm' : ''}`} onClick={copy} aria-live="polite">
      {copied ? 'Copied' : label}
    </button>
  )
}
