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
  type EventMetadata,
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

function formatDuration(durationMs: number | undefined): string | undefined {
  if (durationMs === undefined) {
    return undefined
  }
  return `${durationMs.toFixed(durationMs < 10 ? 2 : 0)}ms`
}

function getMetadata(item: LocalFeedItem): EventMetadata {
  return item.metadata ?? { title: item.type }
}

function getStatusClass(statusCode: number | undefined): string {
  if (statusCode === undefined) {
    return 'text-muted-foreground'
  }
  if (statusCode >= 500) {
    return 'text-red-500 dark:text-red-400'
  }
  if (statusCode >= 400) {
    return 'text-amber-600 dark:text-amber-400'
  }
  return 'text-emerald-600 dark:text-emerald-400'
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
  const metadata = getMetadata(item)
  const duration = formatDuration(metadata.durationMs)

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
        <div className="min-w-0 space-y-1">
          <div className="flex min-w-0 items-center gap-2">
            <Badge>{metadata.method ?? item.type}</Badge>
            <span className="truncate font-mono text-sm">{metadata.route ?? metadata.title}</span>
          </div>
          <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
            {metadata.statusCode !== undefined ? (
              <span className={getStatusClass(metadata.statusCode)}>{metadata.statusCode}</span>
            ) : null}
            {duration ? <span>{duration}</span> : null}
            {metadata.traceId ? <span className="truncate">{metadata.traceId.slice(0, 8)}</span> : null}
          </div>
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

type DetailField = {
  label: string
  value: string
}

function DetailSection({ title, fields }: { title: string; fields: DetailField[] }) {
  if (fields.length === 0) {
    return null
  }

  return (
    <section>
      <h2 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {title}
      </h2>
      <dl className="border-y border-border text-sm">
        {fields.map((field) => (
          <div key={field.label} className="grid grid-cols-[7rem_minmax(0,1fr)] gap-3 border-b border-border px-3 py-2 last:border-b-0">
            <dt className="text-muted-foreground">{field.label}</dt>
            <dd className="break-all font-mono text-foreground">{field.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

function EventDetail({ item }: EventDetailProps) {
  const [tab, setTab] = useState<'overview' | 'json'>('overview')
  const metadata = getMetadata(item)
  const duration = formatDuration(metadata.durationMs)
  const eventFields: DetailField[] = [
    { label: 'Transaction', value: metadata.title },
    { label: 'Received', value: formatTimestamp(item.timestamp) },
  ]
  const requestFields: DetailField[] = [
    ...(metadata.method ? [{ label: 'Method', value: metadata.method }] : []),
    ...(metadata.route ? [{ label: 'Route', value: metadata.route }] : []),
    ...(metadata.statusCode !== undefined
      ? [{ label: 'Status', value: String(metadata.statusCode) }]
      : []),
    ...(duration ? [{ label: 'Duration', value: duration }] : []),
  ]
  const traceFields: DetailField[] = [
    ...(metadata.traceId ? [{ label: 'Trace ID', value: metadata.traceId }] : []),
    ...(metadata.spanId ? [{ label: 'Span ID', value: metadata.spanId }] : []),
    ...(metadata.operation ? [{ label: 'Operation', value: metadata.operation }] : []),
    ...(metadata.origin ? [{ label: 'Origin', value: metadata.origin }] : []),
  ]

  return (
    <section
      data-testid="event-detail"
      aria-label="Event detail"
      className="flex min-h-0 min-w-0 flex-1 flex-col"
    >
      <div className="flex h-11 shrink-0 items-center justify-between gap-3 border-b border-border px-3">
        <div className="flex min-w-0 items-center gap-2">
          <Badge>{metadata.method ?? item.type}</Badge>
          <span className="truncate font-mono text-sm">{metadata.route ?? metadata.title}</span>
        </div>
        <div className="flex h-full shrink-0 items-center gap-3">
          <div role="tablist" aria-label="Event detail view" className="flex h-full">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'overview'}
              className={`px-2 text-sm ${tab === 'overview' ? 'border-b-2 border-primary text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              onClick={() => setTab('overview')}
            >
              Overview
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'json'}
              className={`px-2 text-sm ${tab === 'json' ? 'border-b-2 border-primary text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              onClick={() => setTab('json')}
            >
              JSON
            </button>
          </div>
          <time className="text-sm text-muted-foreground">{formatTimestamp(item.timestamp)}</time>
        </div>
      </div>
      {tab === 'overview' ? (
        <div className="min-h-0 flex-1 overflow-auto p-4">
          <div className="grid gap-6 xl:grid-cols-2">
            <DetailSection title="Event" fields={eventFields} />
            <DetailSection title="Request" fields={requestFields} />
            <div className="xl:col-span-2">
              <DetailSection title="Trace" fields={traceFields} />
            </div>
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <JsonView code={item.text} />
        </div>
      )}
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
      <div
        data-testid="app-shell"
        className="mx-auto flex h-full w-full max-w-none flex-col"
      >
        <header className="flex h-11 shrink-0 items-center justify-between gap-3 px-3 sm:px-4">
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

        <div className="flex min-h-0 flex-1 flex-col">
          <section className="flex min-h-0 flex-1 flex-col" aria-label="Local Sentry events">

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
                {selectedItem ? <EventDetail key={selectedItem.id} item={selectedItem} /> : null}
              </div>
            )}
          </section>
        </div>
      </div>
    </main>
  )
}
