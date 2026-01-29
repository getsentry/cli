import { run } from "@stricli/core";
import { app } from "./app.js";
import { buildContext } from "./context.js";
import { formatError, getExitCode } from "./lib/errors.js";
import { error } from "./lib/formatters/colors.js";
import { withTelemetry } from "./lib/telemetry.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  try {
    await withTelemetry(async () => run(app, args, buildContext(process)));
  } catch (err) {
    process.stderr.write(`${error("Error:")} ${formatError(err)}\n`);
    process.exit(getExitCode(err));
  }
}

main();
