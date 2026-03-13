import { isatty } from "node:tty";
import { run } from "@stricli/core";
import { app } from "./app.js";
import { buildContext } from "./context.js";
import { AuthError, formatError, getExitCode } from "./lib/errors.js";
import { error } from "./lib/formatters/colors.js";
import { runInteractiveLogin } from "./lib/interactive-login.js";
import { getEnvLogLevel, setLogLevel } from "./lib/logger.js";
import { isTrialEligible, promptAndStartTrial } from "./lib/seer-trial.js";
import { withTelemetry } from "./lib/telemetry.js";
import { startCleanupOldBinary } from "./lib/upgrade.js";
import {
  abortPendingVersionCheck,
  getUpdateNotification,
  maybeCheckForUpdateInBackground,
  shouldSuppressNotification,
} from "./lib/version-check.js";

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
  next: (argv: string[]) => Promise<void>,
  args: string[]
) => Promise<void>;

/**
 * Seer trial prompt middleware.
 *
 * Catches trial-eligible SeerErrors and offers to start a free trial.
 * On success, retries the original command. On failure/decline, re-throws
 * so the outer error handler displays the full error with upgrade URL.
 */
const seerTrialMiddleware: ErrorMiddleware = async (next, args) => {
  try {
    await next(args);
  } catch (err) {
    if (isTrialEligible(err)) {
      const started = await promptAndStartTrial(
        // biome-ignore lint/style/noNonNullAssertion: isTrialEligible guarantees orgSlug is defined
        err.orgSlug!,
        err.reason
      );

      if (started) {
        process.stderr.write("\nRetrying command...\n\n");
        await next(args);
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
const autoAuthMiddleware: ErrorMiddleware = async (next, args) => {
  try {
    await next(args);
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

      const loginSuccess = await runInteractiveLogin(
        process.stdout,
        process.stderr,
        process.stdin
      );

      if (loginSuccess) {
        process.stderr.write("\nRetrying command...\n\n");
        await next(args);
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
 *
 * To add a new middleware, append it to this array.
 */
const errorMiddlewares: ErrorMiddleware[] = [
  seerTrialMiddleware,
  autoAuthMiddleware,
];

/** Run CLI command with telemetry wrapper */
async function runCommand(args: string[]): Promise<void> {
  await withTelemetry(async (span) =>
    run(app, args, buildContext(process, span))
  );
}

/**
 * Build the command executor by composing error-recovery middlewares.
 *
 * Wraps `runCommand` with each middleware in order (innermost-first),
 * producing a single function that handles all error recovery.
 */
function buildExecutor(): (args: string[]) => Promise<void> {
  let executor = runCommand;
  for (const mw of errorMiddlewares) {
    const next = executor;
    executor = (args) => mw(next, args);
  }
  return executor;
}

/** Command executor with all error-recovery middlewares applied */
const executeCommand = buildExecutor();

async function main(): Promise<void> {
  // Clean up old binary from previous Windows upgrade (no-op if file doesn't exist)
  startCleanupOldBinary();

  const args = process.argv.slice(2);

  // Apply SENTRY_LOG_LEVEL env var early (lazy read, not at module load time).
  // CLI flags (--log-level, --verbose) are handled by Stricli via
  // buildCommand and take priority when present.
  const envLogLevel = getEnvLogLevel();
  if (envLogLevel !== null) {
    setLogLevel(envLogLevel);
  }

  const suppressNotification = shouldSuppressNotification(args);

  // Start background update check (non-blocking)
  if (!suppressNotification) {
    maybeCheckForUpdateInBackground();
  }

  try {
    await executeCommand(args);
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

main();
