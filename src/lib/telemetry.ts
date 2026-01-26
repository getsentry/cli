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

/**
 * Build-time constants injected by esbuild/bun.
 * These are undefined when running unbundled in development.
 */
declare const SENTRY_DSN_BUILD: string | undefined;
declare const SENTRY_CLI_VERSION: string | undefined;

/** Environment variable to disable telemetry */
export const TELEMETRY_ENV_VAR = "SENTRY_CLI_NO_TELEMETRY";

/** CLI flag to disable telemetry */
export const TELEMETRY_FLAG = "--no-telemetry";

/**
 * Wrap CLI execution with telemetry tracking.
 *
 * Creates a Sentry session and span for the command execution.
 * Captures any unhandled exceptions and reports them.
 *
 * @param enabled - Whether telemetry is enabled
 * @param callback - The CLI execution function to wrap
 * @returns The result of the callback
 */
export async function withTelemetry<T>(
  enabled: boolean,
  callback: () => T | Promise<T>
): Promise<T> {
  const client = initSentry(enabled);

  // If Sentry is not enabled, just run the callback
  if (!client?.getOptions().enabled) {
    return callback();
  }

  Sentry.startSession();
  Sentry.captureSession();

  try {
    return await Sentry.startSpan(
      { name: "cli-execution", op: "cli.command" },
      async () => callback()
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
 * Initialize Sentry for telemetry.
 *
 * @param enabled - Whether telemetry is enabled
 * @returns The Sentry client, or undefined if initialization failed
 *
 * @internal Exported for testing
 */
export function initSentry(enabled: boolean): Sentry.NodeClient | undefined {
  // Build-time constants are undefined when running unbundled in development
  const dsn =
    typeof SENTRY_DSN_BUILD !== "undefined" ? SENTRY_DSN_BUILD : undefined;
  const version =
    typeof SENTRY_CLI_VERSION !== "undefined" ? SENTRY_CLI_VERSION : undefined;

  const client = Sentry.init({
    dsn,
    enabled,
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

  if (client?.getOptions().enabled) {
    // Set global tags for all events
    Sentry.setTag("platform", process.platform);
    Sentry.setTag("arch", process.arch);
    Sentry.setTag("node", process.version);
  }

  return client;
}

/**
 * Check if telemetry is enabled based on environment variable.
 *
 * Note: The --no-telemetry flag is handled separately in bin.ts before
 * arguments are passed to stricli.
 *
 * @returns true if telemetry is enabled, false if disabled via env var
 */
export function isTelemetryEnabled(): boolean {
  return process.env[TELEMETRY_ENV_VAR] !== "1";
}
