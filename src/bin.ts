/**
 * CLI entry point with fast-path dispatch.
 *
 * Shell completion (`__complete`) is dispatched before any heavy imports
 * to avoid loading `@sentry/bun` (~280ms). All other commands go through
 * the full CLI with telemetry, middleware, and error recovery.
 */

import { disableDbTracing } from "./lib/db/index.js";

// Exit cleanly when downstream pipe consumer closes (e.g., `sentry issue list | head`).
// EPIPE (errno -32) is normal Unix behavior — not an error. Node.js/Bun ignore SIGPIPE
// at the process level, so pipe write failures surface as async 'error' events on the
// stream. Without this handler they become uncaught exceptions.
function handleStreamError(err: NodeJS.ErrnoException): void {
  if (err.code === "EPIPE") {
    process.exit(0);
  }
  throw err;
}

process.stdout.on("error", handleStreamError);
process.stderr.on("error", handleStreamError);

/**
 * Fast-path: shell completion.
 *
 * Dispatched before importing the full CLI to avoid loading @sentry/bun,
 * @stricli/core, and other heavy dependencies. Only loads the lightweight
 * completion engine and SQLite cache modules.
 */
async function runCompletion(completionArgs: string[]): Promise<void> {
  disableDbTracing();
  const { handleComplete } = await import("./lib/complete.js");
  await handleComplete(completionArgs);
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
  const { run } = await import("@stricli/core");
  const { app } = await import("./app.js");
  const { buildContext } = await import("./context.js");
  const { AuthError, formatError, getExitCode } = await import(
    "./lib/errors.js"
  );
  const { error } = await import("./lib/formatters/colors.js");
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
    await withTelemetry(async (span) =>
      run(app, argv, buildContext(process, span))
    );
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
  runCompletion(args.slice(1));
} else {
  runCli(args);
}
