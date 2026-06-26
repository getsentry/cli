/**
 * Sentry init gateway. A thin authenticated Cloudflare Worker that forwards
 * model traffic to the Vercel AI Gateway. The local Claude Agent SDK points
 * its `ANTHROPIC_BASE_URL` at `${gateway}${SENTRY_INIT_ANTHROPIC_PATH}` and
 * authenticates with the user's Sentry token.
 */
export const SENTRY_INIT_GATEWAY_URL =
  process.env.SENTRY_INIT_GATEWAY_URL ??
  process.env.MASTRA_API_URL ??
  "https://sentry-init-agent.getsentry.workers.dev";

/** Path on the gateway that proxies the Anthropic Messages API. */
export const SENTRY_INIT_ANTHROPIC_PATH = "/anthropic";

/**
 * Version of `@anthropic-ai/claude-agent-sdk` the CLI is built against. The
 * SDK's JS is bundled at build time, but its per-platform native `claude`
 * runtime (~62 MB download / ~210 MB on disk) is not — it's fetched on first
 * `init` and cached. This must stay in sync with the devDependency version so
 * the cached runtime matches the bundled SDK. Keep them updated together.
 */
export const CLAUDE_AGENT_SDK_VERSION = "0.3.191";

/** Full base URL the Claude Agent SDK should use for model requests. */
export const SENTRY_INIT_ANTHROPIC_BASE_URL = new URL(
  SENTRY_INIT_ANTHROPIC_PATH,
  SENTRY_INIT_GATEWAY_URL
).href;

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
