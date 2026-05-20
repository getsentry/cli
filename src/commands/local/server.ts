/**
 * sentry local
 *
 * Run a local Spotlight-compatible server, or attach to one already running.
 *
 * On startup the command probes `http://<host>:<port>/health`. If a server
 * is already listening (e.g. a Spotlight sidecar or another `sentry local`),
 * the command attaches as an SSE consumer and tails events from it. Otherwise
 * it starts its own Hono HTTP server.
 *
 * Learn more: https://spotlightjs.com/docs/getting-started/
 *
 * The command runs until interrupted (Ctrl-C / SIGTERM).
 */

import type { Server } from "node:http";
import { serve } from "@hono/node-server";
import {
  createSpotlightBuffer,
  pushToSpotlightBuffer,
} from "@spotlightjs/spotlight/sdk";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import type { SentryContext } from "../../context.js";
import { buildCommand, numberParser } from "../../lib/command.js";
import { ValidationError } from "../../lib/errors.js";
import {
  blue,
  bold,
  cyan,
  green,
  muted,
  red,
  yellow,
} from "../../lib/formatters/colors.js";
import { stripAnsi } from "../../lib/formatters/plain-detect.js";
import { logger } from "../../lib/logger.js";

/** Default port matches Spotlight's `DEFAULT_PORT`. */
export const DEFAULT_PORT = 8969;

/** Buffer size: how many recent envelopes to retain for late subscribers. */
const BUFFER_SIZE = 500;

/** Canonical content type for Sentry envelopes. */
const SENTRY_CONTENT_TYPE = "application/x-sentry-envelope";

/** Trailing carriage return — stripped from SSE lines. */
const CR_RE = /\r$/;

/** Maximum ingest body size (10 MB). Rejects oversized payloads early. */
const MAX_BODY_BYTES = 10 * 1024 * 1024;

/** Envelope item categories that can be filtered via `--filter`. */
const FILTER_VALUES = ["error", "transaction", "log"] as const;
type FilterValue = (typeof FILTER_VALUES)[number];

/**
 * Parse and validate a `--filter` value.
 * Accepts the canonical names: error, transaction, logger.
 */
function parseFilter(value: string): FilterValue {
  const lower = value.toLowerCase();
  if (!FILTER_VALUES.includes(lower as FilterValue)) {
    throw new ValidationError(
      `Invalid filter "${value}". Valid values: ${FILTER_VALUES.join(", ")}`,
      "filter"
    );
  }
  return lower as FilterValue;
}

type LocalFlags = {
  readonly port: number;
  readonly host: string;
  readonly quiet: boolean;
  readonly filter: FilterValue[];
};

/**
 * Validate a port number from `--port`.
 *
 * Hard-fails on out-of-range values so users get a clean error rather than
 * a `listen EADDRNOTAVAIL` from the kernel.
 */
function parsePort(value: string): number {
  const port = numberParser(value);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new ValidationError(
      `Invalid port: ${value}. Must be an integer between 0 and 65535.`,
      "port"
    );
  }
  return port;
}

/** Match localhost origins on any port (http or https). */
const LOCALHOST_ORIGIN_RE = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

/**
 * Build the Hono application.
 *
 * CORS is restricted to localhost origins — dev stacks send from arbitrary
 * `localhost:*` ports (Vite, Next, Astro, etc.) but we must not allow
 * arbitrary remote origins to read the SSE envelope stream.
 */
function buildApp(
  spotlightBuffer: ReturnType<typeof createSpotlightBuffer>
): Hono {
  const app = new Hono();

  app.use(
    "*",
    cors({
      origin: (origin) => (LOCALHOST_ORIGIN_RE.test(origin) ? origin : null),
      allowMethods: ["GET", "POST", "OPTIONS"],
      allowHeaders: ["Content-Type", "Content-Encoding", "User-Agent"],
    })
  );

  app.get("/health", (c) => c.text("OK"));

  const ingest = async (c: {
    req: {
      arrayBuffer: () => Promise<ArrayBuffer>;
      header: (name: string) => string | undefined;
      query: (name: string) => string | undefined;
    };
    body: (data: null, status: number) => Response;
  }) => {
    const contentLength = Number(c.req.header("content-length") ?? 0);
    if (contentLength > MAX_BODY_BYTES) {
      return c.body(null, 413);
    }
    const arrayBuf = await c.req.arrayBuffer();
    if (arrayBuf.byteLength > MAX_BODY_BYTES) {
      return c.body(null, 413);
    }
    const body = Buffer.from(arrayBuf);
    // Browser SDKs using sendBeacon() set Content-Type to text/plain to
    // avoid CORS preflight. Detect this via the sentry_client query param
    // and override to the canonical Sentry envelope content type.
    let contentType = c.req.header("content-type") ?? "";
    if (
      c.req.query("sentry_client")?.startsWith("sentry.javascript.browser") &&
      c.req.header("origin")
    ) {
      contentType = SENTRY_CONTENT_TYPE;
    }
    const contentEncoding = c.req.header("content-encoding") as
      | "gzip"
      | "deflate"
      | "br"
      | undefined;
    const userAgent = c.req.header("user-agent");

    pushToSpotlightBuffer({
      spotlightBuffer,
      body,
      encoding: contentEncoding,
      contentType,
      userAgent,
    });

    return c.body(null, 204);
  };

  app.post("/stream", ingest);
  app.post("/api/:projectId/envelope/", ingest);
  app.post("/api/:projectId/envelope", ingest);

  /**
   * SSE stream — Spotlight overlay / UI clients connect here to receive a
   * live feed of envelopes. The event format matches Spotlight's protocol:
   *   - `event` is the content type (e.g., "application/x-sentry-envelope")
   *   - `id` is the Spotlight-assigned envelope UUID (enables reconnection)
   *   - `data` is the parsed envelope JSON ([header, items])
   */
  app.get("/stream", (c) =>
    streamSSE(c, async (stream) => {
      const lastEventId = c.req.header("Last-Event-ID");
      const readerId = spotlightBuffer.subscribe((container) => {
        const parsed = container.getParsedEnvelope();
        if (!parsed) {
          return;
        }
        const header = parsed.envelope[0] as Record<string, unknown>;
        const envelopeId = header.__spotlight_envelope_id;
        stream
          .writeSSE({
            id: envelopeId ? String(envelopeId) : undefined,
            event: container.getContentType(),
            data: JSON.stringify(parsed.envelope),
          })
          .catch((err: unknown) => {
            logger.debug(
              `SSE write failed (client likely disconnected): ${
                err instanceof Error ? err.message : String(err)
              }`
            );
          });
      }, lastEventId);

      await new Promise<void>((resolve) => {
        stream.onAbort(() => {
          spotlightBuffer.unsubscribe(readerId);
          resolve();
        });
      });
    })
  );

  return app;
}

/** Format a local timestamp as HH:MM:SS from a Sentry timestamp. */
function formatTime(timestamp?: number | string): string {
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

/** Level → color map for tail output, matching Spotlight's Sentinel theme. */
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
function formatType(level: string): string {
  const tag = `[${level.toUpperCase()}]`;
  const colorFn = LEVEL_COLORS[level];
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

/** Source color map matching Spotlight's Sentinel theme. */
const SOURCE_COLORS: Record<string, (s: string) => string> = {
  browser: yellow,
  mobile: blue,
  server: cyan,
};

/**
 * Infer the source platform from the envelope header's `sdk.name` field.
 * Returns a colored, bracketed, padded label like `[SERVER] `.
 */
function inferSource(header: Record<string, unknown>): string {
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
type StackFrame = {
  filename?: string;
  lineno?: number;
  colno?: number;
  function?: string;
  in_app?: boolean;
};

/** Build the `[file:line:col] [func]` suffix for the best stack frame. */
function formatFrameHint(frames: StackFrame[]): string {
  const frame = frames.find((f) => f.in_app) ?? frames.at(-1);
  if (!frame) {
    return "";
  }
  let hint = "";
  if (frame.filename && frame.lineno) {
    const loc = frame.colno
      ? `${stripAnsi(frame.filename)}:${frame.lineno}:${frame.colno}`
      : `${stripAnsi(frame.filename)}:${frame.lineno}`;
    hint += ` ${muted(`[${loc}]`)}`;
  }
  if (frame.function) {
    hint += ` ${muted(`[${stripAnsi(frame.function)}]`)}`;
  }
  return hint;
}

/**
 * Format an error event item into a colored one-liner.
 *
 * Output: `HH:MM:SS [ERROR]   [SERVER]  TypeError: x is not a function [file.ts:42:5] [handleRequest]`
 */
function formatErrorItem(
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
  const errorType = stripAnsi(first?.type ?? "Error");
  const errorValue = stripAnsi(
    first?.value ?? (event.message as string | undefined) ?? "Unknown error"
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
function formatTransactionItem(
  event: Record<string, unknown>,
  header: Record<string, unknown>
): string {
  const trace = (event.contexts as Record<string, unknown> | undefined)
    ?.trace as
    | { op?: string; status?: string; description?: string }
    | undefined;
  let msg = stripAnsi(
    (event.transaction as string) ?? trace?.description ?? "Transaction"
  );

  const op = trace?.op;
  if (op && op !== "default" && op !== "unknown") {
    msg = `[${stripAnsi(op)}] ${msg}`;
  }

  const start = event.start_timestamp as number | undefined;
  const end = event.timestamp as number | undefined;
  if (start !== undefined && end !== undefined) {
    const durationMs = Math.round((end - start) * 1000);
    msg += ` ${muted(`[${durationMs}ms]`)}`;
  }

  const status = trace?.status;
  if (status && status !== "ok") {
    msg += ` ${muted(`[${stripAnsi(status)}]`)}`;
  }

  const spans = event.spans as unknown[] | undefined;
  if (spans?.length) {
    msg += ` ${muted(`[${spans.length} span${spans.length === 1 ? "" : "s"}]`)}`;
  }

  const ts = formatTime(event.timestamp as number | undefined);
  return `${muted(ts)} ${formatType("trace")} ${inferSource(header)} ${msg}`;
}

/** Shape of a single log entry inside a log envelope item. */
type LogEntry = {
  level?: string;
  body?: string;
  timestamp?: number;
  attributes?: Record<string, { value?: unknown }>;
};

/** Format one log entry into a colored tail line. */
function formatSingleLog(logEntry: LogEntry, source: string): string {
  const level = logEntry.level ?? "log";
  let msg = stripAnsi(logEntry.body ?? "");

  if (logEntry.attributes) {
    const attrs = Object.entries(logEntry.attributes)
      .filter(
        ([k, v]) =>
          !k.startsWith("sentry.") && v.value !== null && v.value !== undefined
      )
      .map(([k, v]) =>
        muted(`[${stripAnsi(k)}=${stripAnsi(String(v.value))}]`)
      );
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
function formatLogItem(
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
const ERROR_TYPES = new Set(["event", "error"]);

/**
 * Map envelope item `type` to the corresponding `FilterValue`.
 * Returns undefined for item types that don't map to a filter category.
 */
function itemTypeToFilterCategory(
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
function formatFallbackLine(label: string): string {
  const ts = new Date().toISOString().slice(11, 23);
  return `${muted(ts)} ${cyan("•")} ${bold(label)}`;
}

/** Resolve a human label for a completely unparseable envelope. */
function resolveUnparseableLabel(container: {
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
function formatItem(
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
function isItemIncluded(
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
function formatEnvelopeLines(
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

/**
 * Install signal handlers that stop the HTTP server on Ctrl-C / SIGTERM.
 *
 * Returns a Promise that resolves when shutdown is complete. The command
 * awaits this so the generator stays alive until the user interrupts.
 */
function waitForShutdown(server: Server): Promise<void> {
  return new Promise<void>((resolve) => {
    let shuttingDown = false;
    const shutdown = (signal: NodeJS.Signals) => {
      if (shuttingDown) {
        // Second signal — force exit. Bypasses the `process.exit` hook so
        // we don't dangle on stuck connections.
        process.exit(0);
      }
      shuttingDown = true;
      logger.log(`Received ${signal}, shutting down...`);
      server.close(() => resolve());
      // Force-close keep-alive connections so we don't wait on long-lived
      // SSE subscribers.
      if (typeof server.closeAllConnections === "function") {
        server.closeAllConnections();
      }
    };

    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("SIGTERM", () => shutdown("SIGTERM"));
  });
}

/** Maximum retries on EADDRINUSE before giving up. */
const MAX_PORT_RETRIES = 3;

/** Delay between EADDRINUSE retries in milliseconds. */
const PORT_RETRY_DELAY_MS = 5000;

/**
 * Try to start the HTTP server, retrying with backoff on EADDRINUSE.
 *
 * Retries up to {@link MAX_PORT_RETRIES} times with a {@link PORT_RETRY_DELAY_MS}
 * delay between attempts, matching Spotlight's retry strategy.
 */
function tryListen(
  app: Hono,
  port: number,
  hostname: string
): Promise<{ server: Server; port: number }> {
  let attempts = 0;

  const attempt = (): Promise<{ server: Server; port: number }> =>
    new Promise((resolve, reject) => {
      const server = serve({
        fetch: app.fetch,
        port,
        hostname,
      }) as unknown as Server;

      server.once("listening", () => resolve({ server, port }));
      server.once("error", async (err: NodeJS.ErrnoException) => {
        server.close();
        if (err.code === "EADDRINUSE") {
          attempts += 1;
          if (attempts > MAX_PORT_RETRIES) {
            reject(
              new ValidationError(
                `Port ${port} is in use after ${MAX_PORT_RETRIES} retries`,
                "port"
              )
            );
            return;
          }
          logger.warn(
            `Port ${port} is in use, retrying in ${PORT_RETRY_DELAY_MS / 1000}s (attempt ${attempts}/${MAX_PORT_RETRIES})...`
          );
          await Bun.sleep(PORT_RETRY_DELAY_MS);
          resolve(attempt());
          return;
        }
        reject(err);
      });
    });

  return attempt();
}

/**
 * Check whether a Spotlight server is already running on the given URL.
 * Returns `true` if the health endpoint responds successfully.
 */
async function isServerRunning(url: string): Promise<boolean> {
  try {
    const res = await fetch(`${url}/health`, {
      signal: AbortSignal.timeout(2000),
    });
    return res.ok;
  } catch (err) {
    logger.debug(
      `No existing server at ${url}`,
      err instanceof Error ? err.message : String(err)
    );
    return false;
  }
}

/** Mutable state for the SSE line parser. */
type SSEParserState = {
  eventType: string;
  dataLines: string[];
};

/** Process a single SSE line, dispatching complete events via callback. */
function feedSSELine(
  line: string,
  state: SSEParserState,
  onEvent: (type: string, data: string) => void
): void {
  if (line.startsWith("event:")) {
    const value = line.slice(6);
    state.eventType = value.startsWith(" ") ? value.slice(1) : value;
  } else if (line.startsWith("data:")) {
    const value = line.slice(5);
    state.dataLines.push(value.startsWith(" ") ? value.slice(1) : value);
  } else if (line === "" && state.dataLines.length > 0) {
    onEvent(state.eventType, state.dataLines.join("\n"));
    state.eventType = "";
    state.dataLines = [];
  }
}

/**
 * Consume SSE events from an upstream Spotlight server and print them.
 *
 * Bun doesn't have a global `EventSource`, so we use `fetch` with a
 * streaming body and parse the SSE wire format manually.
 */
async function consumeSSE(
  url: string,
  activeFilters: ReadonlySet<FilterValue>,
  signal: AbortSignal,
  quiet = false
): Promise<void> {
  const res = await fetch(`${url}/stream`, {
    headers: { Accept: "text/event-stream" },
    signal,
  });
  if (!res.body) {
    return;
  }

  // In quiet mode we still consume the stream to detect disconnection,
  // but skip parsing/formatting entirely.
  if (quiet) {
    for await (const _chunk of res.body) {
      // drain
    }
    return;
  }

  const decoder = new TextDecoder();
  const state: SSEParserState = { eventType: "", dataLines: [] };
  const onEvent = (type: string, data: string) => {
    if (type === SENTRY_CONTENT_TYPE) {
      processSSEEvent(data, activeFilters);
    }
  };

  let partial = "";
  for await (const chunk of res.body) {
    const text =
      partial + decoder.decode(chunk as Uint8Array, { stream: true });
    const lines = text.split("\n");
    partial = lines.pop() ?? "";
    for (const rawLine of lines) {
      feedSSELine(rawLine.replace(CR_RE, ""), state, onEvent);
    }
  }
  if (partial) {
    feedSSELine(partial.replace(CR_RE, ""), state, onEvent);
  }
}

/** Parse and format a single SSE data payload from upstream. */
function processSSEEvent(
  data: string,
  activeFilters: ReadonlySet<FilterValue>
): void {
  try {
    const envelope = JSON.parse(data) as [
      Record<string, unknown>,
      [{ type?: string }, unknown][],
    ];
    const [header, items] = envelope;
    for (const [itemHeader, itemPayload] of items) {
      if (!isItemIncluded(itemHeader.type, activeFilters)) {
        continue;
      }
      for (const line of formatItem(
        itemHeader.type,
        itemPayload as Record<string, unknown>,
        header,
        itemHeader.type ?? "envelope"
      )) {
        logger.log(line);
      }
    }
  } catch (err) {
    logger.debug(
      `Failed to parse SSE event: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

export const serverCommand = buildCommand({
  docs: {
    brief: "Run a local Spotlight server to capture dev SDK events",
    fullDescription:
      "Start a local Spotlight-compatible server, or attach to one\n" +
      "already running on the same port.\n\n" +
      "Spotlight is Sentry for Development — it gives you a live view of\n" +
      "errors, traces, and logs emitted by Sentry SDKs in your dev stack.\n\n" +
      "If a server is already listening on the port, the command connects\n" +
      "as an SSE consumer and tails events from it. Otherwise it starts\n" +
      "its own server.\n\n" +
      "Press Ctrl-C to stop.",
  },
  parameters: {
    flags: {
      port: {
        kind: "parsed",
        parse: parsePort,
        brief: `Port to listen on (default ${DEFAULT_PORT})`,
        default: String(DEFAULT_PORT),
      },
      host: {
        kind: "parsed",
        parse: String,
        brief: "Hostname to bind to (default localhost)",
        default: "localhost",
      },
      quiet: {
        kind: "boolean",
        brief: "Suppress per-envelope tail output",
        default: false,
      },
      filter: {
        kind: "parsed",
        parse: parseFilter,
        brief:
          "Only show items of this type (repeatable: error, transaction, log)",
        variadic: true,
        optional: true,
      },
    },
    aliases: {
      p: "port",
      H: "host",
      q: "quiet",
      f: "filter",
    },
  },
  auth: false,
  async *func(this: SentryContext, flags: LocalFlags) {
    const activeFilters = new Set(flags.filter);
    const url = `http://${flags.host}:${flags.port}`;

    if (await isServerRunning(url)) {
      logger.info(`Connected to existing server at ${bold(url)}`);
      if (activeFilters.size > 0) {
        logger.info(`Filtering: ${[...activeFilters].join(", ")}`);
      }
      logger.info("Press Ctrl-C to stop.");

      const ac = new AbortController();
      const stop = () => ac.abort();
      process.once("SIGINT", stop);
      process.once("SIGTERM", stop);

      // Connect to the SSE stream even in quiet mode so we detect when
      // the upstream server disconnects (the for-await loop exits).
      await consumeSSE(url, activeFilters, ac.signal, flags.quiet).catch(
        (err: unknown) => {
          if (!(err instanceof DOMException && err.name === "AbortError")) {
            throw err;
          }
        }
      );
      logger.log("Disconnected.");
      return;
    }

    const buffer = createSpotlightBuffer(BUFFER_SIZE);

    if (!flags.quiet) {
      buffer.subscribe((container) => {
        for (const line of formatEnvelopeLines(container, activeFilters)) {
          logger.log(line);
        }
      });
    }

    const app = buildApp(buffer);

    const { server, port: boundPort } = await tryListen(
      app,
      flags.port,
      flags.host
    );

    const listenUrl = `http://${flags.host}:${boundPort}`;
    logger.info(`Listening on ${bold(listenUrl)}`);
    if (activeFilters.size > 0) {
      logger.info(`Filtering: ${[...activeFilters].join(", ")}`);
    }
    logger.info("Press Ctrl-C to stop.");

    await waitForShutdown(server);
    logger.log("Server stopped.");
  },
});
