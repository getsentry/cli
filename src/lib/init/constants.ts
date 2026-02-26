export const MASTRA_API_URL =
  process.env.SENTRY_WIZARD_API_URL ??
  "https://sentry-init-agent.getsentry.workers.dev";

export const WORKFLOW_ID = "sentry-wizard";

export const SENTRY_DOCS_URL = "https://docs.sentry.io/platforms/";

export const MAX_FILE_BYTES = 262_144; // 256KB per file
export const MAX_OUTPUT_BYTES = 65_536; // 64KB stdout/stderr truncation
export const DEFAULT_COMMAND_TIMEOUT_MS = 120_000; // 2 minutes

// Exit codes returned by the remote workflow
export const EXIT_SENTRY_ALREADY_INSTALLED = 10;
export const EXIT_PLATFORM_NOT_DETECTED = 20;
export const EXIT_DEPENDENCY_INSTALL_FAILED = 30;
export const EXIT_VERIFICATION_FAILED = 50;

// Step ID used in dry-run special-case logic
export const VERIFY_CHANGES_STEP = "verify-changes";

// The feature that is always included in every setup
export const REQUIRED_FEATURE = "errorMonitoring";
