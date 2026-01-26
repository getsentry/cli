/**
 * Telemetry for Sentry CLI
 *
 * Tracks anonymous usage data to improve the CLI:
 * - Command execution (which commands run, success/failure)
 * - Error tracking (unhandled exceptions)
 * - Performance (command duration)
 *
 * No PII is collected. Opt-out via SENTRY_CLI_NO_TELEMETRY=1 environment variable.
 */

// biome-ignore lint/performance/noNamespaceImport: Sentry SDK recommends namespace import
import * as Sentry from "@sentry/node";
import { SENTRY_CLI_DSN } from "./constants.js";

/**
 * Build-time constant injected by esbuild/bun.
 * This is undefined when running unbundled in development.
 */
declare const SENTRY_CLI_VERSION: string | undefined;

/** Environment variable to disable telemetry */
const TELEMETRY_ENV_VAR = "SENTRY_CLI_NO_TELEMETRY";

function isTelemetryEnabled(): boolean {
  return process.env[TELEMETRY_ENV_VAR] !== "1";
}

/**
 * Wrap CLI execution with telemetry tracking.
 *
 * Creates a Sentry session and span for the command execution.
 * Captures any unhandled exceptions and reports them.
 * Telemetry can be disabled via SENTRY_CLI_NO_TELEMETRY=1 env var.
 *
 * @param callback - The CLI execution function to wrap
 * @returns The result of the callback
 */
export async function withTelemetry<T>(
  callback: () => T | Promise<T>
): Promise<T> {
  const client = initSentry(isTelemetryEnabled());
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
  // Build-time constants, with dev defaults
  const version =
    typeof SENTRY_CLI_VERSION !== "undefined"
      ? SENTRY_CLI_VERSION
      : "0.0.0-dev";
  const environment = process.env.NODE_ENV ?? "development";

  const client = Sentry.init({
    dsn: SENTRY_CLI_DSN,
    enabled,
    // CLI is short-lived - disable integrations that add overhead with no benefit
    // (console, context, modules, etc). Only keep http to capture API requests.
    defaultIntegrations: false,
    integrations: [Sentry.httpIntegration()],
    environment,
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
      // Replace home directory with ~ in stack traces to remove PII
      const homeDir = process.env.HOME || process.env.USERPROFILE;
      for (const exception of event.exception?.values ?? []) {
        if (!exception.stacktrace?.frames) {
          continue;
        }
        for (const frame of exception.stacktrace.frames) {
          if (frame.filename && homeDir) {
            frame.filename = frame.filename.replace(homeDir, "~");
          }
        }
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
    // Detect runtime: bun binary vs node (npm package)
    const runtime =
      typeof process.versions.bun !== "undefined" ? "bun" : "node";
    Sentry.setTag("runtime", runtime);
    Sentry.setTag("runtime.version", process.version);
  }

  return client;
}

/**
 * Set the command name for telemetry.
 *
 * Called by stricli's forCommand context builder with the resolved
 * command path (e.g., "auth.login", "issue.list").
 *
 * Updates both the active span name and sets a tag for filtering.
 *
 * @param command - The command name (dot-separated path)
 */
export function setCommandName(command: string): void {
  // Update the span name to the actual command
  const span = Sentry.getActiveSpan();
  if (span) {
    span.updateName(command);
  }
  // Also set as tag for easier filtering in Sentry UI
  Sentry.setTag("command", command);
}
