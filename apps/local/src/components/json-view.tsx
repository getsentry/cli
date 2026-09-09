import { createHighlighterCore } from '@shikijs/core'
import { createJavaScriptRegexEngine } from '@shikijs/engine-javascript'
import json from '@shikijs/langs/json'
import githubDark from '@shikijs/themes/github-dark'
import githubLight from '@shikijs/themes/github-light'
import { Check, Copy } from 'lucide-react'
import { useEffect, useState } from 'react'
import { copyText } from '@/lib/clipboard.ts'

type JsonViewProps = {
  code: string
}

const highlighter = createHighlighterCore({
  engine: createJavaScriptRegexEngine(),
  langs: [json],
  themes: [githubLight, githubDark],
})

/** Render JSON with Shiki only after its containing event has been expanded. */
export function JsonView({ code }: JsonViewProps) {
  const [html, setHtml] = useState<string>()
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let disposed = false

    void highlighter
      .then((instance) =>
        instance.codeToHtml(code, {
          lang: 'json',
          themes: {
            light: 'github-light',
            dark: 'github-dark',
          },
          defaultColor: false,
        })
      )
      .then((result) => {
        if (!disposed) {
          setHtml(result)
        }
      })
      .catch(() => {
        // Keep the readable, escaped source fallback if syntax highlighting cannot load.
      })

    return () => {
      disposed = true
    }
  }, [code])

  const copyJson = () => {
    copyText(code)
    setCopied(true)
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
        <pre data-testid="highlighted-json" className="json-view overflow-x-auto p-3 pr-28 text-xs leading-6">
          {code}
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
        className="json-view overflow-x-auto p-3 pr-28 text-xs leading-6"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  )
}
