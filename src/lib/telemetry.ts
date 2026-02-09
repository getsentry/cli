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
import { tryRepairAndRetry } from "./db/schema.js";
import { AuthError } from "./errors.js";
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
  await initTelemetryContext();

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
    // Don't capture or mark as crashed for expected auth state
    // AuthError("not_authenticated") is re-thrown from app.ts for auto-login flow
    const isExpectedAuthState =
      e instanceof AuthError && e.reason === "not_authenticated";
    if (!isExpectedAuthState) {
      Sentry.captureException(e);
      const session = Sentry.getCurrentScope().getSession();
      if (session) {
        session.status = "crashed";
      }
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
      return event;
    },
  });

  if (client?.getOptions().enabled) {
    // Tag whether running as bun binary or node (npm package)
    // This is CLI-specific context not provided by the Context integration
    const runtime =
      typeof process.versions.bun !== "undefined" ? "bun" : "node";
    Sentry.setTag("cli.runtime", runtime);

    // Tag whether targeting self-hosted Sentry (not SaaS)
    Sentry.setTag("is_self_hosted", !isSentrySaasUrl(getSentryBaseUrl()));
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
