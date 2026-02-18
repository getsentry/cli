import { isatty } from "node:tty";
import { run } from "@stricli/core";
import { app } from "./app.js";
import { buildContext } from "./context.js";
import { AuthError, formatError, getExitCode } from "./lib/errors.js";
import { error } from "./lib/formatters/colors.js";
import { runInteractiveLogin } from "./lib/interactive-login.js";
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

/** Run CLI command with telemetry wrapper */
async function runCommand(args: string[]): Promise<void> {
  await withTelemetry(async (span) =>
    run(app, args, buildContext(process, span))
  );
}

/**
 * Execute command with automatic authentication.
 *
 * If the command fails due to missing authentication and we're in a TTY,
 * automatically run the interactive login flow and retry the command.
 *
 * @throws Re-throws any non-authentication errors from the command
 */
async function executeWithAutoAuth(args: string[]): Promise<void> {
  try {
    await runCommand(args);
  } catch (err) {
    // Auto-login for auth errors in interactive TTY environments
    // Use isatty(0) for reliable stdin TTY detection (process.stdin.isTTY can be undefined in Bun)
    // Errors can opt-out via skipAutoAuth (e.g., auth status command)
    if (
      err instanceof AuthError &&
      err.reason === "not_authenticated" &&
      !err.skipAutoAuth &&
      isatty(0)
    ) {
      process.stderr.write(
        "Authentication required. Starting login flow...\n\n"
      );

      const loginSuccess = await runInteractiveLogin(
        process.stdout,
        process.stderr,
        process.stdin
      );

      if (loginSuccess) {
        process.stderr.write("\nRetrying command...\n\n");
        await runCommand(args);
        return;
      }

      // Login failed or was cancelled - set exit code and return
      // (don't call process.exit() directly to allow finally blocks to run)
      process.exitCode = 1;
      return;
    }

    // Re-throw non-auth errors to be handled by main
    throw err;
  }
}

async function main(): Promise<void> {
  // Clean up old binary from previous Windows upgrade (no-op if file doesn't exist)
  startCleanupOldBinary();

  const args = process.argv.slice(2);
  const suppressNotification = shouldSuppressNotification(args);

  // Start background update check (non-blocking)
  if (!suppressNotification) {
    maybeCheckForUpdateInBackground();
  }

  try {
    await executeWithAutoAuth(args);
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
