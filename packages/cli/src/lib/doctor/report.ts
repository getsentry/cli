/**
 * The support export: the report, sent to Sentry, only if asked in person.
 *
 * Four gates, and every one of them is a reason not to ask. The report is
 * already on stdout — `sentry doctor --json` is the primary path and this is
 * a convenience, so a silent no-op is always an acceptable outcome here.
 */

import { isatty } from "node:tty";
// biome-ignore lint/performance/noNamespaceImport: Sentry SDK recommends namespace import
import * as Sentry from "@sentry/node-core/light";
import { detectAgent } from "../detect-agent.js";
import { logger } from "../logger.js";
import type { DoctorReport } from "./render.js";

/** Sentry's feedback message field is not a file upload; keep it sane. */
const MAX_MESSAGE_BYTES = 60_000;
const FLUSH_TIMEOUT_MS = 3000;

export async function offerSupportExport(
  report: DoctorReport
): Promise<boolean> {
  const failing = report.results.filter((r) => r.status === "fail");

  // Gate 1: nothing to send.
  if (failing.length === 0) {
    return false;
  }
  // Gates 2 and 3: nobody is here to consent, or the party present cannot
  // consent on the user's behalf.
  if (!isatty(0) || detectAgent() !== undefined) {
    return false;
  }
  // Gate 4: the telemetry gate `feedback.ts` already enforces. Saying so beats
  // prompting for something that would then fail.
  if (!Sentry.isEnabled()) {
    logger.debug("Doctor support export skipped: telemetry disabled");
    return false;
  }

  const ids = failing.map((r) => r.id).join(", ");
  const answer = await logger.prompt(
    `Send this report to Sentry support? (${failing.length} failing check(s): ${ids})`,
    { type: "confirm", initial: false }
  );
  // Symbol(clack:cancel) is truthy — strict equality check
  if (answer !== true) {
    return false;
  }

  // The report is already redacted at the capture boundary (Task 3); this is
  // a size guard, not a second sanitization pass.
  const body = JSON.stringify(report, null, 2).slice(0, MAX_MESSAGE_BYTES);

  Sentry.captureFeedback({
    name: "sentry doctor",
    message: `sentry doctor report\nfailing: ${ids}\n\n${body}`,
  });
  await Sentry.flush(FLUSH_TIMEOUT_MS);

  logger.success("Report sent. Reference the failing check ids with support.");
  return true;
}
