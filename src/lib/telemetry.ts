/**
 * Telemetry for Sentry CLI
 *
 * Tracks anonymous usage data to improve the CLI:
 * - Command execution (which commands run, success/failure)
 * - Error tracking (unhandled exceptions)
 * - Performance (command duration)
 *
 * No PII is collected. Opt-out via:
 * - SENTRY_CLI_NO_TELEMETRY=1 environment variable
 * - --no-telemetry flag
 */

// biome-ignore lint/performance/noNamespaceImport: Sentry SDK recommends namespace import
import * as Sentry from "@sentry/node";

/** Environment variable to disable telemetry */
export const TELEMETRY_ENV_VAR = "SENTRY_CLI_NO_TELEMETRY";

/** CLI flag to disable telemetry */
export const TELEMETRY_FLAG = "--no-telemetry";

export type TelemetryOptions = {
  /** Whether telemetry is enabled */
  enabled: boolean;
  /** Command being executed (e.g., "auth.login", "issue.list") */
  command: string;
};

/**
 * Wrap CLI execution with telemetry tracking.
 *
 * Creates a Sentry session and span for the command execution.
 * Captures any unhandled exceptions and reports them.
 *
 * @param options - Telemetry configuration
 * @param callback - The CLI execution function to wrap
 * @returns The result of the callback
 */
export async function withTelemetry<T>(
  options: TelemetryOptions,
  callback: () => T | Promise<T>
): Promise<T> {
  const client = initSentry(options.enabled);

  // If telemetry is disabled or initialization failed, just run the callback
  if (!client) {
    return callback();
  }

  Sentry.startSession();
  Sentry.captureSession();

  try {
    return await Sentry.startSpan(
      { name: "cli-execution", op: "cli.command" },
      async () => {
        Sentry.setTag("command", options.command);
        return await callback();
      }
    );
  } catch (e) {
    Sentry.captureException(e);
    const session = Sentry.getCurrentScope().getSession();
    if (session) {
      session.status = "crashed";
    }
    throw e;
  } finally {
    Sentry.endSession();
    // Flush with a timeout to ensure events are sent before process exits
    try {
      await client.flush(3000);
    } catch {
      // Ignore flush errors - telemetry should never block CLI
    }
  }
}

/**
 * Safely get a build-time constant that may not be defined in development.
 * Build-time constants are injected by esbuild/bun during the build process.
 */
function getBuildConstant(name: string): string | undefined {
  try {
    // Use indirect eval to check if the constant exists at runtime
    // This avoids ReferenceError when running unbundled in development
    // biome-ignore lint/security/noGlobalEval: required for build-time constant detection
    return eval(name) as string | undefined;
  } catch {
    return;
  }
}

/**
 * Initialize Sentry for telemetry.
 *
 * @param enabled - Whether telemetry is enabled
 * @returns The Sentry client, or undefined if disabled/unavailable
 */
function initSentry(enabled: boolean): Sentry.NodeClient | undefined {
  const dsn = getBuildConstant("SENTRY_DSN_BUILD");
  const version = getBuildConstant("SENTRY_CLI_VERSION");

  // Don't initialize if disabled or no DSN configured
  if (!(enabled && dsn)) {
    return;
  }

  const client = Sentry.init({
    dsn,
    enabled: true,
    // Minimal integrations for CLI - we don't need most Node.js integrations
    defaultIntegrations: false,
    integrations: [Sentry.httpIntegration()],
    environment: "production",
    // Sample all events for CLI telemetry (low volume)
    tracesSampleRate: 1,
    sampleRate: 1,
    release: version,
    // Don't propagate traces to external services
    tracePropagationTargets: [],

    beforeSendTransaction: (event) => {
      // Remove server_name which may contain hostname (PII)
      event.server_name = undefined;
      return event;
    },

    beforeSend: (event) => {
      // Remove stack traces which may contain local file paths (PII)
      for (const exception of event.exception?.values ?? []) {
        exception.stacktrace = undefined;
      }
      // Remove server_name which may contain hostname (PII)
      event.server_name = undefined;
      return event;
    },
  });

  // Set global tags for all events
  Sentry.setTag("platform", process.platform);
  Sentry.setTag("arch", process.arch);
  Sentry.setTag("node", process.version);

  // Detect if running as compiled binary (Single Executable Application)
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const sea = require("node:sea") as { isSea: () => boolean };
    Sentry.setTag("is_binary", sea.isSea());
  } catch {
    Sentry.setTag("is_binary", false);
  }

  return client;
}

/**
 * Check if telemetry is enabled based on environment variable.
 *
 * @returns true if telemetry is enabled, false if disabled via env var
 */
export function isTelemetryEnabled(): boolean {
  return process.env[TELEMETRY_ENV_VAR] !== "1";
}

/**
 * Extract command name from CLI arguments.
 *
 * Takes the first 1-2 positional arguments (non-flag arguments)
 * and joins them with a dot to form the command name.
 *
 * @param args - CLI arguments (without the node/bun executable and script path)
 * @returns Command name (e.g., "auth.login", "issue.list", "org")
 *
 * @example
 * extractCommand(["auth", "login", "--timeout", "60"]) // "auth.login"
 * extractCommand(["issue", "list"]) // "issue.list"
 * extractCommand(["org"]) // "org"
 * extractCommand(["--help"]) // "unknown"
 */
export function extractCommand(args: string[]): string {
  const positional = args.filter((a) => !a.startsWith("-"));
  const command = positional.slice(0, 2).join(".");
  return command || "unknown";
}
