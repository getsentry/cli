/**
 * The support export: the report, sent to Sentry, only if asked in person.
 *
 * Two gates, and every one of them is a reason not to ask. The report is
 * already on stdout — `sentry doctor --json` is the primary path and this is
 * a convenience, so a silent no-op is always an acceptable outcome here.
 */

import { isatty } from "node:tty";
// biome-ignore lint/performance/noNamespaceImport: Sentry SDK recommends namespace import
import * as Sentry from "@sentry/node-core/light";
import { detectAgent } from "../detect-agent.js";
import { logger } from "../logger.js";
import type { DoctorReport } from "./render.js";

const FLUSH_TIMEOUT_MS = 3000;

/** This payload is opt-in. Telemetry-off must not swallow a yes. */
async function sendSupportReport(
  report: DoctorReport,
  summary: string
): Promise<void> {
  const body = JSON.stringify(report, null, 2);
  const client = Sentry.getClient();
  const opts = client?.getOptions();
  const wasOff = opts?.enabled === false;
  if (wasOff && opts) {
    opts.enabled = true;
  }
  try {
    const { getUserInfo } = await import("../db/user.js");
    const user = getUserInfo();
    Sentry.captureFeedback(
      {
        message: `sentry doctor report — ${summary}`,
        email: user?.email,
        name: user?.name ?? user?.username,
      },
      {
        attachments: [
          {
            filename: "sentry-doctor-report.json",
            data: body,
            contentType: "application/json",
          },
        ],
      }
    );
    await Sentry.flush(FLUSH_TIMEOUT_MS);
  } finally {
    if (wasOff && opts) {
      opts.enabled = false;
    }
  }
}

export async function offerSupportExport(
  report: DoctorReport,
  json = false
): Promise<boolean> {
  // Nobody is here to consent, or the party present cannot consent
  // on the user's behalf. `--json` is a machine path even when stdin
  // is still a TTY (`sentry doctor --json > report.json`).
  if (json || !isatty(0) || detectAgent() !== undefined) {
    return false;
  }

  const failing = report.results.filter((r) => r.status === "fail");
  const ids = failing.map((r) => r.id).join(", ");
  const summary =
    failing.length > 0
      ? `${failing.length} failing check(s): ${ids}`
      : "no failing checks";
  const answer = await logger.prompt(
    `Send this report to Sentry support? (${summary})`,
    {
      type: "confirm",
      initial: false,
    }
  );
  // Symbol(clack:cancel) is truthy — strict equality check
  if (answer !== true) {
    return false;
  }

  await sendSupportReport(report, summary);

  logger.success(
    failing.length > 0
      ? "Report sent. Reference the failing check ids with support."
      : "Report sent."
  );
  return true;
}
