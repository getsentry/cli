export const INIT_API_URL =
  process.env.SENTRY_INIT_API_URL ??
  process.env.INIT_API_URL ??
  "https://sentry-init-agent.vercel.app";

/**
 * Initial-handshake timeout for `GET /api/init/:runId/stream` and
 * `GET /api/init/:runId` (status). The stream body is a long-lived
 * NDJSON pipe that idles for minutes between events; the runner
 * handles that via the `handleStreamClosure` -> status check ->
 * `resumeRun` loop, so this only protects the request *connect* phase.
 */
export const STREAM_CONNECT_TIMEOUT_MS = 30_000;

/**
 * Maximum consecutive failures of `GET /api/init/:runId` (the status
 * endpoint) before we give up. Stream drops themselves are normal and
 * NOT counted: they flow into `handleStreamClosure` which fetches
 * status, branches on running/completed/failed/cancelled, and
 * reconnects when appropriate. Mirrors birthday-card-generator's
 * `maxConsecutiveErrors: 5` on `WorkflowChatTransport`.
 */
export const MAX_STATUS_FAILURES = 5;

/**
 * Cap exponential backoff between status-failure reconnect attempts so
 * we don't sleep for minutes after a flake.
 */
export const MAX_RECONNECT_DELAY_MS = 30_000;

export const SENTRY_DOCS_URL = "https://docs.sentry.io/platforms/";

export const MAX_FILE_BYTES = 262_144; // 256KB per file
export const MAX_OUTPUT_BYTES = 65_536; // 64KB stdout/stderr truncation
export const DEFAULT_COMMAND_TIMEOUT_MS = 120_000; // 2 minutes
export const API_TIMEOUT_MS = 120_000; // 2 minutes timeout for API calls

// The feature that is always included in every setup
export const REQUIRED_FEATURE = "errorMonitoring";
