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

/** A string token immediately followed by `:` is an object key. */
function highlightJson(code: string) {
  return highlight(code, {
    class_name: 'json-view-code',
    has_classes: true,
    token: (type, _start, end) => {
      if (type === 'string' && code[end] === ':') {
        return { class: 'tok-key' }
      }
    },
  })
}

/** Render JSON with Twinkleplop after its containing event has been expanded. */
export function JsonView({ code }: JsonViewProps) {
  const [copiedText, copyToClipboard] = useCopyToClipboard()
  const formattedCode = formatJson(code)
  const html = highlightJson(formattedCode)
  const copied = copiedText === code

  const copyJson = () => {
    void copyToClipboard(code)
  }

  return (
    <div className="relative">
      <div className="absolute top-2 right-3 z-10">
        <button
          type="button"
          aria-label="Copy JSON"
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background/90 px-2 py-1 text-xs font-medium text-muted-foreground shadow-xs backdrop-blur transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={copyJson}
        >
          {copied ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
          {copied ? 'Copied' : 'Copy JSON'}
        </button>
      </div>
      {copied ? <span role="status" aria-label="JSON copied" className="sr-only">JSON copied</span> : null}
      <div
        data-testid="highlighted-json"
        className="json-view whitespace-pre-wrap break-words p-3 pr-28 text-xs leading-6"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  )
}
