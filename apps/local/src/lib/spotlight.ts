export const SENTRY_ENVELOPE_EVENT = "application/x-sentry-envelope"
export const STREAM_STORAGE_KEY = "sentry.local.stream-url"
const MAX_FEED_ITEMS = 500

export type LocalFeedItem = {
  id: string
  type: string
  timestamp?: number | string
  text: string
  metadata?: EventMetadata
}

export type EventMetadata = {
  title: string
  level?: string
  method?: string
  route?: string
  statusCode?: number
  durationMs?: number
  traceId?: string
  spanId?: string
  operation?: string
  origin?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined
}

function getNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function getRoute(url: string | undefined): string | undefined {
  if (!url) {
    return undefined
  }
  try {
    const parsed = new URL(url)
    return `${parsed.pathname}${parsed.search}`
  } catch {
    return url.startsWith("/") ? url : undefined
  }
}

function getEventMetadata(payload: unknown, type: string): EventMetadata {
  const event = isRecord(payload) ? payload : {}
  const transaction = getString(event.transaction)
  const transactionMatch = transaction?.match(/^([A-Z]+)\s+(.+)$/)
  const contexts = isRecord(event.contexts) ? event.contexts : {}
  const trace = isRecord(contexts.trace) ? contexts.trace : {}
  const data = isRecord(trace.data) ? trace.data : {}
  const request = isRecord(event.request) ? event.request : {}
  const method =
    getString(request.method) ?? getString(data["http.method"]) ?? transactionMatch?.[1]
  const url = getString(request.url) ?? getString(data["http.url"])
  const route = getRoute(url) ?? transactionMatch?.[2]
  const startTimestamp = getNumber(event.start_timestamp)
  const timestamp = getNumber(event.timestamp)
  const durationMs =
    startTimestamp !== undefined && timestamp !== undefined
      ? Math.round((timestamp - startTimestamp) * 100_000) / 100
      : undefined

  return {
    title: transaction ?? route ?? type,
    level: getString(event.level),
    method,
    route,
    statusCode:
      getNumber(request.status_code) ?? getNumber(data["http.response.status_code"]),
    durationMs,
    traceId: getString(trace.trace_id) ?? getString(event.trace_id),
    spanId: getString(trace.span_id) ?? getString(event.span_id),
    operation: getString(trace.op) ?? getString(event.transaction_op),
    origin: getString(data["sentry.origin"]),
  }
}

function isLoopbackHost(hostname: string): boolean {
  const normalized = hostname.replace(/^\[|\]$/g, "").toLowerCase()
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1"
}

function normalizeStreamUrl(stream: string | null): string | undefined {
  if (!stream) {
    return undefined
  }
  try {
    const url = new URL(stream)
    if (
      url.protocol !== "http:" ||
      !isLoopbackHost(url.hostname) ||
      url.pathname !== "/stream" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      return undefined
    }
    return url.toString()
  } catch {
    return undefined
  }
}

/** Read the CLI-provided stream endpoint without allowing arbitrary targets. */
export function getStreamUrlFromHash(hash: string): string | undefined {
  return normalizeStreamUrl(
    new URLSearchParams(hash.replace(/^#/, "")).get("stream")
  )
}

/** Validate a stream endpoint saved by an earlier CLI-launched tab. */
export function getStreamUrlFromStorage(stream: string | null): string | undefined {
  return normalizeStreamUrl(stream)
}

/** Prefer a newly supplied CLI endpoint over a previously saved one. */
export function getPreferredStreamUrl(
  hash: string,
  savedStream: string | null
): string | undefined {
  return getStreamUrlFromHash(hash) ?? getStreamUrlFromStorage(savedStream)
}

/** Decode the event payload emitted by the local receiver's SSE endpoint. */
export function decodeEnvelope(data: string, eventId: string): LocalFeedItem[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(data)
  } catch {
    throw new Error("Invalid Sentry envelope")
  }

  if (!Array.isArray(parsed) || !Array.isArray(parsed[1])) {
    throw new Error("Invalid Sentry envelope")
  }

  return parsed[1].flatMap((item, index) => {
    if (!Array.isArray(item) || item.length < 2 || !isRecord(item[0])) {
      return []
    }
    const header = item[0]
    const payload = item[1]
    const timestamp = isRecord(payload) ? payload.timestamp : undefined
    const type = typeof header.type === "string" ? header.type : "unknown"
    return [
      {
        id: `${eventId}:${index}`,
        type,
        timestamp:
          typeof timestamp === "number" || typeof timestamp === "string"
            ? timestamp
            : undefined,
        text: JSON.stringify(payload, null, 2) ?? String(payload),
        metadata: getEventMetadata(payload, type),
      },
    ]
  })
}

/** Append received items while keeping the in-memory UI feed bounded. */
export function appendBounded(
  existing: readonly LocalFeedItem[],
  incoming: readonly LocalFeedItem[],
  limit = MAX_FEED_ITEMS
): LocalFeedItem[] {
  return [...existing, ...incoming].slice(-limit)
}
