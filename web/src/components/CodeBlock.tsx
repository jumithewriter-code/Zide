import CopyButton from './CopyButton'

export default function CodeBlock({ code, lang }: { code: string; lang?: string }) {
  return (
    <div className="code">
      <div className="code-bar">
        <span>{lang}</span>
        <CopyButton text={code} small />
      </div>
      <pre>
        <code>{code}</code>
      </pre>
    </div>
  )
}
