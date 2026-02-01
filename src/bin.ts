import { run } from "@stricli/core";
import { app } from "./app.js";
import { buildContext } from "./context.js";
import { formatError, getExitCode } from "./lib/errors.js";
import { error } from "./lib/formatters/colors.js";
import { withTelemetry } from "./lib/telemetry.js";
import {
  getUpdateNotification,
  maybeCheckForUpdateInBackground,
  shouldSuppressNotification,
} from "./lib/version-check.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const suppressNotification = shouldSuppressNotification(args);

  // Start background update check (non-blocking)
  if (!suppressNotification) {
    maybeCheckForUpdateInBackground();
  }

  try {
    await withTelemetry(async (span) =>
      run(app, args, buildContext(process, span))
    );
  } catch (err) {
    process.stderr.write(`${error("Error:")} ${formatError(err)}\n`);
    process.exit(getExitCode(err));
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
