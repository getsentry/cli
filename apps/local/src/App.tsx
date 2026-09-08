import { Terminal } from 'lucide-react'
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
  isSelected: boolean
  onSelect: (id: string) => void
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

function EventEntry({ item, isSelected, onSelect }: EventEntryProps) {
  return (
    <li>
      <button
        type="button"
        aria-label={`View ${item.type} event`}
        aria-current={isSelected ? 'true' : undefined}
        className={`flex w-full cursor-pointer items-center justify-between gap-3 px-2 py-2 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset ${
          isSelected ? 'bg-muted text-foreground' : 'hover:bg-muted/60'
        }`}
        onClick={() => onSelect(item.id)}
      >
        <div className="min-w-0">
          <Badge>{item.type}</Badge>
        </div>
        <time className="shrink-0 text-sm text-muted-foreground">
          {formatTimestamp(item.timestamp)}
        </time>
      </button>
    </li>
  )
}

type EventDetailProps = {
  item: LocalFeedItem
}

function EventDetail({ item }: EventDetailProps) {
  return (
    <section data-testid="event-detail" className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex h-11 shrink-0 items-center justify-between gap-3 border-b border-border px-3">
        <Badge>{item.type}</Badge>
        <time className="text-sm text-muted-foreground">{formatTimestamp(item.timestamp)}</time>
      </header>
      <div className="min-h-0 flex-1 overflow-auto">
        <JsonView code={item.text} />
      </div>
    </section>
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
  const [selectedItemId, setSelectedItemId] = useState<string>()
  const [message, setMessage] = useState<string | undefined>()
  const fallbackEventId = useRef(0)
  const presentation = getConnectionPresentation(connection)
  const selectedItem = items.find((item) => item.id === selectedItemId) ?? items[0]

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
    <main className="h-dvh overflow-hidden bg-background">
      <div className="mx-auto flex h-full w-full max-w-none flex-col px-3 py-3 sm:px-4 sm:py-4">
        <header className="flex h-11 shrink-0 items-center justify-between gap-3 border-b border-border">
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

        <div className="flex min-h-0 flex-1 flex-col py-3">
          <section className="flex min-h-0 flex-1 flex-col gap-3" aria-label="Local Sentry events">

            {connection === 'missing' ? (
              <Card className="shrink-0">
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
              <div className="shrink-0 rounded-lg border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-200">
                {message}
              </div>
            ) : null}

            {items.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center border border-dashed border-border bg-muted/40 px-4 text-center">
                <Terminal className="mb-3 size-5 text-primary" aria-hidden="true" />
                <p className="font-medium">Waiting for events</p>
              </div>
            ) : (
              <div className="flex min-h-0 flex-1 overflow-hidden bg-card">
                <aside
                  aria-labelledby="event-list-heading"
                  className="flex min-h-0 w-80 shrink-0 flex-col border-r border-border bg-muted/30"
                >
                  <div className="flex h-11 shrink-0 items-center border-b border-border px-3">
                    <h1 id="event-list-heading" className="text-sm font-semibold">Events</h1>
                  </div>
                  <ol
                    data-testid="event-list"
                    className="min-h-0 flex-1 space-y-px overflow-y-auto p-1"
                  >
                    {items.map((item) => (
                      <EventEntry
                        key={item.id}
                        item={item}
                        isSelected={item.id === selectedItem?.id}
                        onSelect={setSelectedItemId}
                      />
                    ))}
                  </ol>
                </aside>
                {selectedItem ? <EventDetail item={selectedItem} /> : null}
              </div>
            )}
          </section>
        </div>
      </div>
    </main>
  )
}
