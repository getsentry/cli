import {
  Activity,
  Bot,
  Boxes,
  Bug,
  ChevronLeft,
  ChevronRight,
  FileArchive,
  Gauge,
  ListTree,
  Menu,
  MessageSquareText,
  Search,
  Terminal,
  type LucideIcon,
  Check,
  Copy,
} from 'lucide-react'
import {
  Fragment,
  type KeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { JsonView } from '@/components/json-view.tsx'
import { ConnectionLanding } from '@/components/connection-landing.tsx'
import { ReceiverControls } from '@/components/receiver-controls.tsx'
import { TraceWaterfall } from '@/components/trace-waterfall.tsx'
import { Badge } from '@/components/ui/badge.tsx'
import {
  getConnectionPresentation,
  type ConnectionState,
} from '@/lib/presentation.ts'
import { copyText } from '@/lib/clipboard.ts'
import {
  DEFAULT_STREAM_URL,
  decodeEnvelope,
  parseStreamEndpoint,
  REMOTE_STREAM_STORAGE_KEY,
  resolveInitialStreamUrl,
  SENTRY_ENVELOPE_EVENT,
  STREAM_STORAGE_KEY,
  type EventMetadata,
  type LocalFeedItem,
} from '@/lib/spotlight.ts'
import {
  createLocalTelemetryStore,
  type LocalTelemetrySnapshot,
} from '@/lib/telemetry-store.ts'
import { buildTraceGroups, type TraceGroup } from '@/lib/trace-model.ts'

type EventEntryProps = {
  item: LocalFeedItem
  isSelected: boolean
  onSelect: (id: string) => void
}

type EventFilter = 'all' | 'errors' | 'transactions' | 'logs'

type WorkspaceView =
  | 'live'
  | 'errors'
  | 'traces'
  | 'logs'
  | 'feedback'
  | 'envelopes'
  | 'profiles'
  | 'sdks'
  | 'ai'

type WorkspaceNavigationItem = {
  id: WorkspaceView
  label: string
  icon: LucideIcon
  getItems: (snapshot: LocalTelemetrySnapshot) => LocalFeedItem[]
}

const workspaceNavigation: WorkspaceNavigationItem[] = [
  { id: 'live', label: 'Live Activity', icon: Activity, getItems: (snapshot) => snapshot.items },
  { id: 'errors', label: 'Errors', icon: Bug, getItems: (snapshot) => snapshot.errors },
  { id: 'traces', label: 'Traces', icon: ListTree, getItems: (snapshot) => snapshot.traces },
  { id: 'logs', label: 'Logs', icon: Terminal, getItems: (snapshot) => snapshot.logs },
  { id: 'feedback', label: 'Feedback', icon: MessageSquareText, getItems: (snapshot) => snapshot.feedback },
  { id: 'envelopes', label: 'Envelopes', icon: FileArchive, getItems: (snapshot) => snapshot.envelopes },
  { id: 'profiles', label: 'Profiles', icon: Gauge, getItems: (snapshot) => snapshot.profiles },
  { id: 'sdks', label: 'SDKs', icon: Boxes, getItems: (snapshot) => snapshot.sdks },
  { id: 'ai', label: 'AI', icon: Bot, getItems: (snapshot) => snapshot.ai },
]

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
    return isErrorEvent(item)
  }

  return item.type === (filter === 'transactions' ? 'transaction' : 'log')
}

function isErrorEvent(item: LocalFeedItem): boolean {
  const { level, statusCode } = getMetadata(item)
  return level === 'error' || level === 'fatal' || (statusCode !== undefined && statusCode >= 500)
}

function matchesSearch(item: LocalFeedItem, query: string): boolean {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) {
    return true
  }

  const metadata = getMetadata(item)
  return [
    item.type,
    item.text,
    metadata.title,
    metadata.level,
    metadata.method,
    metadata.route,
    metadata.traceId,
    metadata.spanId,
    metadata.operation,
    metadata.origin,
  ].some((value) => value?.toLowerCase().includes(normalizedQuery))
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

function getSavedRemoteStream(): string | null {
  try {
    return window.sessionStorage.getItem(REMOTE_STREAM_STORAGE_KEY)
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

function saveRemoteStreamUrl(streamUrl: string): void {
  try {
    window.sessionStorage.setItem(REMOTE_STREAM_STORAGE_KEY, streamUrl)
  } catch {
    // Browser policies can disable storage; the active tab still works.
  }
}

function EventEntry({ item, isSelected, onSelect }: EventEntryProps) {
  const metadata = getMetadata(item)
  const duration = formatDuration(metadata.durationMs)
  const isError = isErrorEvent(item)

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
            <Badge variant={isError ? 'destructive' : 'default'}>
              {isError ? 'Error' : metadata.method ?? metadata.operation ?? item.type}
            </Badge>
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
  trace?: TraceGroup
  relatedItems: LocalFeedItem[]
}

type DetailTab = 'overview' | 'trace' | 'json'

type DetailField = {
  label: string
  value: string
}

type DetailGroup = {
  label: string
  fields: DetailField[]
}

function EventDetail({ item, trace, relatedItems }: EventDetailProps) {
  const [tab, setTab] = useState<DetailTab>('overview')
  const [copiedField, setCopiedField] = useState<string>()
  const detailTabs: DetailTab[] = trace?.spans.length ? ['overview', 'trace', 'json'] : ['overview', 'json']
  const metadata = getMetadata(item)
  const duration = formatDuration(metadata.durationMs)
  const detailGroups: DetailGroup[] = [
    {
      label: 'Request',
      fields: [
        ...(metadata.method ? [{ label: 'Method', value: metadata.method }] : []),
        ...(metadata.route ? [{ label: 'Route', value: metadata.route }] : []),
        ...(metadata.statusCode !== undefined
          ? [{ label: 'Status', value: String(metadata.statusCode) }]
          : []),
        ...(duration ? [{ label: 'Duration', value: duration }] : []),
      ],
    },
    {
      label: 'Trace context',
      fields: [
        ...(metadata.traceId ? [{ label: 'Trace ID', value: metadata.traceId }] : []),
        ...(metadata.spanId ? [{ label: 'Span ID', value: metadata.spanId }] : []),
        ...(metadata.operation ? [{ label: 'Operation', value: metadata.operation }] : []),
        ...(metadata.origin ? [{ label: 'Origin', value: metadata.origin }] : []),
        ...(relatedItems.length > 0
          ? [
              {
                label: 'Related events',
                value: `${relatedItems.length} other event${relatedItems.length === 1 ? '' : 's'} in this trace`,
              },
            ]
          : []),
      ],
    },
  ]
  const hasDetailFields = detailGroups.some((group) => group.fields.length > 0)

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
          <Badge>{metadata.operation ?? item.type}</Badge>
          <span className="truncate font-mono text-sm">{metadata.title}</span>
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
            {trace?.spans.length ? (
              <button
                id="event-detail-tab-trace"
                type="button"
                role="tab"
                aria-selected={tab === 'trace'}
                aria-controls="event-detail-panel"
                tabIndex={tab === 'trace' ? 0 : -1}
                className={`px-2 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset ${tab === 'trace' ? 'border-b-2 border-primary text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                onClick={() => setTab('trace')}
                onKeyDown={handleTabKeyDown}
              >
                Trace
              </button>
            ) : null}
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
        <div id="event-detail-panel" role="tabpanel" className="min-h-0 flex-1 overflow-auto p-3 sm:p-4">
          <div className="w-full">
            {hasDetailFields ? (
              <table aria-label="Event details" className="w-full border border-border text-left text-sm">
                <caption className="sr-only">Captured event details</caption>
                <tbody>
                  {detailGroups.map((group) =>
                    group.fields.length > 0 ? (
                      <Fragment key={group.label}>
                        <tr className="border-b border-border bg-muted/40">
                          <th colSpan={2} scope="rowgroup" className="px-3 py-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                            {group.label}
                          </th>
                        </tr>
                        {group.fields.map((field) => {
                          const copied = copiedField === field.label
                          return (
                            <tr key={field.label} className="border-b border-border last:border-b-0">
                              <th scope="row" className="w-36 border-r border-border bg-muted/65 px-3 py-2 align-top font-medium text-muted-foreground sm:w-44">
                                {field.label}
                              </th>
                              <td className="group px-3 py-2">
                                <div className="flex min-w-0 items-start gap-2">
                                  <code className="min-w-0 flex-1 break-all font-mono text-foreground">{field.value}</code>
                                  <button
                                    type="button"
                                    aria-label={`Copy ${field.label}`}
                                    className="shrink-0 text-muted-foreground opacity-100 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
                                    onClick={() => {
                                      copyText(field.value)
                                      setCopiedField(field.label)
                                    }}
                                  >
                                    {copied ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
                                  </button>
                                </div>
                              </td>
                            </tr>
                          )
                        })}
                      </Fragment>
                    ) : null
                  )}
                </tbody>
              </table>
            ) : (
              <p className="text-sm text-muted-foreground">No additional event details.</p>
            )}
            {copiedField ? <span role="status" aria-label={`${copiedField} copied`} className="sr-only">{copiedField} copied</span> : null}
          </div>
        </div>
      ) : tab === 'trace' && trace ? (
        <div id="event-detail-panel" role="tabpanel" className="min-h-0 flex-1 overflow-auto">
          <TraceWaterfall trace={trace} />
        </div>
      ) : (
        <div id="event-detail-panel" role="tabpanel" className="min-h-0 flex-1 overflow-auto">
          <JsonView code={item.text} />
        </div>
      )}
    </section>
  )
}

type WorkspaceSidebarProps = {
  activeView: WorkspaceView
  collapsed: boolean
  snapshot: LocalTelemetrySnapshot
  onSelect: (view: WorkspaceView) => void
  onToggle: () => void
}

function WorkspaceSidebar({
  activeView,
  collapsed,
  snapshot,
  onSelect,
  onToggle,
}: WorkspaceSidebarProps) {
  return (
    <aside
      aria-label="Workspace navigation"
      className={`hidden shrink-0 border-r border-border bg-muted/20 transition-[width] duration-200 md:flex md:flex-col ${
        collapsed ? 'w-14' : 'w-52'
      }`}
    >
      <div className="flex h-11 items-center border-b border-border px-3">
        {!collapsed ? (
          <>
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
          </>
        ) : null}
        <button
          type="button"
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className={`flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
            collapsed ? 'mx-auto' : 'ml-auto'
          }`}
          onClick={onToggle}
        >
          {collapsed ? <ChevronRight className="size-4" /> : <ChevronLeft className="size-4" />}
        </button>
      </div>
      {!collapsed ? <p className="px-3 pb-2 pt-4 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Explore</p> : null}
      <nav className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-2">
        {workspaceNavigation.map((entry) => {
          const Icon = entry.icon
          const count = entry.getItems(snapshot).length
          const active = activeView === entry.id
          return (
            <button
              key={entry.id}
              type="button"
              aria-label={`Open ${entry.label.toLowerCase()} view`}
              aria-current={active ? 'page' : undefined}
              title={collapsed ? entry.label : undefined}
              className={`flex h-8 items-center gap-2 rounded-md px-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                active
                  ? 'bg-primary/10 font-medium text-primary'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
              onClick={() => onSelect(entry.id)}
            >
              <Icon className="size-4 shrink-0" aria-hidden="true" />
              {!collapsed ? (
                <>
                  <span className="min-w-0 flex-1 truncate">{entry.label}</span>
                  {count > 0 ? <span className="text-xs tabular-nums text-muted-foreground">{count}</span> : null}
                </>
              ) : null}
            </button>
          )
        })}
      </nav>
      {!collapsed ? (
        <p className="border-t border-border px-3 py-2 text-xs leading-4 text-muted-foreground">
          Session-only telemetry. Nothing is stored after the receiver stops.
        </p>
      ) : null}
    </aside>
  )
}

export default function App() {
  const [streamUrl, setStreamUrl] = useState(() =>
    resolveInitialStreamUrl(window.location.hash, getSavedStream(), getSavedRemoteStream())
  )
  const [connection, setConnection] = useState<ConnectionState>('connecting')
  const [draftEndpoint, setDraftEndpoint] = useState(streamUrl)
  const [isEditingReceiver, setIsEditingReceiver] = useState(false)
  const [isConnectionEnabled, setIsConnectionEnabled] = useState(true)
  const [connectionError, setConnectionError] = useState<string>()
  const [telemetryStore] = useState(() => createLocalTelemetryStore())
  const telemetry = useSyncExternalStore(
    telemetryStore.subscribe,
    telemetryStore.getSnapshot,
    telemetryStore.getSnapshot
  )
  const items = telemetry.items
  const [selectedItemId, setSelectedItemId] = useState<string>()
  const [lastViewedItemId, setLastViewedItemId] = useState<string>()
  const [workspaceView, setWorkspaceView] = useState<WorkspaceView>('live')
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false)
  const [isMobileNavigationOpen, setIsMobileNavigationOpen] = useState(false)
  const [filter, setFilter] = useState<EventFilter>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [message, setMessage] = useState<string | undefined>()
  const fallbackEventId = useRef(0)
  const presentation = getConnectionPresentation(connection)
  const traces = useMemo(() => buildTraceGroups(items), [items])
  const selectedItem = items.find((item) => item.id === selectedItemId) ?? items[0]
  const selectedTrace = selectedItem?.metadata?.traceId
    ? traces.find((trace) => trace.id === selectedItem.metadata?.traceId)
    : undefined
  const activeWorkspace = workspaceNavigation.find((entry) => entry.id === workspaceView)!
  const workspaceItems = activeWorkspace.getItems(telemetry)
  const visibleItems =
    workspaceView === 'live'
      ? workspaceItems.filter((item) => matchesEventFilter(item, filter))
      : workspaceItems
  const searchedItems = visibleItems.filter((item) => matchesSearch(item, searchQuery))
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
  const newItems = unseenItems.filter(
    (item) => matchesEventFilter(item, filter) && matchesSearch(item, searchQuery)
  )
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
    const nextSelectedItem = items.find(
      (item) => matchesEventFilter(item, nextFilter) && matchesSearch(item, searchQuery)
    )
    if (nextSelectedItem) {
      setSelectedItemId(nextSelectedItem.id)
    }
    markItemsSeen()
  }

  const selectWorkspace = (nextWorkspace: WorkspaceView) => {
    setWorkspaceView(nextWorkspace)
    setFilter('all')
    setSelectedItemId(undefined)
    setIsMobileNavigationOpen(false)
    markItemsSeen()
  }

  const clearItems = () => {
    telemetryStore.clear()
    setSelectedItemId(undefined)
    setLastViewedItemId(undefined)
    setSearchQuery('')

    const endpoint = parseStreamEndpoint(streamUrl)
    if (endpoint?.kind !== 'loopback') {
      return
    }
    const clearUrl = new URL(endpoint.url)
    clearUrl.pathname = '/clear'
    clearUrl.search = ''
    void fetch(clearUrl, { method: 'DELETE' }).catch(() => {
      setMessage('Cleared this viewer, but the receiver could not clear its retained session.')
    })
  }

  const connectToDraft = () => {
    const endpoint = parseStreamEndpoint(draftEndpoint)
    if (!endpoint) {
      setConnectionError('Enter a loopback stream or an HTTPS remote stream ending in /stream.')
      if (connection !== 'connected') {
        setIsConnectionEnabled(false)
        setConnection('failed')
      }
      return
    }
    setDraftEndpoint(endpoint.url)
    setStreamUrl(endpoint.url)
    setIsConnectionEnabled(true)
    setConnection('connecting')
    setConnectionError(undefined)
    setIsEditingReceiver(false)
  }

  useEffect(() => {
    if (window.location.hash) {
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`)
    }
  }, [])

  useEffect(() => {
    if (!isConnectionEnabled) {
      return
    }

    let isCurrent = true
    const source = new EventSource(streamUrl)
    const onEnvelope = (event: Event) => {
      if (!isCurrent) {
        return
      }
      try {
        const messageEvent = event as MessageEvent<string>
        const eventId = messageEvent.lastEventId || `event-${fallbackEventId.current++}`
        telemetryStore.recordEnvelope({
          id: eventId,
          type: 'envelope',
          timestamp: Date.now(),
          text: messageEvent.data,
          payload: messageEvent.data,
          metadata: { title: `Envelope ${eventId.slice(0, 8)}` },
        })
        const decoded = decodeEnvelope(messageEvent.data, eventId)
        telemetryStore.append(decoded)
        setMessage(undefined)
      } catch {
        setMessage('Received an event that could not be decoded.')
      }
    }

    source.addEventListener(SENTRY_ENVELOPE_EVENT, onEnvelope)
    source.onopen = () => {
      if (!isCurrent) {
        return
      }
      const endpoint = parseStreamEndpoint(streamUrl)
      if (endpoint?.kind === 'loopback') {
        saveStreamUrl(endpoint.url)
      } else if (endpoint?.kind === 'remote') {
        saveRemoteStreamUrl(endpoint.url)
      }
      setConnection('connected')
      setConnectionError(undefined)
      setMessage(undefined)
    }
    source.onerror = () => {
      if (!isCurrent) {
        return
      }
      setConnection('failed')
      setConnectionError(
        streamUrl === DEFAULT_STREAM_URL
          ? 'Could not connect to the default receiver. Start it with the command below or enter another endpoint.'
          : 'Could not connect to this receiver. Check the endpoint and try again.'
      )
    }

    return () => {
      isCurrent = false
      source.removeEventListener(SENTRY_ENVELOPE_EVENT, onEnvelope)
      source.close()
    }
  }, [isConnectionEnabled, streamUrl, telemetryStore])

  const showConnectionLanding =
    isEditingReceiver ||
    (items.length === 0 && (connection === 'connecting' || connection === 'failed'))
  const canSearch = connection === 'connected' && items.length > 0 && !isEditingReceiver

  return (
    <main className="h-dvh overflow-hidden bg-background">
      <div
        data-testid="app-shell"
        className="mx-auto flex h-full w-full max-w-none"
      >
        <WorkspaceSidebar
          activeView={workspaceView}
          collapsed={isSidebarCollapsed}
          snapshot={telemetry}
          onSelect={selectWorkspace}
          onToggle={() => setIsSidebarCollapsed((collapsed) => !collapsed)}
        />
        <div className="relative flex min-w-0 flex-1 flex-col">
          <header className="flex h-11 shrink-0 items-center gap-3 px-3 sm:px-4">
            <button
              type="button"
              aria-label="Open navigation"
              aria-expanded={isMobileNavigationOpen}
              className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:hidden"
              onClick={() => setIsMobileNavigationOpen((open) => !open)}
            >
              <Menu className="size-4" />
            </button>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-muted-foreground">Sentry Local</p>
              <h1 className="truncate text-sm font-semibold">
                {showConnectionLanding ? 'Receiver setup' : activeWorkspace.label}
              </h1>
            </div>
            {canSearch ? (
              <label className="relative min-w-0 max-w-lg flex-1">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <input
                  type="search"
                  aria-label="Search events"
                  placeholder="Search events"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  className="h-8 w-full border border-border bg-muted/30 pl-8 pr-3 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20"
                />
              </label>
            ) : null}
            <ReceiverControls connection={presentation} eventCount={items.length} onClear={clearItems} />
          </header>

          {isMobileNavigationOpen ? (
          <div className="absolute top-11 z-20 w-full border-b border-border bg-background p-2 shadow-lg md:hidden">
            <nav aria-label="Workspace navigation" className="grid grid-cols-2 gap-1">
              {workspaceNavigation.map((entry) => {
                const Icon = entry.icon
                const active = workspaceView === entry.id
                return (
                  <button
                    key={entry.id}
                    type="button"
                    aria-label={`Open ${entry.label.toLowerCase()} view`}
                    aria-current={active ? 'page' : undefined}
                    className={`flex h-9 items-center gap-2 rounded-md px-2 text-left text-sm ${
                      active ? 'bg-primary/10 font-medium text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                    }`}
                    onClick={() => selectWorkspace(entry.id)}
                  >
                    <Icon className="size-4" />
                    {entry.label}
                  </button>
                )
              })}
            </nav>
          </div>
          ) : null}

        <div className="flex min-h-0 flex-1">
          <section className="flex min-h-0 flex-1 flex-col" aria-label="Local Sentry events">

            {connectionError && connection === 'failed' && items.length > 0 ? (
              <div role="alert" className="shrink-0 border-b border-amber-500/25 bg-amber-500/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-200">
                {connectionError}
              </div>
            ) : null}
            {message ? (
              <div role="alert" className="shrink-0 border-b border-amber-500/25 bg-amber-500/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-200">
                {message}
              </div>
            ) : null}

            {showConnectionLanding ? (
              <ConnectionLanding
                phase={connection === 'connecting' ? 'probing' : connection === 'failed' ? 'failed' : 'editing'}
                endpoint={draftEndpoint}
                error={connectionError}
                onEndpointChange={setDraftEndpoint}
                onConnect={connectToDraft}
                onCopyCommand={() => copyText('sentry local serve --open')}
              />
            ) : items.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center border border-dashed border-border bg-muted/40 px-4 text-center">
                <Terminal className="mb-3 size-5 text-primary" aria-hidden="true" />
                <p className="font-medium">Waiting for events</p>
                <button
                  type="button"
                  className="mt-3 text-sm font-medium text-primary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => setIsEditingReceiver(true)}
                >
                  Change receiver
                </button>
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
                    {workspaceView === 'live' ? <div className="mt-2 flex gap-1" aria-label="Filter events">
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
                    </div> : null}
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
                    {searchedItems.map((item) => (
                      <EventEntry
                        key={item.id}
                        item={item}
                        isSelected={item.id === selectedItem?.id}
                        onSelect={selectItem}
                      />
                    ))}
                    {searchedItems.length === 0 ? (
                      <li className="px-3 py-4 text-sm text-muted-foreground">No matching events.</li>
                    ) : null}
                  </ol>
                </aside>
                {selectedItem ? (
                  <EventDetail
                    key={selectedItem.id}
                    item={selectedItem}
                    trace={selectedTrace}
                    relatedItems={relatedItems}
                  />
                ) : null}
              </div>
            )}
          </section>
        </div>
        </div>
      </div>
    </main>
  )
}
