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

      // Only trace execution methods, pass through everything else
      if (
        typeof value !== "function" ||
        !TRACED_STATEMENT_METHODS.includes(
          prop as (typeof TRACED_STATEMENT_METHODS)[number]
        )
      ) {
        return value;
      }

      // Return a traced wrapper for the method
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
          () => (value as (...a: unknown[]) => unknown).apply(target, args)
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
          const stmt = originalQuery(sql);
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
