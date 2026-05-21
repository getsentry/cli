/** Tail formatters for the local dev server. */

import { blue, bold, cyan, green, muted, red, yellow } from "./colors.js";
import { stripAnsi } from "./plain-detect.js";

/**
 * Strip ANSI escapes, collapse newlines, and remove C0/C1 control characters
 * so envelope fields can't inject fake log lines or terminal commands.
 */
export function sanitize(text: string): string {
  // Collapse CR, LF, and NEL (U+0085) which terminals treat as line breaks.
  const stripped = stripAnsi(text).replace(/[\r\n\x85]+/g, " ");
  // Strip C0 (0x00-0x1F, 0x7F) and C1 (0x80-0x9F) control characters.
  // C1 includes raw 8-bit CSI (0x9B), OSC (0x9D), and DCS (0x90) introducers.
  // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping control chars from untrusted envelope data
  return stripped.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\x80-\x9f]/g, "");
}

/** Canonical content type for Sentry envelopes. */
export const SENTRY_CONTENT_TYPE = "application/x-sentry-envelope";

/** Envelope item categories that can be filtered via `--filter`. */
export const FILTER_VALUES = ["error", "transaction", "log"] as const;
export type FilterValue = (typeof FILTER_VALUES)[number];

/** Format a local timestamp as HH:MM:SS from a Sentry timestamp. */
export function formatTime(timestamp?: number | string): string {
  let date: Date;
  if (!timestamp) {
    date = new Date();
  } else if (typeof timestamp === "string") {
    date = new Date(timestamp);
  } else {
    date = new Date(timestamp * 1000);
  }
  if (Number.isNaN(date.getTime())) {
    return "??:??:??";
  }
  return date.toLocaleTimeString("en-US", { hour12: false });
}

/** Level → color map for tail output. */
const LEVEL_COLORS: Record<string, (s: string) => string> = {
  error: (s) => red(bold(s)),
  fatal: (s) => red(bold(s)),
  warning: yellow,
  info: cyan,
  trace: green,
  debug: muted,
};

/** Longest bracketed type label: `[WARNING]` = 9 chars. */
const TYPE_WIDTH = 9;

/** Longest bracketed source label: `[BROWSER]` = 9 chars. */
const SOURCE_WIDTH = 9;

/** Format a type/level label as `[TYPE]` padded to fixed width. */
export function formatType(level: string): string {
  const tag = `[${sanitize(level).toUpperCase()}]`;
  const colorFn = LEVEL_COLORS[level.toLowerCase()];
  const colored = colorFn ? colorFn(tag) : tag;
  return colored + " ".repeat(Math.max(0, TYPE_WIDTH - tag.length));
}

/** Mobile SDK name substrings. */
const MOBILE_MARKERS = ["cocoa", "android", "react-native", "flutter"];

/** Server-side JS SDK name substrings — exclude from browser detection. */
const SERVER_JS_MARKERS = [
  "node",
  "bun",
  "deno",
  "nextjs",
  "remix",
  "astro",
  "nuxt",
  "sveltekit",
];

/** Source → color map for tail output. */
const SOURCE_COLORS: Record<string, (s: string) => string> = {
  browser: yellow,
  mobile: blue,
  server: cyan,
};

/**
 * Infer the source platform from the envelope header's `sdk.name` field.
 * Returns a colored, bracketed, padded label like `[SERVER] `.
 */
export function inferSource(header: Record<string, unknown>): string {
  const sdk = header.sdk as { name?: string } | undefined;
  const name = sdk?.name ?? "";
  let source = "server";
  if (MOBILE_MARKERS.some((m) => name.includes(m))) {
    source = "mobile";
  } else if (
    name.startsWith("sentry.javascript.") &&
    !SERVER_JS_MARKERS.some((m) => name.includes(m))
  ) {
    source = "browser";
  }
  const tag = `[${source.toUpperCase()}]`;
  const colorFn = SOURCE_COLORS[source] ?? cyan;
  return colorFn(tag) + " ".repeat(Math.max(0, SOURCE_WIDTH - tag.length));
}

/** Shape of a single stack frame in the exception value. */
export type StackFrame = {
  filename?: string;
  lineno?: number;
  colno?: number;
  function?: string;
  in_app?: boolean;
};

/** Build the `[file:line:col] [func]` suffix for the best stack frame. */
export function formatFrameHint(frames: StackFrame[]): string {
  const frame = frames.find((f) => f.in_app) ?? frames.at(-1);
  if (!frame) {
    return "";
  }
  let hint = "";
  if (frame.filename && frame.lineno) {
    const loc = sanitize(
      frame.colno
        ? `${frame.filename}:${frame.lineno}:${frame.colno}`
        : `${frame.filename}:${frame.lineno}`
    );
    hint += ` ${muted(`[${loc}]`)}`;
  }
  if (frame.function) {
    hint += ` ${muted(`[${sanitize(frame.function)}]`)}`;
  }
  return hint;
}

/**
 * Format an error event item into a colored one-liner.
 *
 * Output: `HH:MM:SS [ERROR]   [SERVER]  TypeError: x is not a function [file.ts:42:5] [handleRequest]`
 */
export function formatErrorItem(
  event: Record<string, unknown>,
  header: Record<string, unknown>
): string {
  const exception = event.exception as
    | {
        values?: {
          type?: string;
          value?: string;
          stacktrace?: { frames?: StackFrame[] };
        }[];
      }
    | undefined;
  // values is ordered oldest→newest; show the outermost (last) exception
  const first = exception?.values?.at(-1);
  const errorType = sanitize(String(first?.type ?? "Error"));
  const errorValue = sanitize(
    String(first?.value ?? event.message ?? "Unknown error")
  );

  let msg = `${errorType}: ${errorValue}`;

  const frames = first?.stacktrace?.frames;
  if (frames?.length) {
    msg += formatFrameHint(frames);
  }

  const ts = formatTime(event.timestamp as number | undefined);
  return `${muted(ts)} ${formatType("error")} ${inferSource(header)} ${msg}`;
}

/**
 * Format a transaction event item into a colored one-liner.
 *
 * Output: `HH:MM:SS [TRACE]   [BROWSER] [http.client] GET /api/users [245ms] [3 spans]`
 */
export function formatTransactionItem(
  event: Record<string, unknown>,
  header: Record<string, unknown>
): string {
  const trace = (event.contexts as Record<string, unknown> | undefined)
    ?.trace as
    | { op?: string; status?: string; description?: string }
    | undefined;
  const txnName =
    typeof event.transaction === "string"
      ? event.transaction
      : (trace?.description ?? "Transaction");
  let msg = sanitize(txnName);

  const op = trace?.op;
  if (op && op !== "default" && op !== "unknown") {
    msg = `[${sanitize(op)}] ${msg}`;
  }

  const start = event.start_timestamp as number | undefined;
  const end = event.timestamp as number | undefined;
  if (start !== undefined && end !== undefined) {
    const durationMs = Math.round((end - start) * 1000);
    msg += ` ${muted(`[${durationMs}ms]`)}`;
  }

  const status = trace?.status;
  if (status && status !== "ok") {
    msg += ` ${muted(`[${sanitize(status)}]`)}`;
  }

  const spans = event.spans as unknown[] | undefined;
  if (spans?.length) {
    msg += ` ${muted(`[${spans.length} span${spans.length === 1 ? "" : "s"}]`)}`;
  }

  const ts = formatTime(event.timestamp as number | undefined);
  return `${muted(ts)} ${formatType("trace")} ${inferSource(header)} ${msg}`;
}

/** Shape of a single log entry inside a log envelope item. */
export type LogEntry = {
  level?: string;
  body?: string;
  timestamp?: number;
  attributes?: Record<string, { value?: unknown }>;
};

/** Format one log entry into a colored tail line. */
export function formatSingleLog(logEntry: LogEntry, source: string): string {
  const level = logEntry.level ?? "log";
  let msg = sanitize(logEntry.body ?? "");

  if (logEntry.attributes) {
    const attrs = Object.entries(logEntry.attributes)
      .filter(
        ([k, v]) =>
          !k.startsWith("sentry.") &&
          v !== null &&
          v !== undefined &&
          v.value !== null &&
          v.value !== undefined
      )
      .map(([k, v]) => muted(`[${sanitize(k)}=${sanitize(String(v.value))}]`));
    if (attrs.length > 0) {
      msg += ` ${attrs.join(" ")}`;
    }
  }

  const ts = formatTime(logEntry.timestamp);
  return `${muted(ts)} ${formatType(level)} ${source} ${msg}`;
}

/**
 * Format a log event item. A log envelope item contains an `items` array
 * of individual log entries; each gets its own line.
 *
 * Output: `HH:MM:SS [INFO]    [SERVER]  User logged in [user_id=1234]`
 */
export function formatLogItem(
  event: Record<string, unknown>,
  header: Record<string, unknown>
): string[] {
  const items = event.items as LogEntry[] | undefined;
  if (!items?.length) {
    return [];
  }

  const source = inferSource(header);
  return items.map((logEntry) => formatSingleLog(logEntry, source));
}

/** Item types that map to the error formatter. */
export const ERROR_TYPES = new Set(["event", "error"]);

/**
 * Map envelope item `type` to the corresponding `FilterValue`.
 * Returns undefined for item types that don't map to a filter category.
 */
export function itemTypeToFilterCategory(
  itemType: string | undefined
): FilterValue | undefined {
  if (!itemType) {
    return;
  }
  if (ERROR_TYPES.has(itemType)) {
    return "error";
  }
  if (itemType === "transaction" || itemType === "log") {
    return itemType;
  }
}

/** Produce a fallback one-liner for unparseable or unsupported items. */
export function formatFallbackLine(label: string): string {
  return `${muted(formatTime())} ${cyan("•")} ${bold(sanitize(label))}`;
}

/** Resolve a human label for a completely unparseable envelope. */
export function resolveUnparseableLabel(container: {
  getContentType: () => string;
  getEventTypes: () => string[] | null;
}): string {
  const types = container.getEventTypes();
  if (types && types.length > 0) {
    return types.join("+");
  }
  const ct = container.getContentType();
  return ct === "application/x-sentry-envelope" ? "envelope" : ct;
}

/** Format a single envelope item into one or more output lines. */
export function formatItem(
  itemType: string | undefined,
  payload: Record<string, unknown>,
  header: Record<string, unknown>,
  fallbackLabel: string
): string[] {
  if (itemType && ERROR_TYPES.has(itemType)) {
    return [formatErrorItem(payload, header)];
  }
  if (itemType === "transaction") {
    return [formatTransactionItem(payload, header)];
  }
  if (itemType === "log") {
    return formatLogItem(payload, header);
  }
  return [formatFallbackLine(fallbackLabel)];
}

/** Check whether an item should be shown given active filters. */
export function isItemIncluded(
  itemType: string | undefined,
  activeFilters: ReadonlySet<FilterValue>
): boolean {
  if (activeFilters.size === 0) {
    return true;
  }
  const category = itemTypeToFilterCategory(itemType);
  return category !== undefined && activeFilters.has(category);
}

/**
 * Format a freshly received envelope for terminal output.
 *
 * When `activeFilters` is non-empty, only items whose category matches
 * one of the filter values are rendered; non-matching items are silently
 * dropped. When empty, all items are shown.
 */
export function formatEnvelopeLines(
  container: {
    getParsedEnvelope: () => {
      envelope: [Record<string, unknown>, [{ type?: string }, unknown][]];
    } | null;
    getContentType: () => string;
    getEventTypes: () => string[] | null;
  },
  activeFilters: ReadonlySet<FilterValue>
): string[] {
  const parsed = container.getParsedEnvelope();
  if (!parsed) {
    if (activeFilters.size > 0) {
      return [];
    }
    return [formatFallbackLine(resolveUnparseableLabel(container))];
  }

  const [header, items] = parsed.envelope;
  const lines: string[] = [];
  for (const [itemHeader, itemPayload] of items) {
    if (!isItemIncluded(itemHeader.type, activeFilters)) {
      continue;
    }
    lines.push(
      ...formatItem(
        itemHeader.type,
        itemPayload as Record<string, unknown>,
        header,
        itemHeader.type ?? container.getContentType()
      )
    );
  }

  if (lines.length > 0) {
    return lines;
  }
  if (activeFilters.size > 0) {
    return [];
  }
  return [formatFallbackLine(resolveUnparseableLabel(container))];
}
