#!/usr/bin/env node
import { run } from "@stricli/core";
import { app } from "./app.js";
import { buildContext } from "./context.js";
import { formatError, getExitCode } from "./lib/errors.js";
import { error } from "./lib/formatters/colors.js";
import {
  extractCommand,
  isTelemetryEnabled,
  TELEMETRY_FLAG,
  withTelemetry,
} from "./lib/telemetry.js";

const args = process.argv.slice(2);

// Check for --no-telemetry flag and remove it from args passed to CLI
const noTelemetryFlag = args.includes(TELEMETRY_FLAG);
const filteredArgs = noTelemetryFlag
  ? args.filter((a) => a !== TELEMETRY_FLAG)
  : args;

// Telemetry is enabled unless explicitly disabled via flag or env var
const telemetryEnabled = !noTelemetryFlag && isTelemetryEnabled();
const command = extractCommand(filteredArgs);

try {
  await withTelemetry({ enabled: telemetryEnabled, command }, () =>
    run(app, filteredArgs, buildContext(process))
  );
} catch (err) {
  process.stderr.write(`${error("Error:")} ${formatError(err)}\n`);
  process.exit(getExitCode(err));
}
