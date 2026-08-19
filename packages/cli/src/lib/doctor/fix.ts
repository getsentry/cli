import type { SentryContext } from "../../context.js";
import { logger } from "../logger.js";
import type { DoctorReport } from "./render.js";

export async function runFix(
  _ctx: SentryContext,
  _report: DoctorReport
): Promise<void> {
  await Promise.resolve();
  logger.warn("--fix is not implemented yet.");
}
