#!/usr/bin/env node
import { run } from "@stricli/core";
import { app } from "./app.js";
import { buildContext } from "./context.js";
import { formatError, getExitCode } from "./lib/errors.js";
import { error } from "./lib/formatters/colors.js";
import { printCustomHelp } from "./lib/help.js";
import { withTelemetry } from "./lib/telemetry.js";

/**
 * Check if the CLI should show custom help output.
 * Custom help is shown for top-level help requests (no subcommand).
 */
function shouldShowCustomHelp(args: string[]): boolean {
  return args.length === 0;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  try {
    await withTelemetry(async () => {
      // Intercept top-level help before Stricli
      if (shouldShowCustomHelp(args)) {
        await printCustomHelp(process.stdout);
        return;
      }

      return run(app, args, buildContext(process));
    });
  } catch (err) {
    process.stderr.write(`${error("Error:")} ${formatError(err)}\n`);
    process.exit(getExitCode(err));
  }
}

main();
