export const INIT_API_URL =
  process.env.INIT_API_URL ?? "https://sentry-init-agent.getsentry.workers.dev";

export const SENTRY_DOCS_URL = "https://docs.sentry.io/platforms/";

export const MAX_FILE_BYTES = 262_144; // 256KB per file
export const MAX_OUTPUT_BYTES = 65_536; // 64KB stdout/stderr truncation
export const DEFAULT_COMMAND_TIMEOUT_MS = 120_000; // 2 minutes
export const API_TIMEOUT_MS = 120_000; // 2 minutes timeout for init API calls
export const STREAM_CONNECT_TIMEOUT_MS = 30_000; // 30 seconds to establish/re-establish the stream
export const MAX_STREAM_RECONNECTS = 8;

// Exit codes returned by the remote workflow
export const EXIT_PLATFORM_NOT_DETECTED = 20;
export const EXIT_DEPENDENCY_INSTALL_FAILED = 30;
export const EXIT_VERIFICATION_FAILED = 50;

// The feature that is always included in every setup
export const REQUIRED_FEATURE = "errorMonitoring";
