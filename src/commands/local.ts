/**
 * sentry local
 *
 * Run a local Spotlight-compatible server.
 *
 * Spotlight (https://spotlightjs.com/) is "Sentry for Development" — a small
 * local proxy that ingests Sentry envelopes from SDKs running in your dev
 * stack and surfaces them in real time.
 *
 * This command starts a minimal Hono HTTP server that:
 *
 * 1. Accepts envelopes from Sentry SDKs at the standard endpoints:
 *      - `POST /stream` (Spotlight-compatible)
 *      - `POST /api/{projectId}/envelope/` (Sentry SDK ingest path)
 * 2. Pushes them into the buffer provided by `@spotlightjs/spotlight/sdk`,
 *    which lazily parses each envelope.
 * 3. Streams new envelopes back to subscribers via Server-Sent Events at
 *    `GET /stream` — compatible with the Spotlight overlay/UI.
 * 4. Tails events to the terminal as they arrive so you can see what your
 *    app is sending without leaving the CLI.
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
import type { SentryContext } from "../context.js";
import { buildCommand, numberParser } from "../lib/command.js";
import { ValidationError } from "../lib/errors.js";
import {
  bold,
  cyan,
  green,
  magenta,
  muted,
  red,
  yellow,
} from "../lib/formatters/colors.js";
import { logger } from "../lib/logger.js";

/** Default port matches Spotlight's `DEFAULT_PORT`. */
const DEFAULT_PORT = 8969;

/** Buffer size: how many recent envelopes to retain for late subscribers. */
const BUFFER_SIZE = 500;

/** Canonical content type for Sentry envelopes. */
const SENTRY_CONTENT_TYPE = "application/x-sentry-envelope";

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

/**
 * Build the Hono application.
 *
 * CORS is open to `*` because dev stacks send from arbitrary `localhost:*`
 * origins (Vite, Next, Astro, etc.) and we only bind to localhost.
 */
function buildApp(
  spotlightBuffer: ReturnType<typeof createSpotlightBuffer>,
  onEnvelope?: (contentType: string, data: Buffer) => void
): Hono {
  const app = new Hono();

  app.use(
    "*",
    cors({
      origin: "*",
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
    const arrayBuf = await c.req.arrayBuffer();
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

    const container = pushToSpotlightBuffer({
      spotlightBuffer,
      body,
      encoding: contentEncoding,
      contentType,
      userAgent,
    });

    if (container) {
      onEnvelope?.(container.getContentType(), container.getData());
    }

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

      stream.onAbort(() => {
        spotlightBuffer.unsubscribe(readerId);
      });

      await new Promise<void>((resolve) => {
        stream.onAbort(() => resolve());
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

/** Level → color map for tail output. */
const LEVEL_COLORS: Record<string, (s: string) => string> = {
  error: (s) => red(bold(s)),
  fatal: (s) => red(bold(s)),
  warning: yellow,
  info: cyan,
  trace: green,
  debug: muted,
};

/** Colorize a log/event level label. */
function colorLevel(level: string): string {
  const colorFn = LEVEL_COLORS[level];
  return colorFn ? colorFn(level) : level;
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

/**
 * Infer the source platform from the envelope header's `sdk.name` field.
 * Returns a short colored label like "server", "browser", or "mobile".
 */
function inferSource(header: Record<string, unknown>): string {
  const sdk = header.sdk as { name?: string } | undefined;
  const name = sdk?.name ?? "";
  if (MOBILE_MARKERS.some((m) => name.includes(m))) {
    return magenta("mobile");
  }
  if (
    name.startsWith("sentry.javascript.") &&
    !SERVER_JS_MARKERS.some((m) => name.includes(m))
  ) {
    return yellow("browser");
  }
  return cyan("server");
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
      ? `${frame.filename}:${frame.lineno}:${frame.colno}`
      : `${frame.filename}:${frame.lineno}`;
    hint += ` ${muted(`[${loc}]`)}`;
  }
  if (frame.function) {
    hint += ` ${muted(`[${frame.function}]`)}`;
  }
  return hint;
}

/**
 * Format an error event item into a colored one-liner.
 *
 * Output: `HH:MM:SS  error  server  TypeError: x is not a function [file.ts:42:5] [handleRequest]`
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
  const first = exception?.values?.[0];
  const errorType = first?.type ?? "Error";
  const errorValue =
    first?.value ?? (event.message as string | undefined) ?? "Unknown error";

  let msg = `${errorType}: ${errorValue}`;

  const frames = first?.stacktrace?.frames;
  if (frames?.length) {
    msg += formatFrameHint(frames);
  }

  const ts = formatTime(event.timestamp as number | undefined);
  return `${muted(ts)}  ${colorLevel("error")}  ${inferSource(header)}  ${msg}`;
}

/**
 * Format a transaction event item into a colored one-liner.
 *
 * Output: `HH:MM:SS  trace  browser  [http.client] GET /api/users [245ms] [3 spans]`
 */
function formatTransactionItem(
  event: Record<string, unknown>,
  header: Record<string, unknown>
): string {
  const trace = (event.contexts as Record<string, unknown> | undefined)
    ?.trace as
    | { op?: string; status?: string; description?: string }
    | undefined;
  let msg =
    (event.transaction as string) ?? trace?.description ?? "Transaction";

  const op = trace?.op;
  if (op && op !== "default" && op !== "unknown") {
    msg = `[${op}] ${msg}`;
  }

  const start = event.start_timestamp as number | undefined;
  const end = event.timestamp as number | undefined;
  if (start !== undefined && end !== undefined) {
    const durationMs = Math.round((end - start) * 1000);
    msg += ` ${muted(`[${durationMs}ms]`)}`;
  }

  const status = trace?.status;
  if (status && status !== "ok") {
    msg += ` ${muted(`[${status}]`)}`;
  }

  const spans = event.spans as unknown[] | undefined;
  if (spans?.length) {
    msg += ` ${muted(`[${spans.length} span${spans.length === 1 ? "" : "s"}]`)}`;
  }

  const ts = formatTime(event.timestamp as number | undefined);
  return `${muted(ts)}  ${colorLevel("trace")}  ${inferSource(header)}  ${msg}`;
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
  let msg = logEntry.body ?? "";

  if (logEntry.attributes) {
    const attrs = Object.entries(logEntry.attributes)
      .filter(
        ([k, v]) =>
          !k.startsWith("sentry.") && v.value !== null && v.value !== undefined
      )
      .map(([k, v]) => `${k}=${v.value}`);
    if (attrs.length > 0) {
      msg += ` ${muted(`[${attrs.join(", ")}]`)}`;
    }
  }

  const ts = formatTime(logEntry.timestamp);
  return `${muted(ts)}  ${colorLevel(level)}  ${source}  ${msg}`;
}

/**
 * Format a log event item. A log envelope item contains an `items` array
 * of individual log entries; each gets its own line.
 *
 * Output: `HH:MM:SS  info  server  User logged in [user_id=1234]`
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

/** Maximum number of consecutive ports to try before giving up. */
const MAX_PORT_ATTEMPTS = 10;

/**
 * Try to start the HTTP server, auto-incrementing the port on EADDRINUSE.
 *
 * `@hono/node-server`'s `serve()` calls `server.listen()` synchronously and
 * returns immediately — the actual bind happens asynchronously. We wrap it in
 * a Promise that resolves on the `listening` event and rejects on `error`.
 * When the port is busy we bump the port number and retry up to
 * {@link MAX_PORT_ATTEMPTS} times, warning the user on each bump.
 */
function tryListen(
  app: Hono,
  startPort: number,
  hostname: string
): Promise<{ server: Server; port: number }> {
  let port = startPort;
  let attempts = 0;

  const attempt = (): Promise<{ server: Server; port: number }> =>
    new Promise((resolve, reject) => {
      const server = serve({
        fetch: app.fetch,
        port,
        hostname,
      }) as unknown as Server;

      server.once("listening", () => resolve({ server, port }));
      server.once("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "EADDRINUSE") {
          attempts += 1;
          if (attempts >= MAX_PORT_ATTEMPTS) {
            reject(
              new ValidationError(
                `Port ${startPort} is in use and no open port found after ${MAX_PORT_ATTEMPTS} attempts`,
                "port"
              )
            );
            return;
          }
          logger.warn(`Port ${port} is in use, trying ${port + 1}...`);
          port += 1;
          resolve(attempt());
          return;
        }
        reject(err);
      });
    });

  return attempt();
}

export const localCommand = buildCommand({
  docs: {
    brief: "Run a local Spotlight server to capture dev SDK events",
    fullDescription:
      "Start a local Spotlight-compatible server.\n\n" +
      "Spotlight is Sentry for Development — it gives you a live view of\n" +
      "errors, traces, and logs emitted by Sentry SDKs in your dev stack.\n" +
      "This command runs a minimal Hono server that ingests envelopes\n" +
      "from any Sentry SDK and tails them to your terminal.\n\n" +
      "Endpoints:\n" +
      "  POST /stream                          — Spotlight ingest\n" +
      "  POST /api/{projectId}/envelope/       — Sentry SDK ingest\n" +
      "  GET  /stream                          — SSE feed (for the Spotlight overlay)\n" +
      "  GET  /health                          — health check\n\n" +
      "Learn more: https://spotlightjs.com/docs/getting-started/\n\n" +
      "Press Ctrl-C to stop the server.",
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
    const buffer = createSpotlightBuffer(BUFFER_SIZE);
    const activeFilters = new Set(flags.filter);

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

    const url = `http://${flags.host}:${boundPort}`;
    logger.info(`Listening on ${bold(url)}`);
    if (activeFilters.size > 0) {
      logger.info(`Filtering: ${[...activeFilters].join(", ")}`);
    }
    logger.info(
      `Learn more about Spotlight: ${bold("https://spotlightjs.com/docs/getting-started/")}`
    );
    logger.info("Press Ctrl-C to stop.");

    await waitForShutdown(server);
    logger.log("Server stopped.");
  },
});
