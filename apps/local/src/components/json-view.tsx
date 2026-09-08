import { createHighlighterCore } from '@shikijs/core'
import { createJavaScriptRegexEngine } from '@shikijs/engine-javascript'
import json from '@shikijs/langs/json'
import githubDark from '@shikijs/themes/github-dark'
import githubLight from '@shikijs/themes/github-light'
import { useEffect, useState } from 'react'

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

  if (!html) {
    return (
      <pre data-testid="highlighted-json" className="json-view overflow-x-auto p-3 text-xs leading-6">
        {code}
      </pre>
    )
  }

  return (
    <div
      data-testid="highlighted-json"
      className="json-view overflow-x-auto p-3 text-xs leading-6"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
