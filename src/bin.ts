#!/usr/bin/env node
import { run } from "@stricli/core";
import { app } from "./app.js";
import { buildContext } from "./context.js";
import { formatError, getExitCode } from "./lib/errors.js";
import { error } from "./lib/formatters/colors.js";
import { withTelemetry } from "./lib/telemetry.js";

async function main(): Promise<void> {
  try {
    await withTelemetry(() =>
      run(app, process.argv.slice(2), buildContext(process))
    );
  } catch (err) {
    process.stderr.write(`${error("Error:")} ${formatError(err)}\n`);
    process.exit(getExitCode(err));
  }
}

main();
