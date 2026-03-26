/**
 * CLI entry point with fast-path dispatch.
 *
 * Shell completion (`__complete`) is dispatched before any heavy imports
 * to avoid loading `@sentry/node-core` (~280ms). All other commands go through
 * the full CLI with telemetry, middleware, and error recovery.
 */

// Handle non-recoverable stream I/O errors gracefully instead of crashing.
// - EPIPE (errno -32): downstream pipe consumer closed (e.g., `sentry issue list | head`).
//   Normal Unix behavior — not an error. Exit 0 because the CLI succeeded; the consumer
//   just stopped reading.
// - EIO (errno -5): low-level I/O failure on the stream fd (e.g., terminal device driver
//   error, broken PTY, disk I/O failure on redirected output). Non-recoverable — the
//   stream is unusable and output may be incomplete. Exit 1 so callers (scripts, CI) know
//   the output was lost. Seen in CLI-H2 on self-hosted macOS with virtualized storage.
// Without this handler these errors become uncaught exceptions.
function handleStreamError(err: NodeJS.ErrnoException): void {
  if (err.code === "EPIPE") {
    process.exit(0);
  }
  if (err.code === "EIO") {
    process.exit(1);
  }
  throw err;
}

process.stdout.on("error", handleStreamError);
process.stderr.on("error", handleStreamError);

/**
 * Fast-path: shell completion.
 *
 * Dispatched before importing the full CLI to avoid loading @sentry/node-core,
 * @stricli/core, and other heavy dependencies. Only loads the lightweight
 * completion engine and SQLite cache modules.
 */
async function runCompletion(completionArgs: string[]): Promise<void> {
  // Disable telemetry so db/index.ts skips the @sentry/node-core lazy-require (~280ms)
  process.env.SENTRY_CLI_NO_TELEMETRY = "1";
  const { handleComplete } = await import("./lib/complete.js");
  handleComplete(completionArgs);
}

/**
 * Flags whose values must never be sent to telemetry.
 * Superset of `SENSITIVE_FLAGS` in `telemetry.ts` — includes `auth-token`
 * because raw argv may use either form before Stricli parses to camelCase.
 */
const SENSITIVE_ARGV_FLAGS = new Set(["token", "auth-token"]);

/**
 * Check whether an argv token is a sensitive flag that needs value redaction.
 * Returns `"eq"` for `--flag=value` form, `"next"` for `--flag <value>` form,
 * or `null` if the token is not sensitive.
 */
function sensitiveArgvFlag(token: string): "eq" | "next" | null {
  if (!token.startsWith("--")) {
    return null;
  }
  const eqIdx = token.indexOf("=");
  if (eqIdx !== -1) {
    const name = token.slice(2, eqIdx).toLowerCase();
    return SENSITIVE_ARGV_FLAGS.has(name) ? "eq" : null;
  }
  const name = token.slice(2).toLowerCase();
  return SENSITIVE_ARGV_FLAGS.has(name) ? "next" : null;
}

/**
 * Redact sensitive values from argv before sending to telemetry.
 *
 * When a token matches `--<flag>` or `--<flag>=value` for a sensitive
 * flag name, the value (next positional token or `=value` portion) is
 * replaced with `[REDACTED]`.
 */
function redactArgv(argv: string[]): string[] {
  const redacted: string[] = [];
  let skipNext = false;
  for (const token of argv) {
    if (skipNext) {
      redacted.push("[REDACTED]");
      skipNext = false;
      continue;
    }
    const kind = sensitiveArgvFlag(token);
    if (kind === "eq") {
      const eqIdx = token.indexOf("=");
      redacted.push(`${token.slice(0, eqIdx + 1)}[REDACTED]`);
    } else if (kind === "next") {
      redacted.push(token);
      skipNext = true;
    } else {
      redacted.push(token);
    }
  }
  return redacted;
}

/**
 * Error-recovery middleware for the CLI.
 *
 * Each middleware wraps command execution and may intercept specific errors
 * to perform recovery actions (e.g., login, start trial) then retry.
 *
 * Middlewares are applied innermost-first: the last middleware in the array
 * wraps the outermost layer, so it gets first crack at errors. This means
 * auth recovery (outermost) can catch errors from both the command AND
 * the trial prompt retry.
 *
 * @param next - The next function in the chain (command or inner middleware)
 * @param args - CLI arguments for retry
 * @returns A function with the same signature, with error recovery added
 */
type ErrorMiddleware = (
  proceed: (cmdInput: string[]) => Promise<void>,
  retryArgs: string[]
) => Promise<void>;

/**
 * Full CLI execution with telemetry, middleware, and error recovery.
 *
 * All heavy imports are loaded here (not at module top level) so the
 * `__complete` fast-path can skip them entirely.
 */
async function runCli(cliArgs: string[]): Promise<void> {
  const { isatty } = await import("node:tty");
  const { ExitCode, run } = await import("@stricli/core");
  const { app } = await import("./app.js");
  const { buildContext } = await import("./context.js");
  const { AuthError, formatError, getExitCode } = await import(
    "./lib/errors.js"
  );
  const { error, warning } = await import("./lib/formatters/colors.js");
  const { runInteractiveLogin } = await import("./lib/interactive-login.js");
  const { getEnvLogLevel, setLogLevel } = await import("./lib/logger.js");
  const { isTrialEligible, promptAndStartTrial } = await import(
    "./lib/seer-trial.js"
  );
  const { withTelemetry } = await import("./lib/telemetry.js");
  const { startCleanupOldBinary } = await import("./lib/upgrade.js");
  const {
    abortPendingVersionCheck,
    getUpdateNotification,
    maybeCheckForUpdateInBackground,
    shouldSuppressNotification,
  } = await import("./lib/version-check.js");

  // ---------------------------------------------------------------------------
  // Error-recovery middleware
  // ---------------------------------------------------------------------------

  /**
   * Seer trial prompt middleware.
   *
   * Catches trial-eligible SeerErrors and offers to start a free trial.
   * On success, retries the original command. On failure/decline, re-throws
   * so the outer error handler displays the full error with upgrade URL.
   */
  const seerTrialMiddleware: ErrorMiddleware = async (next, argv) => {
    try {
      await next(argv);
    } catch (err) {
      if (isTrialEligible(err)) {
        const started = await promptAndStartTrial(
          // biome-ignore lint/style/noNonNullAssertion: isTrialEligible guarantees orgSlug is defined
          err.orgSlug!,
          err.reason
        );

        if (started) {
          process.stderr.write("\nRetrying command...\n\n");
          await next(argv);
          return;
        }
      }
      throw err;
    }
  };

  /**
   * Auto-authentication middleware.
   *
   * Catches auth errors (not_authenticated, expired) in interactive TTYs
   * and runs the login flow. On success, retries through the full middleware
   * chain so inner middlewares (e.g., trial prompt) also apply to the retry.
   */
  const autoAuthMiddleware: ErrorMiddleware = async (next, argv) => {
    try {
      await next(argv);
    } catch (err) {
      // Use isatty(0) for reliable stdin TTY detection (process.stdin.isTTY can be undefined in Bun)
      // Errors can opt-out via skipAutoAuth (e.g., auth status command)
      if (
        err instanceof AuthError &&
        (err.reason === "not_authenticated" || err.reason === "expired") &&
        !err.skipAutoAuth &&
        isatty(0)
      ) {
        process.stderr.write(
          err.reason === "expired"
            ? "Authentication expired. Starting login flow...\n\n"
            : "Authentication required. Starting login flow...\n\n"
        );

        const loginSuccess = await runInteractiveLogin();

        if (loginSuccess) {
          process.stderr.write("\nRetrying command...\n\n");
          await next(argv);
          return;
        }

        // Login failed or was cancelled
        process.exitCode = 1;
        return;
      }

      throw err;
    }
  };

  /**
   * Error-recovery middlewares applied around command execution.
   *
   * Order matters: applied innermost-first, so the last entry wraps the
   * outermost layer. Auth middleware is outermost so it catches errors
   * from both the command and any inner middleware retries.
   */
  const errorMiddlewares: ErrorMiddleware[] = [
    seerTrialMiddleware,
    autoAuthMiddleware,
  ];

  /** Run CLI command with telemetry wrapper */
  async function runCommand(argv: string[]): Promise<void> {
    await withTelemetry(async (span) => {
      await run(app, argv, buildContext(process, span));

      // Stricli handles unknown subcommands internally — it writes to
      // stderr and sets exitCode without throwing. Report to Sentry so
      // we can track typo/confusion patterns and improve suggestions.
      if (
        (process.exitCode === ExitCode.UnknownCommand ||
          process.exitCode === (ExitCode.UnknownCommand + 256) % 256) &&
        // Skip when the unknown token is "help" — the outer code in
        // runCli recovers this by retrying as `sentry help <group...>`
        argv.at(-1) !== "help"
      ) {
        // Best-effort: telemetry must never crash the CLI
        try {
          await reportUnknownCommand(argv);
        } catch {
          // Silently ignore telemetry failures
        }
      }
    });
  }

  /**
   * Extract org/project from raw argv by scanning for `org/project` tokens.
   *
   * Commands accept `org/project` or `org/` as positional targets.
   * Since Stricli failed at route resolution, args are unparsed — we
   * scan for the first slash-containing, non-flag token.
   */
  function extractOrgProjectFromArgv(argv: string[]): {
    org?: string;
    project?: string;
  } {
    for (const token of argv) {
      if (token.startsWith("-") || !token.includes("/")) {
        continue;
      }
      const slashIdx = token.indexOf("/");
      const org = token.slice(0, slashIdx) || undefined;
      const project = token.slice(slashIdx + 1) || undefined;
      return { org, project };
    }
    return {};
  }

  /**
   * Report an unknown subcommand to Sentry with rich context.
   *
   * Called when Stricli's route scanner rejects an unrecognized token
   * (e.g., `sentry issue helpp`). Uses the introspection system to find
   * fuzzy matches and extracts org/project context from the raw argv.
   */
  async function reportUnknownCommand(argv: string[]): Promise<void> {
    const Sentry = await import("@sentry/node-core/light");
    const { resolveCommandPath } = await import("./lib/introspect.js");
    const { routes } = await import("./app.js");
    const { getDefaultOrganization } = await import("./lib/db/defaults.js");

    // Strip flags so resolveCommandPath only sees command path segments
    const pathSegments = argv.filter((t) => !t.startsWith("-"));
    const resolved = resolveCommandPath(
      routes as unknown as Parameters<typeof resolveCommandPath>[0],
      pathSegments
    );
    const unknownToken =
      resolved?.kind === "unresolved" ? resolved.input : (argv.at(-1) ?? "");
    const suggestions =
      resolved?.kind === "unresolved" ? resolved.suggestions : [];

    // Extract org/project from argv, fall back to default org from SQLite
    const fromArgv = extractOrgProjectFromArgv(argv);
    const org = fromArgv.org ?? getDefaultOrganization() ?? undefined;

    // Redact sensitive flags (e.g., --token) before sending to Sentry
    const safeArgv = redactArgv(argv);

    Sentry.setTag("command", "unknown");
    if (org) {
      Sentry.setTag("sentry.org", org);
    }
    if (fromArgv.project) {
      Sentry.setTag("sentry.project", fromArgv.project);
    }
    Sentry.setContext("unknown_command", {
      argv: safeArgv,
      unknown_token: unknownToken,
      suggestions,
      arg_count: argv.length,
      org: org ?? null,
      project: fromArgv.project ?? null,
    });
    // Fixed message string so all unknown commands group into one Sentry
    // issue. The per-event detail (which token, suggestions) lives in the
    // structured context above and is queryable via Discover.
    Sentry.captureMessage("unknown_command", "info");
  }

  /** Build the command executor by composing error-recovery middlewares. */
  let executor = runCommand;
  for (const mw of errorMiddlewares) {
    const inner = executor;
    executor = (argv) => mw(inner, argv);
  }

  // ---------------------------------------------------------------------------
  // Main execution
  // ---------------------------------------------------------------------------

  // Clean up old binary from previous Windows upgrade (no-op if file doesn't exist)
  startCleanupOldBinary();

  // Apply SENTRY_LOG_LEVEL env var early (lazy read, not at module load time).
  // CLI flags (--log-level, --verbose) are handled by Stricli via
  // buildCommand and take priority when present.
  const envLogLevel = getEnvLogLevel();
  if (envLogLevel !== null) {
    setLogLevel(envLogLevel);
  }

  const suppressNotification = shouldSuppressNotification(cliArgs);

  // Start background update check (non-blocking)
  if (!suppressNotification) {
    maybeCheckForUpdateInBackground();
  }

  try {
    await executor(cliArgs);

    // When Stricli can't match a subcommand in a route group (e.g.,
    // `sentry dashboard help`), it writes "No command registered for `help`"
    // to stderr and sets exitCode to UnknownCommand. If the unrecognized
    // token was "help", retry as `sentry help <group...>` which routes to
    // the custom help command with proper introspection output.
    // Check both raw (-5) and unsigned (251) forms because Node.js keeps
    // the raw value while Bun converts to unsigned byte.
    if (
      (process.exitCode === ExitCode.UnknownCommand ||
        process.exitCode === (ExitCode.UnknownCommand + 256) % 256) &&
      cliArgs.length >= 2 &&
      cliArgs.at(-1) === "help" &&
      cliArgs[0] !== "help"
    ) {
      process.exitCode = 0;
      const helpArgs = ["help", ...cliArgs.slice(0, -1)];
      process.stderr.write(
        warning(
          `Tip: use --help for help (e.g., sentry ${cliArgs.slice(0, -1).join(" ")} --help)\n`
        )
      );
      await executor(helpArgs);
    }
  } catch (err) {
    process.stderr.write(`${error("Error:")} ${formatError(err)}\n`);
    process.exitCode = getExitCode(err);
    return;
  } finally {
    // Abort any pending version check to allow clean exit
    abortPendingVersionCheck();
  }

  // Show update notification after command completes
  if (!suppressNotification) {
    const notification = getUpdateNotification();
    if (notification) {
      process.stderr.write(notification);
    }
  }
}

// ---------------------------------------------------------------------------
// Dispatch: check argv before any heavy imports
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);

if (args[0] === "__complete") {
  runCompletion(args.slice(1)).catch(() => {
    // Completions should never crash — silently return no results
    process.exitCode = 0;
  });
} else {
  runCli(args).catch((err) => {
    process.stderr.write(`Fatal: ${err}\n`);
    process.exitCode = 1;
  });
}
