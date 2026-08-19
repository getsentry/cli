/**
 * `sentry doctor` — is Sentry actually working in this project?
 *
 * Four stages, only the first two do I/O. `auth: false` so an unauthenticated
 * run reports "unauthorized" as a finding rather than crashing, following the
 * `info.ts` pattern.
 */

import type { SentryContext } from "../context.js";
import { buildCommand } from "../lib/command.js";
import { CLI_VERSION } from "../lib/constants.js";
import { capture } from "../lib/doctor/capture.js";
import { REGISTRY } from "../lib/doctor/checks/index.js";
import {
  buildReport,
  type DoctorReport,
  exitCodeFor,
  formatDoctorReport,
} from "../lib/doctor/render.js";
import { resolveServerFacts } from "../lib/doctor/resolve.js";
import { runChecks } from "../lib/doctor/types.js";
import { CommandOutput } from "../lib/formatters/output.js";

export type DoctorFlags = {
  sendTestEvent: boolean;
  fix: boolean;
};

/** The whole command, minus presentation — so tests never touch the CLI. */
export async function runDoctor(
  ctx: SentryContext,
  flags: Partial<DoctorFlags> = {}
): Promise<{ report: DoctorReport; exitCode: 0 | 1 }> {
  const started = Date.now();

  const captured = await capture(ctx.cwd);
  const server = await resolveServerFacts(captured);
  const results = runChecks(REGISTRY, { capture: captured, server });

  const { judge } = await import("../lib/doctor/judge.js");
  results.push(...(await judge(captured)));

  if (flags.sendTestEvent) {
    const { liveRoundtripCheck } = await import("../lib/doctor/live.js");
    results.push(await liveRoundtripCheck(captured, server));
  } else {
    results.push({
      id: "live.roundtrip",
      status: "skip",
      detail: "Not requested. Run with --send-test-event.",
    });
  }

  return {
    report: buildReport({
      capture: captured,
      server,
      results,
      cliVersion: CLI_VERSION,
      timestamp: new Date(started).toISOString(),
      elapsedMs: Date.now() - started,
    }),
    exitCode: exitCodeFor(results),
  };
}

export const doctorCommand = buildCommand({
  // Runs unauthenticated; a missing session becomes a finding, not a crash.
  auth: false,
  docs: {
    brief: "Check whether Sentry is correctly set up and actually working",
    fullDescription:
      "Inspects this project's Sentry configuration, asks Sentry what it has " +
      "actually received, and reports what is wrong along with instructions " +
      "to fix it. Reads only, unless you pass --send-test-event.",
  },
  output: { human: formatDoctorReport },
  parameters: {
    flags: {
      sendTestEvent: {
        kind: "boolean",
        brief:
          "Send a synthetic event to the configured DSN and confirm it arrives (a write)",
        default: false,
      },
      fix: {
        kind: "boolean",
        brief: "After reporting, run the setup workflow to produce a fix plan",
        default: false,
      },
    },
    positional: { kind: "tuple", parameters: [] },
  },
  async *func(this: SentryContext, flags: DoctorFlags) {
    const { report, exitCode } = await runDoctor(this, flags);

    yield new CommandOutput(report);

    const { offerSupportExport } = await import("../lib/doctor/report.js");
    await offerSupportExport(report);

    if (flags.fix && exitCode !== 0) {
      const { runFix } = await import("../lib/doctor/fix.js");
      await runFix(this, report);
    }

    // Set last: a broken project is a finding, and the report is the payload.
    this.process.exitCode = exitCode;
  },
});

export default doctorCommand;
