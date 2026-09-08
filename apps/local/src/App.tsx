import { Terminal } from 'lucide-react'
import { type KeyboardEvent, useEffect, useRef, useState } from 'react'
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

type EventFilter = 'all' | 'errors' | 'transactions' | 'logs'

const eventFilters: { id: EventFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'errors', label: 'Errors' },
  { id: 'transactions', label: 'Transactions' },
  { id: 'logs', label: 'Logs' },
]

function matchesEventFilter(item: LocalFeedItem, filter: EventFilter): boolean {
  if (filter === 'all') {
    return true
  }

  if (filter === 'errors') {
    const { level, statusCode } = getMetadata(item)
    return level === 'error' || level === 'fatal' || (statusCode !== undefined && statusCode >= 500)
  }

  return item.type === (filter === 'transactions' ? 'transaction' : 'log')
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
  relatedItems: LocalFeedItem[]
  onSelect: (id: string) => void
}

type DetailTab = 'overview' | 'json'

const detailTabs: DetailTab[] = ['overview', 'json']

type DetailField = {
  label: string
  value: string
}

function SummaryMetric({ label, value, tone }: DetailField & { tone?: string }) {
  return (
    <div className="min-w-0 px-3 py-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={`mt-1 truncate font-mono text-sm ${tone ?? 'text-foreground'}`}>{value}</dd>
    </div>
  )
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

function EventDetail({ item, relatedItems, onSelect }: EventDetailProps) {
  const [tab, setTab] = useState<DetailTab>('overview')
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
  const summaryFields = [
    ...(metadata.statusCode !== undefined
      ? [
          {
            label: 'Status',
            value: String(metadata.statusCode),
            tone: getStatusClass(metadata.statusCode),
          },
        ]
      : []),
    ...(duration ? [{ label: 'Duration', value: duration }] : []),
    ...(metadata.operation ? [{ label: 'Operation', value: metadata.operation }] : []),
    ...(metadata.traceId
      ? [{ label: 'Trace', value: metadata.traceId.slice(0, 8) }]
      : []),
  ]

  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const currentIndex = detailTabs.indexOf(tab)
    const nextIndex =
      event.key === 'ArrowRight'
        ? (currentIndex + 1) % detailTabs.length
        : event.key === 'ArrowLeft'
          ? (currentIndex - 1 + detailTabs.length) % detailTabs.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? detailTabs.length - 1
              : undefined

    if (nextIndex === undefined) {
      return
    }

    event.preventDefault()
    const nextTab = detailTabs[nextIndex]!
    setTab(nextTab)
    requestAnimationFrame(() => {
      document.getElementById(`event-detail-tab-${nextTab}`)?.focus()
    })
  }

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
              id="event-detail-tab-overview"
              type="button"
              role="tab"
              aria-selected={tab === 'overview'}
              aria-controls="event-detail-panel"
              tabIndex={tab === 'overview' ? 0 : -1}
              className={`px-2 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset ${tab === 'overview' ? 'border-b-2 border-primary text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              onClick={() => setTab('overview')}
              onKeyDown={handleTabKeyDown}
            >
              Overview
            </button>
            <button
              id="event-detail-tab-json"
              type="button"
              role="tab"
              aria-selected={tab === 'json'}
              aria-controls="event-detail-panel"
              tabIndex={tab === 'json' ? 0 : -1}
              className={`px-2 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset ${tab === 'json' ? 'border-b-2 border-primary text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              onClick={() => setTab('json')}
              onKeyDown={handleTabKeyDown}
            >
              JSON
            </button>
          </div>
          <time className="text-sm text-muted-foreground">{formatTimestamp(item.timestamp)}</time>
        </div>
      </div>
      {tab === 'overview' ? (
        <div id="event-detail-panel" role="tabpanel" className="min-h-0 flex-1 overflow-auto p-4">
          {summaryFields.length > 0 ? (
            <dl
              aria-label="Event summary"
              className="mb-6 grid divide-y divide-border border-y border-border sm:grid-cols-2 sm:divide-x sm:divide-y-0 xl:grid-cols-4"
            >
              {summaryFields.map((field) => (
                <SummaryMetric key={field.label} {...field} />
              ))}
            </dl>
          ) : null}
          <div className="grid gap-6 xl:grid-cols-2">
            <DetailSection title="Event" fields={eventFields} />
            <DetailSection title="Request" fields={requestFields} />
            <div className="xl:col-span-2">
              <DetailSection title="Trace" fields={traceFields} />
            </div>
            {relatedItems.length > 0 ? (
              <section className="xl:col-span-2">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                    Related trace items
                  </h2>
                  <span className="text-xs text-muted-foreground">
                    {relatedItems.length} related event{relatedItems.length === 1 ? '' : 's'}
                  </span>
                </div>
                <ol className="border-y border-border">
                  {relatedItems.map((relatedItem) => {
                    const relatedMetadata = getMetadata(relatedItem)
                    return (
                      <li key={relatedItem.id}>
                        <button
                          type="button"
                          aria-label={`View related ${relatedMetadata.title}`}
                          className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                          onClick={() => onSelect(relatedItem.id)}
                        >
                          <div className="flex min-w-0 items-center gap-2">
                            <Badge>{relatedMetadata.method ?? relatedItem.type}</Badge>
                            <span className="truncate font-mono text-sm">
                              {relatedMetadata.route ?? relatedMetadata.title}
                            </span>
                          </div>
                          <time className="shrink-0 text-sm tabular-nums text-muted-foreground">
                            {formatTimestamp(relatedItem.timestamp)}
                          </time>
                        </button>
                      </li>
                    )
                  })}
                </ol>
              </section>
            ) : null}
          </div>
        </div>
      ) : (
        <div id="event-detail-panel" role="tabpanel" className="min-h-0 flex-1 overflow-auto">
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
  const [lastViewedItemId, setLastViewedItemId] = useState<string>()
  const [filter, setFilter] = useState<EventFilter>('all')
  const [message, setMessage] = useState<string | undefined>()
  const fallbackEventId = useRef(0)
  const presentation = getConnectionPresentation(connection)
  const selectedItem = items.find((item) => item.id === selectedItemId) ?? items[0]
  const visibleItems = items.filter((item) => matchesEventFilter(item, filter))
  const relatedItems = selectedItem?.metadata?.traceId
    ? items.filter(
        (item) =>
          item.id !== selectedItem.id &&
          item.metadata?.traceId === selectedItem.metadata?.traceId
      )
    : []
  const lastViewedIndex = lastViewedItemId
    ? items.findIndex((item) => item.id === lastViewedItemId)
    : -1
  const unseenItems =
    lastViewedItemId === undefined
      ? []
      : lastViewedIndex === -1
        ? items
        : items.slice(lastViewedIndex + 1)
  const newItems = unseenItems.filter((item) => matchesEventFilter(item, filter))
  const newItemCount = newItems.length

  const markItemsSeen = () => {
    setLastViewedItemId(items.at(-1)?.id)
  }

  const selectItem = (id: string) => {
    setSelectedItemId(id)
    markItemsSeen()
  }

  const selectFilter = (nextFilter: EventFilter) => {
    setFilter(nextFilter)
    const nextSelectedItem = items.find((item) => matchesEventFilter(item, nextFilter))
    if (nextSelectedItem) {
      setSelectedItemId(nextSelectedItem.id)
    }
    markItemsSeen()
  }

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
            <img
              className="h-5 w-auto dark:hidden"
              src="/sentry-cli-light.svg"
              alt="Sentry CLI"
              width="117"
              height="20"
            />
            <img
              className="hidden h-5 w-auto dark:block"
              src="/sentry-cli.svg"
              alt=""
              width="117"
              height="20"
            />
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
                  <div className="shrink-0 border-b border-border px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <h1 id="event-list-heading" className="text-sm font-semibold">Events</h1>
                      <span className="text-xs tabular-nums text-muted-foreground">
                        {items.length} / 500
                      </span>
                    </div>
                    <div className="mt-2 flex gap-1" aria-label="Filter events">
                      {eventFilters.map((eventFilter) => {
                        const count = items.filter((item) =>
                          matchesEventFilter(item, eventFilter.id)
                        ).length

                        return (
                          <button
                            key={eventFilter.id}
                            type="button"
                            aria-pressed={filter === eventFilter.id}
                            className={`px-1.5 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset ${
                              filter === eventFilter.id
                                ? 'bg-muted font-medium text-foreground'
                                : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
                            }`}
                            onClick={() => selectFilter(eventFilter.id)}
                          >
                            {eventFilter.label} ({count})
                          </button>
                        )
                      })}
                    </div>
                    {newItemCount > 0 ? (
                      <button
                        type="button"
                        className="mt-2 w-full border-t border-border pt-2 text-left text-xs font-medium text-primary transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                        onClick={() => {
                          const latestItem = newItems.at(-1)
                          if (latestItem) {
                            selectItem(latestItem.id)
                          }
                        }}
                      >
                        View {newItemCount} new event{newItemCount === 1 ? '' : 's'}
                      </button>
                    ) : null}
                  </div>
                  <ol
                    data-testid="event-list"
                    className="min-h-0 flex-1 space-y-px overflow-y-auto"
                  >
                    {visibleItems.map((item) => (
                      <EventEntry
                        key={item.id}
                        item={item}
                        isSelected={item.id === selectedItem?.id}
                        onSelect={selectItem}
                      />
                    ))}
                  </ol>
                </aside>
                {selectedItem ? (
                  <EventDetail
                    key={selectedItem.id}
                    item={selectedItem}
                    relatedItems={relatedItems}
                    onSelect={selectItem}
                  />
                ) : null}
              </div>
            )}
          </section>
        </div>
      </div>
    </main>
  )
}
