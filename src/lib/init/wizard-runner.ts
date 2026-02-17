/**
 * Wizard Runner
 *
 * Main suspend/resume loop that drives the remote Mastra workflow.
 * Each iteration: check status → if suspended, perform local-op or
 * interactive prompt → resume with result → repeat.
 */

import { MastraClient } from "@mastra/client-js";
import { CLI_VERSION } from "../constants.js";
import { MASTRA_API_URL, WORKFLOW_ID } from "./constants.js";
import { formatProgress, formatResult, formatError } from "./formatters.js";
import { handleLocalOp } from "./local-ops.js";
import { handleInteractive } from "./interactive.js";
import type {
  WizardOptions,
  LocalOpPayload,
  InteractivePayload,
} from "./types.js";

export async function runWizard(options: WizardOptions): Promise<void> {
  const { directory, force, yes, dryRun, features, stdout, stderr } = options;

  const tracingOptions = {
    tags: ["sentry-cli", "init-wizard"],
    metadata: {
      cliVersion: CLI_VERSION,
      os: process.platform,
      arch: process.arch,
      nodeVersion: process.version,
      dryRun,
    },
  };

  const client = new MastraClient({ baseUrl: MASTRA_API_URL });
  const workflow = client.getWorkflow(WORKFLOW_ID);
  const run = await workflow.createRun();

  let result = await run.startAsync({
    inputData: { directory, force, yes, dryRun, features },
    tracingOptions,
  });

  // Track multi-suspend phases per step
  const stepPhases = new Map<string, number>();

  while ((result as any).status === "suspended") {
    // Extract step ID and suspend payload
    const stepPath =
      (result as any).suspended?.[0] ??
      (result as any).activePaths?.[0] ??
      [];
    const stepId: string = stepPath[stepPath.length - 1] ?? "unknown";

    const payload = extractSuspendPayload(result as Record<string, any>, stepId);
    if (!payload) {
      stderr.write(`Error: No suspend payload found for step "${stepId}"\n`);
      break;
    }

    formatProgress(stdout, stepId, payload);

    let resumeData: Record<string, any>;
    const payloadType = (payload as any).type as string;

    if (payloadType === "local-op") {
      const localResult = await handleLocalOp(
        payload as LocalOpPayload,
        options,
      );

      // Track phase progression for multi-suspend steps
      const phase = (stepPhases.get(stepId) ?? 0) + 1;
      stepPhases.set(stepId, phase);
      const phaseNames = ["read-files", "analyze", "done"];
      resumeData = {
        ...localResult,
        _phase: phaseNames[Math.min(phase - 1, phaseNames.length - 1)],
      };
    } else if (payloadType === "interactive") {
      const interactiveResult = await handleInteractive(
        payload as InteractivePayload,
        options,
      );
      const phase = (stepPhases.get(stepId) ?? 0) + 1;
      stepPhases.set(stepId, phase);
      resumeData = {
        ...interactiveResult,
        _phase: "apply",
      };
    } else {
      stderr.write(`Error: Unknown suspend payload type "${payloadType}"\n`);
      break;
    }

    result = await run.resumeAsync({
      step: stepId,
      resumeData,
      tracingOptions,
    });
  }

  const resultObj = result as Record<string, any>;
  if (resultObj.status === "success") {
    formatResult(stdout, resultObj);
  } else {
    formatError(stderr, resultObj);
  }
}

function extractSuspendPayload(
  result: Record<string, any>,
  stepId: string,
): unknown | undefined {
  // Try step-specific payload first
  const stepPayload = result.steps?.[stepId]?.suspendPayload;
  if (stepPayload) return stepPayload;

  // Try top-level suspend payload
  if (result.suspendPayload) return result.suspendPayload;

  // Try nested in activePaths data
  for (const key of Object.keys(result.steps ?? {})) {
    const step = result.steps[key];
    if (step?.suspendPayload) return step.suspendPayload;
  }

  return undefined;
}
