import { Eye, Radio, ShieldCheck, Terminal } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { ThemeToggle } from '@/components/theme-toggle.tsx'
import { Badge } from '@/components/ui/badge.tsx'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card.tsx'
import {
  getConnectionPresentation,
  type ConnectionState,
} from '@/lib/presentation.ts'
import {
  appendBounded,
  decodeEnvelope,
  getPreferredStreamUrl,
  getStreamUrlFromHash,
  SENTRY_ENVELOPE_EVENT,
  STREAM_STORAGE_KEY,
  type LocalFeedItem,
} from '@/lib/spotlight.ts'

function formatTimestamp(timestamp: LocalFeedItem['timestamp']): string {
  if (timestamp === undefined) {
    return 'unknown time'
  }
  const milliseconds =
    typeof timestamp === 'number' && timestamp < 1_000_000_000_000
      ? timestamp * 1_000
      : timestamp
  const date = new Date(milliseconds)
  return Number.isNaN(date.getTime()) ? String(timestamp) : date.toLocaleTimeString()
}

function getSavedStream(): string | null {
  try {
    return window.localStorage.getItem(STREAM_STORAGE_KEY)
  } catch {
    return null
  }
}

function saveStreamUrl(streamUrl: string): void {
  try {
    window.localStorage.setItem(STREAM_STORAGE_KEY, streamUrl)
  } catch {
    // Private browsing or browser policy can disable storage; the current tab still works.
  }
}

export default function App() {
  const [streamUrl] = useState(() =>
    getPreferredStreamUrl(window.location.hash, getSavedStream())
  )
  const [connection, setConnection] = useState<ConnectionState>(
    streamUrl ? 'connecting' : 'missing'
  )
  const [items, setItems] = useState<LocalFeedItem[]>([])
  const [message, setMessage] = useState<string | undefined>()
  const fallbackEventId = useRef(0)
  const presentation = getConnectionPresentation(connection)
  const badgeVariant = presentation.tone === 'neutral' ? 'default' : presentation.tone

  useEffect(() => {
    const fragmentStreamUrl = getStreamUrlFromHash(window.location.hash)
    if (fragmentStreamUrl) {
      saveStreamUrl(fragmentStreamUrl)
    }
    if (window.location.hash) {
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`)
    }
  }, [])

  useEffect(() => {
    if (!streamUrl) {
      return
    }

    const source = new EventSource(streamUrl)
    const onEnvelope = (event: Event) => {
      try {
        const messageEvent = event as MessageEvent<string>
        const eventId = messageEvent.lastEventId || `event-${fallbackEventId.current++}`
        const decoded = decodeEnvelope(messageEvent.data, eventId)
        setItems((current) => appendBounded(current, decoded))
        setMessage(undefined)
      } catch {
        setMessage('Received an event that could not be decoded.')
      }
    }

    source.addEventListener(SENTRY_ENVELOPE_EVENT, onEnvelope)
    source.onopen = () => {
      setConnection('connected')
      setMessage(undefined)
    }
    source.onerror = () => {
      setConnection('reconnecting')
      setMessage('Could not reach the local receiver. Retrying…')
    }

    return () => {
      source.removeEventListener(SENTRY_ENVELOPE_EVENT, onEnvelope)
      source.close()
    }
  }, [streamUrl])

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto w-full max-w-6xl px-5 py-5 sm:px-8 sm:py-8">
        <header className="flex items-center justify-between gap-4 border-b border-border pb-5">
          <div className="flex items-center" aria-label="Sentry CLI">
            <img className="h-5 w-auto dark:hidden" src="/sentry-cli-light.svg" alt="Sentry CLI" />
            <img className="hidden h-5 w-auto dark:block" src="/sentry-cli.svg" alt="" />
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={badgeVariant} role="status">
              <span
                className={
                  presentation.tone === 'success'
                    ? 'size-1.5 rounded-full bg-emerald-500'
                    : presentation.tone === 'warning'
                      ? 'size-1.5 rounded-full bg-amber-500'
                      : 'size-1.5 rounded-full bg-muted-foreground'
                }
                aria-hidden="true"
              />
              {presentation.label}
            </Badge>
            <ThemeToggle />
          </div>
        </header>

        <div className="grid gap-5 py-8 lg:grid-cols-[minmax(0,1fr)_15rem]">
          <div className="min-w-0 space-y-5">
            <section className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
              <div>
                <p className="mb-2 text-sm font-medium text-primary">Live local telemetry</p>
                <h1 className="text-3xl font-semibold tracking-tight">Event stream</h1>
                <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
                  A read-only view of envelopes received by Sentry Local on this machine.
                </p>
              </div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Radio className="size-4 text-primary" aria-hidden="true" />
                <span>{items.length} of 500 retained</span>
              </div>
            </section>

            {connection === 'missing' ? (
              <Card>
                <CardHeader>
                  <CardTitle>Connect a local receiver</CardTitle>
                  <CardDescription>
                    Start the receiver from your project, then this page will receive its stream.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <code className="block overflow-x-auto rounded-md border border-border bg-muted px-3 py-2 text-sm text-foreground">
                    sentry local serve --open
                  </code>
                </CardContent>
              </Card>
            ) : null}

            {message ? (
              <div className="rounded-lg border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-200">
                {message}
              </div>
            ) : null}

            <Card aria-label="Local Sentry events">
              <CardHeader className="flex-row items-center justify-between gap-4">
                <div>
                  <CardTitle>Incoming events</CardTitle>
                  <CardDescription>Transactions, errors, logs, and other envelope items.</CardDescription>
                </div>
                <Eye className="size-5 text-muted-foreground" aria-hidden="true" />
              </CardHeader>
              <CardContent>
                {items.length === 0 ? (
                  <div className="flex min-h-56 flex-col items-center justify-center rounded-lg border border-dashed border-border bg-muted/40 px-6 text-center">
                    <Terminal className="mb-3 size-5 text-primary" aria-hidden="true" />
                    <p className="font-medium">Waiting for local telemetry</p>
                    <p className="mt-1 max-w-sm text-sm leading-6 text-muted-foreground">
                      Send a trace, error, or log from your app and it will appear here.
                    </p>
                  </div>
                ) : (
                  <ol className="max-h-[36rem] space-y-3 overflow-y-auto pr-1">
                    {items.map((item) => (
                      <li key={item.id} className="rounded-lg border border-border bg-muted/25 p-4">
                        <div className="mb-3 flex items-center justify-between gap-4 text-sm">
                          <Badge>{item.type}</Badge>
                          <time className="shrink-0 text-muted-foreground">
                            {formatTimestamp(item.timestamp)}
                          </time>
                        </div>
                        <pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono text-xs leading-5 text-foreground/85">
                          {item.text}
                        </pre>
                      </li>
                    ))}
                  </ol>
                )}
              </CardContent>
            </Card>
          </div>

          <aside className="space-y-3 lg:pt-16">
            <div className="rounded-xl border border-border bg-muted/35 p-4">
              <ShieldCheck className="mb-3 size-5 text-primary" aria-hidden="true" />
              <p className="text-sm font-medium">Local by design</p>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                This viewer only reads the stream selected by the CLI. It does not send telemetry.
              </p>
            </div>
          </aside>
        </div>
      </div>
    </main>
  )
}
