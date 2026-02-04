import { run } from "@stricli/core";
import { app } from "./app.js";
import { buildContext } from "./context.js";
import { AuthError, formatError, getExitCode } from "./lib/errors.js";
import { error } from "./lib/formatters/colors.js";
import { runInteractiveLogin } from "./lib/interactive-login.js";
import { withTelemetry } from "./lib/telemetry.js";
import {
  abortPendingVersionCheck,
  getUpdateNotification,
  maybeCheckForUpdateInBackground,
  shouldSuppressNotification,
} from "./lib/version-check.js";

/**
 * Execute command with automatic authentication.
 *
 * If the command fails due to missing authentication and we're in a TTY,
 * automatically run the interactive login flow and retry the command.
 */
async function executeWithAutoAuth(args: string[]): Promise<void> {
  try {
    await withTelemetry(async (span) =>
      run(app, args, buildContext(process, span))
    );
  } catch (err) {
    // Auto-login for auth errors in TTY environments
    if (
      err instanceof AuthError &&
      err.reason === "not_authenticated" &&
      process.stdin.isTTY
    ) {
      process.stderr.write(
        "Authentication required. Starting login flow...\n\n"
      );

      const loginSuccess = await runInteractiveLogin(
        process.stdout,
        process.stdin
      );

      if (loginSuccess) {
        process.stdout.write("\nRetrying command...\n\n");
        // Retry the original command
        await withTelemetry(async (span) =>
          run(app, args, buildContext(process, span))
        );
        return;
      }

      // Login failed or was cancelled
      process.exit(1);
    }

    // Re-throw non-auth errors to be handled by main
    throw err;
  }
}

async function main(): Promise<void> {
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
    process.exit(getExitCode(err));
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
