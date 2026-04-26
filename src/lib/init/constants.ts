export const INIT_API_URL =
  process.env.SENTRY_INIT_API_URL ??
  process.env.INIT_API_URL ??
  "https://sentry-init-agent.vercel.app";

/**
 * Initial-handshake timeout for `GET /api/init/:runId/stream`. The body
 * is a long-lived NDJSON stream that may go idle for minutes between
 * events; the runner handles that via reconnect (`MAX_STREAM_RECONNECTS`),
 * so this only protects the request *connect* phase.
 */
export const STREAM_CONNECT_TIMEOUT_MS = 30_000;

/** How many consecutive zero-event reconnects before we give up. */
export const MAX_STREAM_RECONNECTS = 5;

export const SENTRY_DOCS_URL = "https://docs.sentry.io/platforms/";

export const MAX_FILE_BYTES = 262_144; // 256KB per file
export const MAX_OUTPUT_BYTES = 65_536; // 64KB stdout/stderr truncation
export const DEFAULT_COMMAND_TIMEOUT_MS = 120_000; // 2 minutes
export const API_TIMEOUT_MS = 120_000; // 2 minutes timeout for API calls

// The feature that is always included in every setup
export const REQUIRED_FEATURE = "errorMonitoring";
