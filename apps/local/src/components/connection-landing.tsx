import { Check, ChevronDown, Copy, Radio } from 'lucide-react'
import { type FormEvent, useState } from 'react'

export type ConnectionLandingProps = {
  endpoint: string
  error?: string
  phase: 'probing' | 'failed' | 'editing'
  onConnect: () => void
  onCopyCommand: () => void
  onEndpointChange: (value: string) => void
}

/** A compact, explicit receiver picker for bare Local viewer visits. */
export function ConnectionLanding({
  endpoint,
  error,
  phase,
  onConnect,
  onCopyCommand,
  onEndpointChange,
}: ConnectionLandingProps) {
  const [copied, setCopied] = useState(false)
  const isProbing = phase === 'probing'

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    onConnect()
  }

  return (
    <section aria-labelledby="connection-title" className="flex min-h-0 flex-1 items-center justify-center bg-muted/10 px-4 py-8 sm:p-8">
      <div className="w-full max-w-xl border border-border bg-card p-5 shadow-sm sm:p-6">
        <div className="flex items-start gap-3">
          <Radio className={`mt-0.5 size-5 ${isProbing ? 'animate-pulse text-primary' : 'text-muted-foreground'}`} aria-hidden="true" />
          <div>
            <p className="text-xs font-semibold tracking-wide text-primary uppercase">Sentry Local</p>
            <h2 id="connection-title" className="mt-1 text-xl font-semibold">
              {isProbing ? 'Looking for Sentry Local' : 'Connect a receiver'}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {isProbing
                ? 'Checking the default receiver on localhost:8969.'
                : 'Connect this read-only viewer to an event stream.'}
            </p>
          </div>
        </div>

        {error ? <p role="alert" aria-label="Receiver connection error" className="mt-5 border-l-2 border-amber-500 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-200">{error}</p> : null}

        <form className="mt-5" onSubmit={submit}>
          <label htmlFor="receiver-endpoint" className="text-sm font-medium">Receiver endpoint</label>
          <div className="mt-2 flex gap-2">
            <input
              id="receiver-endpoint"
              type="url"
              value={endpoint}
              onChange={(event) => onEndpointChange(event.target.value)}
              className="h-9 min-w-0 flex-1 border border-border bg-background px-3 font-mono text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
            <button type="submit" className="h-9 shrink-0 bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              Connect
            </button>
          </div>
        </form>

        <details className="mt-5 border-t border-border pt-4">
          <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-medium">
            <ChevronDown className="size-4" aria-hidden="true" />
            Advanced connection
          </summary>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            Loopback streams are remembered. Remote streams must use HTTPS, need CORS access for this viewer, and are kept only for this browser session.
          </p>
        </details>

        <div className="mt-5 flex items-center justify-between gap-3 border-t border-border pt-4">
          <code className="min-w-0 truncate font-mono text-xs text-muted-foreground">sentry local serve --open</code>
          <button
            type="button"
            aria-label="Copy local serve command"
            className="inline-flex shrink-0 items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => {
              onCopyCommand()
              setCopied(true)
            }}
          >
            {copied ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
            {copied ? 'Copied' : 'Copy command'}
          </button>
        </div>
      </div>
    </section>
  )
}
