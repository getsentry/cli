export const DEFAULT_MASTRA_API_URL =
  "https://sentry-init-agent.getsentry.workers.dev";

export const MASTRA_API_URL =
  process.env.MASTRA_API_URL ?? DEFAULT_MASTRA_API_URL;

export const WORKFLOW_ID = "sentry-wizard";

// --- Canary: Cloudflare Durable Object agent (new transport) ---
// The DO agent runs server-side as a separate Worker; the CLI talks to it over
// a resilient WebSocket. This coexists with the Mastra path for gradual rollout.
export const DEFAULT_INIT_AGENT_DO_URL =
  "wss://sentry-init-agent-do.getsentry.workers.dev";

export const INIT_AGENT_DO_URL =
  process.env.SENTRY_INIT_AGENT_DO_URL ?? DEFAULT_INIT_AGENT_DO_URL;

/**
 * Percentage (0-100) of runs routed to the DO agent. `SENTRY_INIT_AGENT_DO=1`
 * forces it on; `=0` forces off. Default 0 (Mastra) until the canary ramps.
 */
export function agentDoTrafficPercent(): number {
  const raw = process.env.SENTRY_INIT_AGENT_DO_PERCENT;
  if (raw === undefined) {
    return 0;
  }
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 0;
}

export const SENTRY_DOCS_URL = "https://docs.sentry.io/platforms/";

export const MAX_FILE_BYTES = 262_144; // 256KB per file
export const MAX_OUTPUT_BYTES = 65_536; // 64KB stdout/stderr truncation
export const DEFAULT_COMMAND_TIMEOUT_MS = 120_000; // 2 minutes
export const API_TIMEOUT_MS = 180_000; // 3 minutes timeout for Mastra API calls

// Exit codes returned by the remote workflow.
// These are internal to the workflow protocol — they're mapped to EXIT.*
// constants (from src/lib/errors.ts) before reaching process exit.
export const EXIT_PLATFORM_NOT_DETECTED = 20;
export const EXIT_DEPENDENCY_INSTALL_FAILED = 30;
export const EXIT_VERIFICATION_FAILED = 50;

// Step ID used in dry-run special-case logic
export const VERIFY_CHANGES_STEP = "verify-changes";

// The feature that is always included in every setup
export const REQUIRED_FEATURE = "errorMonitoring";
