export const MASTRA_API_URL =
  process.env.SENTRY_WIZARD_API_URL ?? "http://localhost:4111";

export const WORKFLOW_ID = "sentry-wizard";

export const MAX_FILE_BYTES = 262144; // 256KB per file
export const MAX_STDOUT_BYTES = 65536; // 64KB stdout/stderr truncation
export const DEFAULT_COMMAND_TIMEOUT_MS = 120000; // 2 minutes
