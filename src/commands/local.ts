/**
 * sentry local
 *
 * Run a local Spotlight-compatible sidecar server.
 *
 * Spotlight (https://github.com/getsentry/spotlight) is "Sentry for
 * Development" — a small local proxy that ingests Sentry envelopes from
 * SDKs running in your dev stack and surfaces them in real time.
 *
 * This command starts a minimal Hono HTTP server that:
 *
 * 1. Accepts envelopes from Sentry SDKs at the standard sidecar endpoints:
 *      - `POST /stream` (Spotlight-compatible)
 *      - `POST /api/{projectId}/envelope/` (Sentry SDK ingest path)
 * 2. Pushes them into the buffer provided by `@spotlightjs/spotlight/sdk`,
 *    which lazily parses each envelope.
 * 3. Streams new envelopes back to subscribers via Server-Sent Events at
 *    `GET /stream` — compatible with the Spotlight overlay/UI.
 * 4. Tails events to the terminal as they arrive so you can see what your
 *    app is sending without leaving the CLI.
 *
 * To point your SDK at the local sidecar, use a placeholder DSN that
 * resolves to localhost — for example:
 *
 *   SENTRY_DSN=http://public@localhost:8969/1
 *
 * Or configure your SDK's transport to send to `http://localhost:8969/stream`.
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
import { openOrShowUrl } from "../lib/browser.js";
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

const log = logger.withTag("local");

/** Default port matches Spotlight's `DEFAULT_PORT`. */
const DEFAULT_PORT = 8969;

/** Buffer size: how many recent envelopes to retain for late subscribers. */
const BUFFER_SIZE = 500;

/** SSE event payload — what we send to GET /stream subscribers. */
type EventPayload = {
  contentType: string;
  data: string; // base64-encoded raw envelope bytes
};

type LocalFlags = {
  readonly port: number;
  readonly host: string;
  readonly open: boolean;
  readonly quiet: boolean;
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
 * Build the Hono application that backs the sidecar.
 *
 * We expose three concerns:
 *  - CORS: open to `*` because dev stacks send from arbitrary `localhost:*`
 *    origins (Vite, Next, Astro, etc.). The sidecar binds to localhost by
 *    default, so this isn't a security regression.
 *  - Ingest: `POST /stream` and `POST /api/.../envelope/` accept envelope
 *    bodies. We hand the raw buffer to `pushToSpotlightBuffer`, which
 *    decompresses (gzip/deflate/br) and decodes lazily.
 *  - Subscribe: `GET /stream` opens an SSE stream of every envelope that
 *    enters the buffer, including those buffered before the subscriber
 *    connected (so a freshly-opened Spotlight overlay can still see
 *    recent events).
 */
function buildSidecarApp(
  spotlightBuffer: ReturnType<typeof createSpotlightBuffer>,
  onEnvelope: (contentType: string, data: Buffer) => void
): Hono {
  const app = new Hono();

  // Open CORS — sidecar binds to localhost; this is a dev-only tool.
  app.use(
    "*",
    cors({
      origin: "*",
      allowMethods: ["GET", "POST", "OPTIONS"],
      allowHeaders: ["Content-Type", "Content-Encoding", "User-Agent"],
    })
  );

  /** Health check — useful for `curl` and for SDKs that probe before sending. */
  app.get("/health", (c) => c.text("OK"));

  /** Ingest handler shared by `/stream` and `/api/.../envelope/`. */
  const ingest = async (c: {
    req: {
      arrayBuffer: () => Promise<ArrayBuffer>;
      header: (name: string) => string | undefined;
    };
    body: (data: null, status: number) => Response;
  }) => {
    const arrayBuf = await c.req.arrayBuffer();
    const body = Buffer.from(arrayBuf);
    const contentType = c.req.header("content-type") ?? "";
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
      // Surface the decoded payload to the tail/subscribe pipeline. We push
      // the (potentially decompressed) raw body so SSE subscribers don't
      // have to redo the work and so the tail formatter can rely on a
      // single representation.
      onEnvelope(container.getContentType(), container.getData());
    }

    return c.body(null, 204);
  };

  app.post("/stream", ingest);
  // SDK-style envelope ingestion: /api/{projectId}/envelope/?...
  app.post("/api/:projectId/envelope/", ingest);
  app.post("/api/:projectId/envelope", ingest);

  /**
   * SSE stream — Spotlight overlay / UI clients connect here to receive a
   * live feed of envelopes. Each event is emitted as a JSON object with
   * the content type and base64-encoded body.
   */
  app.get("/stream", (c) =>
    streamSSE(c, async (stream) => {
      // Tie the subscriber lifetime to the response stream. We unsubscribe
      // when the client disconnects so the buffer doesn't leak readers.
      const readerId = spotlightBuffer.subscribe((container) => {
        const payload: EventPayload = {
          contentType: container.getContentType(),
          data: container.getData().toString("base64"),
        };
        stream
          .writeSSE({
            event: "envelope",
            data: JSON.stringify(payload),
          })
          .catch((err: unknown) => {
            log.debug(
              `SSE write failed (client likely disconnected): ${
                err instanceof Error ? err.message : String(err)
              }`
            );
          });
      });

      stream.onAbort(() => {
        spotlightBuffer.unsubscribe(readerId);
      });

      // Keep the stream open until the client disconnects.
      // hono/streaming resolves the promise on abort.
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

/**
 * Format a freshly received envelope for terminal output.
 *
 * For recognized item types (errors, transactions, logs), produces richly
 * colored one-liners with context (stack location, span count, duration,
 * log attributes, etc.). Items without a dedicated formatter (attachments,
 * profiles, sessions, check-ins) fall back to a minimal timestamp + type line.
 */
function formatEnvelopeLines(container: {
  getParsedEnvelope: () => {
    envelope: [Record<string, unknown>, [{ type?: string }, unknown][]];
  } | null;
  getContentType: () => string;
  getEventTypes: () => string[] | null;
}): string[] {
  const parsed = container.getParsedEnvelope();
  if (!parsed) {
    return [formatFallbackLine(resolveUnparseableLabel(container))];
  }

  const [header, items] = parsed.envelope;
  const lines: string[] = [];
  for (const [itemHeader, itemPayload] of items) {
    const itemType = itemHeader.type;
    const payload = itemPayload as Record<string, unknown>;

    if (itemType && ERROR_TYPES.has(itemType)) {
      lines.push(formatErrorItem(payload, header));
    } else if (itemType === "transaction") {
      lines.push(formatTransactionItem(payload, header));
    } else if (itemType === "log") {
      lines.push(...formatLogItem(payload, header));
    } else {
      lines.push(formatFallbackLine(itemType ?? container.getContentType()));
    }
  }

  if (lines.length > 0) {
    return lines;
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
      log.info(`Received ${signal}, shutting down...`);
      server.close(() => resolve());
      // Force-close keep-alive connections so we don't wait on long-lived
      // SSE subscribers.
      if (typeof server.closeAllConnections === "function") {
        server.closeAllConnections();
      }
    };

    process.once("SIGINT", () => shutdown("SIGINT"));
    process.once("SIGTERM", () => shutdown("SIGTERM"));
  });
}

export const localCommand = buildCommand({
  docs: {
    brief: "Run a local Spotlight sidecar to capture dev SDK events",
    fullDescription:
      "Start a local Spotlight-compatible sidecar server.\n\n" +
      "Spotlight is Sentry for Development — it gives you a live view of\n" +
      "errors, traces, and logs emitted by Sentry SDKs in your dev stack.\n" +
      "This command runs a minimal Hono server that ingests envelopes\n" +
      "from any Sentry SDK and tails them to your terminal.\n\n" +
      "Endpoints:\n" +
      "  POST /stream                          — Spotlight ingest\n" +
      "  POST /api/{projectId}/envelope/       — Sentry SDK ingest\n" +
      "  GET  /stream                          — SSE feed (for the Spotlight overlay)\n" +
      "  GET  /health                          — health check\n\n" +
      "Configure your SDK to send to the sidecar with a localhost DSN, e.g.:\n" +
      "  SENTRY_DSN=http://public@localhost:8969/1\n\n" +
      "Press Ctrl-C to stop the server.",
  },
  // No `output` config: this is a long-running server, not a data command.
  // We write progress directly to stderr via the logger.
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
      open: {
        kind: "boolean",
        brief: "Open the sidecar SSE URL in a browser",
        default: false,
      },
      quiet: {
        kind: "boolean",
        brief: "Suppress per-envelope tail output",
        default: false,
      },
    },
    aliases: {
      p: "port",
      H: "host",
      o: "open",
      q: "quiet",
    },
  },
  // No auth required — this is a local-only dev server.
  auth: false,
  async *func(this: SentryContext, flags: LocalFlags) {
    const buffer = createSpotlightBuffer(BUFFER_SIZE);

    // Tail subscriber: pretty-prints each envelope item using Spotlight's
    // human formatters. Routes through the logger (stderr) so the tail
    // doesn't pollute pipelines that consume the CLI's stdout, and
    // honors `--log-level` / `SENTRY_LOG_LEVEL` like the rest of the CLI.
    // Skipped entirely when `--quiet` is set.
    if (!flags.quiet) {
      buffer.subscribe((container) => {
        for (const line of formatEnvelopeLines(container)) {
          log.info(line);
        }
      });
    }

    const app = buildSidecarApp(buffer, () => {
      // Tail output is driven by the buffer subscriber above so we don't
      // have to repeat the formatting work. This callback is a no-op for
      // now; future hooks (e.g. metrics, file logging) can plug in here.
    });

    // `serve` returns a Node http.Server — we use it for graceful shutdown.
    const server = serve({
      fetch: app.fetch,
      port: flags.port,
      hostname: flags.host,
    }) as unknown as Server;

    const url = `http://${flags.host}:${flags.port}`;
    log.info(`Spotlight sidecar listening on ${bold(url)}`);
    log.info(`  ${muted("Ingest:")} POST ${url}/stream`);
    log.info(`  ${muted("Stream:")} GET  ${url}/stream`);
    log.info(`  ${muted("Health:")} GET  ${url}/health`);
    log.info(`Point your SDK at ${bold(`${url}/stream`)} or use a DSN like:`);
    log.info(
      `  ${muted(`SENTRY_DSN=${url.replace("http://", "http://public@")}/1`)}`
    );
    log.info("Press Ctrl-C to stop.");

    if (flags.open) {
      // Best-effort — never blocks shutdown.
      await openOrShowUrl(`${url}/stream`);
    }

    // Block until the user interrupts. We don't yield any CommandOutput
    // because there's no structured payload — this command is a server.
    await waitForShutdown(server);
    log.info("Sidecar stopped.");
  },
});
