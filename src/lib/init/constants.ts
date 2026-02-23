export const MASTRA_API_URL =
  process.env.SENTRY_WIZARD_API_URL ??
  "http://sentry-init-agent.getsentry.workers.dev";

export const WORKFLOW_ID = "sentry-wizard";

export const SENTRY_DOCS_URL = "https://docs.sentry.io/platforms/";

export const MAX_FILE_BYTES = 262_144; // 256KB per file
export const MAX_STDOUT_BYTES = 65_536; // 64KB stdout/stderr truncation
export const DEFAULT_COMMAND_TIMEOUT_MS = 120_000; // 2 minutes
