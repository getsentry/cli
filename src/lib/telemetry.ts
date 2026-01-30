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
import * as Sentry from "@sentry/bun";
import { CLI_VERSION, SENTRY_CLI_DSN } from "./constants.js";

export type { Span } from "@sentry/bun";

/** Re-imported locally because Span is exported via re-export */
type Span = Sentry.Span;

/**
 * Initialize telemetry context with user and instance information.
 * Called after Sentry is initialized to set user context and instance tags.
 */
function initTelemetryContext(): void {
  try {
    // Dynamic imports to avoid circular dependencies
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getUserInfo } =
      require("./db/user.js") as typeof import("./db/user.js");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getInstanceId } =
      require("./db/instance.js") as typeof import("./db/instance.js");

    const user = getUserInfo();
    const instanceId = getInstanceId();

    if (user) {
      // Only send user ID - email/username are PII
      Sentry.setUser({ id: user.userId });
    }

    if (instanceId) {
      Sentry.setTag("instance_id", instanceId);
    }
  } catch {
    // Context initialization is not critical - continue without it
  }
}

/**
 * Wrap CLI execution with telemetry tracking.
 *
 * Creates a Sentry session and span for the command execution.
 * Captures any unhandled exceptions and reports them.
 * Telemetry can be disabled via SENTRY_CLI_NO_TELEMETRY=1 env var.
 *
 * @param callback - The CLI execution function to wrap, receives the span for naming
 * @returns The result of the callback
 */
export async function withTelemetry<T>(
  callback: (span: Span | undefined) => T | Promise<T>
): Promise<T> {
  const enabled = process.env.SENTRY_CLI_NO_TELEMETRY !== "1";
  const client = initSentry(enabled);
  if (!client?.getOptions().enabled) {
    return callback(undefined);
  }

  // Initialize user and instance context
  initTelemetryContext();

  Sentry.startSession();
  Sentry.captureSession();

  try {
    return await Sentry.startSpanManual(
      { name: "cli.command", op: "cli.command", forceTransaction: true },
      async (span) => {
        try {
          return await callback(span);
        } finally {
          span.end();
        }
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
 * Initialize Sentry for telemetry.
 *
 * @param enabled - Whether telemetry is enabled
 * @returns The Sentry client, or undefined if initialization failed
 *
 * @internal Exported for testing
 */
export function initSentry(enabled: boolean): Sentry.BunClient | undefined {
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
    release: CLI_VERSION,
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
 * Set the command name on the telemetry span.
 *
 * Called by stricli's forCommand context builder with the resolved
 * command path (e.g., "auth.login", "issue.list").
 *
 * @param span - The span to update (from withTelemetry callback)
 * @param command - The command name (dot-separated path)
 */
export function setCommandSpanName(
  span: Span | undefined,
  command: string
): void {
  if (span) {
    Sentry.updateSpanName(span, command);
  }
  // Also set as tag for easier filtering in Sentry UI
  Sentry.setTag("command", command);
}

/**
 * Set organization and project context as tags.
 *
 * Call this from commands after resolving the target org/project
 * to enable filtering by org/project in Sentry.
 * Accepts arrays to support multi-project commands.
 *
 * @param orgs - Organization slugs
 * @param projects - Project slugs
 */
export function setOrgProjectContext(orgs: string[], projects: string[]): void {
  if (orgs.length > 0) {
    Sentry.setTag("sentry.org", orgs.join(","));
  }
  if (projects.length > 0) {
    Sentry.setTag("sentry.project", projects.join(","));
  }
}

/**
 * Wrap an HTTP request with a span for tracing.
 *
 * Creates a child span under the current active span to track
 * HTTP request duration and status.
 *
 * @param method - HTTP method (GET, POST, etc.)
 * @param url - Request URL or path
 * @param fn - The async function that performs the HTTP request
 * @returns The result of the function
 */
export function withHttpSpan<T>(
  method: string,
  url: string,
  fn: () => Promise<T>
): Promise<T> {
  return Sentry.startSpan(
    {
      name: `${method} ${url}`,
      op: "http.client",
      attributes: {
        "http.request.method": method,
        "url.path": url,
      },
      onlyIfParent: true,
    },
    async (span) => {
      try {
        const result = await fn();
        span.setStatus({ code: 1 }); // OK
        return result;
      } catch (error) {
        span.setStatus({ code: 2 }); // Error
        throw error;
      }
    }
  );
}

/**
 * Wrap a database operation with a span for tracing.
 *
 * Creates a child span under the current active span to track
 * database operation duration.
 *
 * @param operation - Name of the operation (e.g., "getAuthToken", "setDefaults")
 * @param fn - The function that performs the database operation
 * @returns The result of the function
 */
export function withDbSpan<T>(operation: string, fn: () => T): T {
  return Sentry.startSpan(
    {
      name: operation,
      op: "db",
      attributes: {
        "db.system": "sqlite",
      },
      onlyIfParent: true,
    },
    fn
  );
}

/**
 * Wrap a serialization/formatting operation with a span for tracing.
 *
 * Creates a child span under the current active span to track
 * expensive formatting operations.
 *
 * @param operation - Name of the operation (e.g., "formatSpanTree")
 * @param fn - The function that performs the formatting
 * @returns The result of the function
 */
export function withSerializeSpan<T>(operation: string, fn: () => T): T {
  return Sentry.startSpan(
    {
      name: operation,
      op: "serialize",
      onlyIfParent: true,
    },
    fn
  );
}
