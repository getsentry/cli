export const SENTRY_ENVELOPE_EVENT = "application/x-sentry-envelope"
export const STREAM_STORAGE_KEY = "sentry.local.stream-url"
const MAX_FEED_ITEMS = 500

export type LocalFeedItem = {
  id: string
  type: string
  timestamp?: number | string
  text: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
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
    return [
      {
        id: `${eventId}:${index}`,
        type: typeof header.type === "string" ? header.type : "unknown",
        timestamp:
          typeof timestamp === "number" || typeof timestamp === "string"
            ? timestamp
            : undefined,
        text: JSON.stringify(payload, null, 2) ?? String(payload),
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
