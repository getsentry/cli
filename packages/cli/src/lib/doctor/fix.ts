/**
 * `--fix`: escalate from diagnosis to the setup workflow's plan.
 *
 * Always dry-run. Doctor's promise is that it changes nothing, and `--fix`
 * does not revoke it -- it produces a plan to hand to a human or an agent.
 */

import type { SentryContext } from "../../context.js";
import { runWizard } from "../init/wizard-runner.js";
import { logger } from "../logger.js";
import type { DoctorReport } from "./render.js";

/** Failing check id -> the wizard feature that addresses it. */
const FEATURE_BY_CHECK: Record<string, string> = {
  "artifacts.uploaded": "sourcemaps",
  "release.attribution": "sourcemaps",
  "config.sample_rate": "performance",
};

/**
 * `--features` is mandatory outside a TTY, so this is not a nicety -- without
 * it the wizard cannot run non-interactively at all.
 */
export function deriveFeatures(report: DoctorReport): string[] {
  const features = new Set<string>();
  for (const result of report.results) {
    if (result.status !== "fail") {
      continue;
    }
    const feature = FEATURE_BY_CHECK[result.id];
    if (feature) {
      features.add(feature);
    }
  }
  return [...features];
}

export async function runFix(
  ctx: SentryContext,
  report: DoctorReport
): Promise<void> {
  logger.info(
    "Running the setup workflow to build a fix plan. This takes a few minutes and changes nothing on disk."
  );

  let result: Awaited<ReturnType<typeof runWizard>>;
  try {
    result = await runWizard({
      directory: ctx.cwd,
      yes: true,
      dryRun: true,
      features: deriveFeatures(report),
    });
  } catch (error) {
    // A failed fix plan is not a failed diagnosis. The report already shipped.
    logger.warn(
      `Could not build a fix plan: ${(error as Error).message}. The findings above still stand.`
    );
    return;
  }

  const plan = result?.result?.codemodPlan ?? [];
  if (plan.length === 0) {
    logger.info("The setup workflow proposed no changes.");
    return;
  }

  logger.info("Fix plan:");
  for (const [i, entry] of plan.entries()) {
    const risk = entry.riskLevel ? ` [${entry.riskLevel} risk]` : "";
    logger.info(
      `  ${i + 1}. ${entry.description ?? "(no description)"}${risk}`
    );
  }
}
