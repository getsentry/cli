import { ChevronDown, Terminal } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { JsonView } from '@/components/json-view.tsx'
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

type EventEntryProps = {
  item: LocalFeedItem
}

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

function EventEntry({ item }: EventEntryProps) {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <li>
      <details
        className="group rounded-lg border border-border bg-card transition-colors open:bg-muted/25"
        onToggle={(event) => setIsOpen(event.currentTarget.open)}
      >
        <summary
          aria-label={`View ${item.type} event`}
          className="flex cursor-pointer list-none items-center justify-between gap-4 px-4 py-3 outline-none [&::-webkit-details-marker]:hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        >
          <Badge>{item.type}</Badge>
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <time>{formatTimestamp(item.timestamp)}</time>
            <ChevronDown
              className="size-4 transition-transform group-open:rotate-180"
              aria-hidden="true"
            />
          </div>
        </summary>
        {isOpen ? (
          <div className="border-t border-border">
            <JsonView code={item.text} />
          </div>
        ) : null}
      </details>
    </li>
  )
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
      <div className="mx-auto w-full max-w-4xl px-5 py-5 sm:px-8 sm:py-8">
        <header className="flex items-center justify-between gap-4 border-b border-border pb-5">
          <div className="flex items-center" aria-label="Sentry CLI">
            <img className="h-5 w-auto dark:hidden" src="/sentry-cli-light.svg" alt="Sentry CLI" />
            <img className="hidden h-5 w-auto dark:block" src="/sentry-cli.svg" alt="" />
          </div>
          <div className="flex items-center gap-2">
            <span role="status" aria-label={presentation.label} title={presentation.label}>
              <span
                className={
                  presentation.tone === 'success'
                    ? 'block size-2 rounded-full bg-emerald-500 shadow-[0_0_10px_oklch(0.72_0.19_160)]'
                    : presentation.tone === 'warning'
                      ? 'block size-2 rounded-full bg-amber-500'
                      : 'block size-2 rounded-full bg-muted-foreground'
                }
              />
              <span className="sr-only">{presentation.label}</span>
            </span>
            <ThemeToggle />
          </div>
        </header>

        <div className="py-10">
          <section className="min-w-0 space-y-5" aria-label="Local Sentry events">
            <h1 className="text-xl font-semibold tracking-tight">Events</h1>

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

            {items.length === 0 ? (
              <div className="flex min-h-56 flex-col items-center justify-center rounded-lg border border-dashed border-border bg-muted/40 px-6 text-center">
                <Terminal className="mb-3 size-5 text-primary" aria-hidden="true" />
                <p className="font-medium">Waiting for events</p>
              </div>
            ) : (
              <ol className="max-h-[42rem] space-y-2 overflow-y-auto pr-1">
                {items.map((item) => (
                  <EventEntry key={item.id} item={item} />
                ))}
              </ol>
            )}
          </section>
        </div>
      </div>
    </main>
  )
}
