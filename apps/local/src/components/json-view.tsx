import { language } from '@twinkleplop/json'
import { Check, Copy } from 'lucide-react'
import { useCopyToClipboard } from '@uidotdev/usehooks'

type JsonViewProps = {
  code: string
}

const highlight = language()

function formatJson(code: string) {
  try {
    return JSON.stringify(JSON.parse(code), null, 2)
  } catch {
    return code
  }
}

function highlightJson(code: string) {
  try {
    return highlight(code)
  } catch {
    return undefined
  }
}

/** Render JSON with Twinkleplop once its containing event has been expanded. */
export function JsonView({ code }: JsonViewProps) {
  const [copiedText, copyToClipboard] = useCopyToClipboard()
  const formattedCode = formatJson(code)
  const html = highlightJson(formattedCode)
  const copied = copiedText === code

  const copyJson = () => {
    void copyToClipboard(code)
  }

  const copyButton = (
    <button
      type="button"
      aria-label="Copy JSON"
      className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background/90 px-2 py-1 text-xs font-medium text-muted-foreground shadow-xs backdrop-blur transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onClick={copyJson}
    >
      {copied ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
      {copied ? 'Copied' : 'Copy JSON'}
    </button>
  )

  if (!html) {
    return (
      <div className="relative">
        <div className="absolute top-2 right-3 z-10">{copyButton}</div>
        {copied ? <span role="status" aria-label="JSON copied" className="sr-only">JSON copied</span> : null}
        <pre data-testid="highlighted-json" className="json-view whitespace-pre-wrap break-words p-3 pr-28 text-xs leading-6">
          {formattedCode}
        </pre>
      </div>
    )
  }

  return (
    <div className="relative">
      <div className="absolute top-2 right-3 z-10">{copyButton}</div>
      {copied ? <span role="status" aria-label="JSON copied" className="sr-only">JSON copied</span> : null}
      <div
        data-testid="highlighted-json"
        className="json-view whitespace-pre-wrap break-words p-3 pr-28 text-xs leading-6"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  )
}
