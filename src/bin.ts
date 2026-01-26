#!/usr/bin/env node
import { parseArgs } from "node:util";
import { run } from "@stricli/core";
import { app } from "./app.js";
import { buildContext } from "./context.js";
import { formatError, getExitCode } from "./lib/errors.js";
import { error } from "./lib/formatters/colors.js";
import { TELEMETRY_ENV_VAR, withTelemetry } from "./lib/telemetry.js";

async function main(): Promise<void> {
  // Parse global flags before passing to stricli
  // allowPositionals: true lets us capture subcommands and their args
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: {
      "no-telemetry": { type: "boolean", default: false },
    },
    allowPositionals: true,
    // Don't error on unknown flags - stricli will handle them
    strict: false,
  });

  // Telemetry is enabled unless explicitly disabled via flag or env var
  const telemetryEnabled =
    !values["no-telemetry"] && process.env[TELEMETRY_ENV_VAR] !== "1";

  try {
    await withTelemetry(telemetryEnabled, () =>
      run(app, positionals, buildContext(process))
    );
  } catch (err) {
    process.stderr.write(`${error("Error:")} ${formatError(err)}\n`);
    process.exit(getExitCode(err));
  }
}

main();
