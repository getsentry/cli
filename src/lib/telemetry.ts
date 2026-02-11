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
import { isReadonlyError, tryRepairAndRetry } from "./db/schema.js";
import { ApiError, AuthError } from "./errors.js";
import { getSentryBaseUrl, isSentrySaasUrl } from "./sentry-urls.js";

export type { Span } from "@sentry/bun";

/** Re-imported locally because Span is exported via re-export */
type Span = Sentry.Span;

/**
 * Initialize telemetry context with user and instance information.
 * Called after Sentry is initialized to set user context and instance tags.
 */
async function initTelemetryContext(): Promise<void> {
  try {
    // Dynamic imports to avoid circular dependencies and for ES module compatibility
    const { getUserInfo } = await import("./db/user.js");
    const { getInstanceId } = await import("./db/instance.js");

    const user = getUserInfo();
    const instanceId = getInstanceId();

    if (user) {
      // Only send user ID - email/username are PII
      Sentry.setUser({ id: user.userId });
    }

    if (instanceId) {
      Sentry.setTag("instance_id", instanceId);
    }
  } catch (error) {
    // Context initialization is not critical - continue without it
    // But capture the error for debugging
    Sentry.captureException(error);
  }
}

/**
 * Mark the active session as crashed.
 *
 * Checks both current scope and isolation scope since processSessionIntegration
 * stores the session on the isolation scope. Called when a command error
 * propagates through withTelemetry — the SDK auto-marks crashes for truly
 * uncaught exceptions (mechanism.handled === false), but command errors need
 * explicit marking.
 *
 * @internal Exported for testing
 */
export function markSessionCrashed(): void {
  const session =
    Sentry.getCurrentScope().getSession() ??
    Sentry.getIsolationScope().getSession();
  if (session) {
    session.status = "crashed";
  }
}

/**
 * Wrap CLI execution with telemetry tracking.
 *
 * Creates a Sentry span for the command execution and captures exceptions.
 * Session lifecycle is managed by the SDK's processSessionIntegration
 * (started during Sentry.init) and a beforeExit handler (registered in
 * initSentry) that ends healthy sessions and flushes events. This ensures
 * sessions are reliably tracked even for unhandled rejections and other
 * paths that bypass this function's try/catch.
 *
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
  await initTelemetryContext();

  try {
    return await Sentry.startSpanManual(
      { name: "cli.command", op: "cli.command", forceTransaction: true },
      async (span) => {
        try {
          return await callback(span);
        } catch (e) {
          // Record 4xx API errors as span attributes instead of exceptions.
          // These are user errors (wrong ID, no access) not CLI bugs, but
          // recording on the span lets us detect volume spikes in Discover.
          if (isClientApiError(e)) {
            recordApiErrorOnSpan(span, e as ApiError);
          }
          throw e;
        } finally {
          span.end();
        }
      }
    );
  } catch (e) {
    const isExpectedAuthState =
      e instanceof AuthError && e.reason === "not_authenticated";
    // 4xx API errors are user errors (wrong ID, no access), not CLI bugs.
    // They're recorded as span attributes above for volume-spike detection.
    if (!(isExpectedAuthState || isClientApiError(e))) {
      Sentry.captureException(e);
      markSessionCrashed();
    }
    throw e;
  }
}

/**
 * Create a beforeExit handler that ends healthy sessions and flushes events.
 *
 * The SDK's processSessionIntegration only ends non-OK sessions (crashed/errored).
 * This handler complements it by ending OK sessions (clean exit → 'exited')
 * and flushing pending events. Includes a re-entry guard since flush is async
 * and causes beforeExit to re-fire when complete.
 *
 * @param client - The Sentry client to flush
 * @returns A handler function for process.on("beforeExit")
 *
 * @internal Exported for testing
 */
export function createBeforeExitHandler(client: Sentry.BunClient): () => void {
  let isFlushing = false;
  return () => {
    if (isFlushing) {
      return;
    }
    isFlushing = true;

    const session = Sentry.getIsolationScope().getSession();
    if (session?.status === "ok") {
      Sentry.endSession();
    }

    // Flush pending events before exit. Convert PromiseLike to Promise
    // for proper error handling. The async work causes beforeExit to
    // re-fire when complete, which the isFlushing guard handles.
    Promise.resolve(client.flush(3000)).catch(() => {
      // Ignore flush errors — telemetry should never block CLI exit
    });
  };
}

/**
 * Check if a Sentry event represents an EPIPE error.
 *
 * EPIPE (errno -32) occurs when writing to a pipe whose reading end has been
 * closed. This is normal Unix behavior when CLI output is piped through
 * commands like `head`, `less`, or `grep -m1`. These errors are not bugs
 * and should be silently dropped from telemetry.
 *
 * Detects both Bun-style ("EPIPE: broken pipe, write") and Node.js-style
 * ("write EPIPE") error messages, plus the structured `node_system_error` context.
 *
 * @internal Exported for testing
 */
export function isEpipeError(event: Sentry.ErrorEvent): boolean {
  // Check exception message for EPIPE
  const exceptions = event.exception?.values;
  if (exceptions) {
    for (const ex of exceptions) {
      if (ex.value?.includes("EPIPE")) {
        return true;
      }
    }
  }

  // Check Node.js system error context (set by the SDK for system errors)
  const systemError = event.contexts?.node_system_error as
    | { code?: string }
    | undefined;
  if (systemError?.code === "EPIPE") {
    return true;
  }

  return false;
}

/**
 * Check if an error is a client-side (4xx) API error.
 *
 * 4xx errors are user errors — wrong issue IDs, no access, invalid input —
 * not CLI bugs. These should be recorded as span attributes for volume-spike
 * detection in Discover, but should NOT be captured as Sentry exceptions.
 *
 * @internal Exported for testing
 */
export function isClientApiError(error: unknown): boolean {
  return error instanceof ApiError && error.status >= 400 && error.status < 500;
}

/**
 * Record a client API error as span attributes for Discover queryability.
 *
 * Sets `api_error.status`, `api_error.message`, and optionally `api_error.detail`
 * on the span. Must be called before `span.end()`.
 *
 * @internal Exported for testing
 */
export function recordApiErrorOnSpan(span: Span, error: ApiError): void {
  span.setAttribute("api_error.status", error.status);
  span.setAttribute("api_error.message", error.message);
  if (error.detail) {
    span.setAttribute("api_error.detail", error.detail);
  }
}

/**
 * Integrations to exclude for CLI.
 * These add overhead without benefit for short-lived CLI processes.
 */
const EXCLUDED_INTEGRATIONS = new Set([
  "Console", // Captures console output - too noisy for CLI
  "ContextLines", // Reads source files - we rely on uploaded sourcemaps instead
  "LocalVariables", // Captures local variables - adds significant overhead
  "Modules", // Lists all loaded modules - unnecessary for CLI telemetry
]);

/** Current beforeExit handler, tracked so it can be replaced on re-init */
let currentBeforeExitHandler: (() => void) | null = null;

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
    // Keep default integrations but filter out ones that add overhead without benefit
    // Important: Don't use defaultIntegrations: false as it may break debug ID support
    integrations: (defaults) =>
      defaults.filter(
        (integration) => !EXCLUDED_INTEGRATIONS.has(integration.name)
      ),
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
      // Remove server_name which may contain hostname (PII)
      event.server_name = undefined;

      // EPIPE errors are expected when stdout is piped and the consumer closes
      // early (e.g., `sentry issue list | head`). Not actionable — drop them.
      if (isEpipeError(event)) {
        return null;
      }

      return event;
    },
  });

  if (client?.getOptions().enabled) {
    const isBun = typeof process.versions.bun !== "undefined";
    const runtime = isBun ? "bun" : "node";

    // Tag whether running as bun binary or node (npm package).
    // Kept alongside the SDK's promoted 'runtime' tag for explicit signaling
    // and backward compatibility with existing dashboards/alerts.
    Sentry.setTag("cli.runtime", runtime);

    // Tag whether targeting self-hosted Sentry (not SaaS)
    Sentry.setTag("is_self_hosted", !isSentrySaasUrl(getSentryBaseUrl()));

    // End healthy sessions and flush events when the event loop drains.
    // The SDK's processSessionIntegration starts a session during init and
    // registers its own beforeExit handler that ends non-OK (crashed/errored)
    // sessions. We complement it by ending OK sessions (clean exit → 'exited')
    // and flushing pending events. This covers unhandled rejections and other
    // paths that bypass withTelemetry's try/catch.
    // Ref: https://nodejs.org/api/process.html#event-beforeexit
    //
    // Replace previous handler on re-init (e.g., auto-login retry calls
    // withTelemetry → initSentry twice) to avoid duplicate handlers with
    // independent re-entry guards and stale client references.
    if (currentBeforeExitHandler) {
      process.removeListener("beforeExit", currentBeforeExitHandler);
    }
    currentBeforeExitHandler = createBeforeExitHandler(client);
    process.on("beforeExit", currentBeforeExitHandler);
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
 * Set command flags as telemetry tags.
 *
 * Converts flag names from camelCase to kebab-case and sets them as tags
 * with the `flag.` prefix (e.g., `flag.no-modify-path`).
 *
 * Only sets tags for flags with non-default/meaningful values:
 * - Boolean flags: only when true
 * - String/number flags: only when defined and non-empty
 * - Array flags: only when non-empty
 *
 * Call this at the start of command func() to instrument flag usage.
 *
 * @param flags - The parsed flags object from Stricli
 *
 * @example
 * ```ts
 * async func(this: SentryContext, flags: MyFlags): Promise<void> {
 *   setFlagContext(flags);
 *   // ... command implementation
 * }
 * ```
 */
export function setFlagContext(flags: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(flags)) {
    // Skip undefined/null values
    if (value === undefined || value === null) {
      continue;
    }

    // Skip false booleans (default state)
    if (value === false) {
      continue;
    }

    // Skip empty strings
    if (value === "") {
      continue;
    }

    // Skip empty arrays
    if (Array.isArray(value) && value.length === 0) {
      continue;
    }

    // Convert camelCase to kebab-case for consistency with CLI flag names
    const kebabKey = key.replace(/([A-Z])/g, "-$1").toLowerCase();

    // Set the tag with flag. prefix
    // For booleans, just set "true"; for other types, convert to string
    const tagValue =
      typeof value === "boolean" ? "true" : String(value).slice(0, 200); // Truncate long values
    Sentry.setTag(`flag.${kebabKey}`, tagValue);
  }
}

/**
 * Set positional arguments as Sentry context.
 *
 * Stores positional arguments in a structured context for debugging.
 * Unlike tags, context is not indexed but provides richer data.
 *
 * @param args - The positional arguments passed to the command
 */
export function setArgsContext(args: readonly unknown[]): void {
  if (args.length === 0) {
    return;
  }

  Sentry.setContext("args", {
    values: args.map((arg) =>
      typeof arg === "string" ? arg : JSON.stringify(arg)
    ),
    count: args.length,
  });
}

/**
 * Wrap an operation with a Sentry span for tracing.
 *
 * Creates a child span under the current active span to track
 * operation duration and status. Automatically sets span status
 * to OK on success or Error on failure.
 *
 * Use this generic helper for custom operations, or use the specialized
 * helpers (withHttpSpan, withDbSpan, withFsSpan, withSerializeSpan) for
 * common operation types.
 *
 * @param name - Span name (e.g., "scanDirectory", "findProjectRoot")
 * @param op - Operation type (e.g., "dsn.scan", "file.read")
 * @param fn - Function to execute within the span
 * @param attributes - Optional span attributes for additional context
 * @returns The result of the function
 */
export function withTracing<T>(
  name: string,
  op: string,
  fn: () => T | Promise<T>,
  attributes?: Record<string, string | number | boolean>
): Promise<T> {
  return Sentry.startSpan(
    { name, op, attributes, onlyIfParent: true },
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
 * Wrap an operation with a Sentry span, passing the span to the callback.
 *
 * Like `withTracing`, but passes the span to the callback for cases where
 * you need to set attributes or record metrics during execution.
 * Automatically sets span status to OK on success or Error on failure,
 * unless the callback has already set a status.
 *
 * @param name - Span name (e.g., "scanDirectory", "findProjectRoot")
 * @param op - Operation type (e.g., "dsn.scan", "file.read")
 * @param fn - Function to execute, receives the span as argument
 * @param attributes - Optional initial span attributes
 * @returns The result of the function
 *
 * @example
 * ```ts
 * const result = await withTracingSpan(
 *   "scanDirectory",
 *   "dsn.scan",
 *   async (span) => {
 *     const files = await collectFiles();
 *     span.setAttribute("files.count", files.length);
 *     return processFiles(files);
 *   },
 *   { "scan.dir": cwd }
 * );
 * ```
 */
export function withTracingSpan<T>(
  name: string,
  op: string,
  fn: (span: Span) => T | Promise<T>,
  attributes?: Record<string, string | number | boolean>
): Promise<T> {
  return Sentry.startSpan(
    { name, op, attributes, onlyIfParent: true },
    async (span) => {
      // Track if callback sets status, so we don't override it
      let statusWasSet = false;
      const originalSetStatus = span.setStatus.bind(span);
      span.setStatus = (...args) => {
        statusWasSet = true;
        return originalSetStatus(...args);
      };

      try {
        const result = await fn(span);
        if (!statusWasSet) {
          span.setStatus({ code: 1 }); // OK
        }
        return result;
      } catch (error) {
        if (!statusWasSet) {
          span.setStatus({ code: 2 }); // Error
        }
        throw error;
      }
    }
  );
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
  return withTracing(`${method} ${url}`, "http.client", fn, {
    "http.request.method": method,
    "url.path": url,
  });
}

/**
 * Wrap a database operation with a span for tracing.
 *
 * Creates a child span under the current active span to track
 * database operation duration. This is a synchronous wrapper that
 * preserves the sync nature of the callback.
 *
 * Use this for grouping logical operations (e.g., "clearAuth" which runs
 * multiple queries). Individual SQL queries are automatically traced when
 * using a database wrapped with `createTracedDatabase`.
 *
 * @param operation - Name of the operation (e.g., "getAuthToken", "setDefaults")
 * @param fn - The function that performs the database operation
 * @returns The result of the function
 */
export function withDbSpan<T>(operation: string, fn: () => T): T {
  return Sentry.startSpan(
    {
      name: operation,
      op: "db.operation",
      attributes: { "db.system": "sqlite" },
      onlyIfParent: true,
    },
    fn
  );
}

/** Whether the readonly database warning has been shown this process */
let readonlyWarningShown = false;

/**
 * Print a one-time warning when the local database is read-only.
 * Uses lazy require to avoid circular dependency with db/index.ts.
 */
function warnReadonlyDatabaseOnce(): void {
  if (readonlyWarningShown) {
    return;
  }
  readonlyWarningShown = true;

  let dbPath = "~/.sentry/cli.db";
  try {
    const { getDbPath } = require("./db/index.js") as {
      getDbPath: () => string;
    };
    dbPath = getDbPath();
  } catch {
    // Fall back to default path if import fails
  }

  process.stderr.write(
    `\nWarning: Sentry CLI local database is read-only. Caching and preferences won't persist.\n` +
      `  Path: ${dbPath}\n` +
      "  Fix:  sentry cli fix\n\n"
  );
}

/**
 * Reset the readonly warning flag (for testing).
 * @internal
 */
export function resetReadonlyWarning(): void {
  readonlyWarningShown = false;
}

/** Methods on SQLite Statement that execute queries and should be traced */
const TRACED_STATEMENT_METHODS = ["get", "run", "all", "values"] as const;

/**
 * Wrap a SQLite Statement to automatically trace query execution.
 *
 * Intercepts get/run/all/values methods and wraps them with Sentry spans
 * that include the SQL query as both the span name and db.statement attribute.
 *
 * @param stmt - The SQLite Statement to wrap
 * @param sql - The SQL query string (parameterized)
 * @returns A proxied Statement with automatic tracing
 *
 * @internal Used by createTracedDatabase
 */
function createTracedStatement<T>(stmt: T, sql: string): T {
  return new Proxy(stmt as object, {
    get(target, prop) {
      const value = Reflect.get(target, prop);

      // Non-function properties pass through directly
      if (typeof value !== "function") {
        return value;
      }

      // Non-traced methods get bound to preserve 'this' context for native methods
      if (
        !TRACED_STATEMENT_METHODS.includes(
          prop as (typeof TRACED_STATEMENT_METHODS)[number]
        )
      ) {
        return value.bind(target);
      }

      // Traced methods get wrapped with Sentry span and auto-repair
      return (...args: unknown[]) =>
        Sentry.startSpan(
          {
            name: sql,
            op: "db",
            attributes: {
              "db.system": "sqlite",
              "db.statement": sql,
            },
            onlyIfParent: true,
          },
          () => {
            const execute = () =>
              (value as (...a: unknown[]) => unknown).apply(target, args);

            try {
              return execute();
            } catch (error) {
              // Attempt auto-repair for schema errors
              const repairResult = tryRepairAndRetry(execute, error);
              if (repairResult.attempted) {
                return repairResult.result;
              }

              // Handle readonly database gracefully: warn once, skip the write.
              // The CLI still works — reads succeed, only caching/persistence is lost.
              if (isReadonlyError(error)) {
                warnReadonlyDatabaseOnce();
                return;
              }

              // Re-throw if repair didn't help or wasn't applicable
              throw error;
            }
          }
        );
    },
  }) as T;
}

/** Minimal interface for a database with a query method */
type QueryableDatabase = { query: (sql: string) => unknown };

/**
 * Wrap a SQLite Database to automatically trace all queries.
 *
 * Intercepts the query() method and wraps returned Statements with
 * createTracedStatement, which traces get/run/all/values calls.
 *
 * @param db - The SQLite Database to wrap
 * @returns A proxied Database with automatic query tracing
 *
 * @example
 * ```ts
 * const db = new Database(":memory:");
 * const tracedDb = createTracedDatabase(db);
 *
 * // This query execution is automatically traced with the SQL as span name
 * tracedDb.query("SELECT * FROM users WHERE id = ?").get(1);
 * ```
 */
export function createTracedDatabase<T extends QueryableDatabase>(db: T): T {
  const originalQuery = db.query.bind(db) as (sql: string) => unknown;

  return new Proxy(db as object, {
    get(target, prop) {
      if (prop === "query") {
        return (sql: string) => {
          // Try to prepare the statement, with auto-repair on schema errors
          const prepareStatement = () => originalQuery(sql);

          let stmt: unknown;
          try {
            stmt = prepareStatement();
          } catch (error) {
            // Attempt auto-repair for schema errors during statement preparation
            const repairResult = tryRepairAndRetry(prepareStatement, error);
            if (repairResult.attempted) {
              stmt = repairResult.result;
            } else {
              throw error;
            }
          }

          return createTracedStatement(stmt, sql);
        };
      }
      const value = Reflect.get(target, prop);
      // Bind methods to preserve 'this' context for native methods with private fields
      if (typeof value === "function") {
        return value.bind(target);
      }
      return value;
    },
  }) as T;
}

/**
 * Wrap a serialization/formatting operation with a span for tracing.
 *
 * Creates a child span under the current active span to track
 * expensive formatting operations. This is a synchronous wrapper that
 * preserves the sync nature of the callback.
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

/**
 * Wrap a file system operation with a span for tracing.
 *
 * Creates a child span under the current active span to track
 * file system operation duration and status.
 *
 * @param operation - Name of the operation (e.g., "readFile", "scanDirectory")
 * @param fn - The function that performs the file operation
 * @returns The result of the function
 */
export function withFsSpan<T>(
  operation: string,
  fn: () => T | Promise<T>
): Promise<T> {
  return withTracing(operation, "file", fn);
}
