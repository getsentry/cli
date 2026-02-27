/**
 * Wizard Runner
 *
 * Main suspend/resume loop that drives the remote Mastra workflow.
 * Each iteration: check status → if suspended, perform local-op or
 * interactive prompt → resume with result → repeat.
 */

import { randomBytes } from "node:crypto";
import { cancel, intro, log, spinner } from "@clack/prompts";
import { MastraClient } from "@mastra/client-js";
import { CLI_VERSION } from "../constants.js";
import { getAuthToken } from "../db/auth.js";
import { formatBanner } from "../help.js";
import { STEP_LABELS, WizardCancelledError } from "./clack-utils.js";
import {
  MASTRA_API_URL,
  SENTRY_DOCS_URL,
  VERIFY_CHANGES_STEP,
  WORKFLOW_ID,
} from "./constants.js";
import { formatError, formatResult } from "./formatters.js";
import { handleInteractive } from "./interactive.js";
import { handleLocalOp } from "./local-ops.js";
import type {
  InteractivePayload,
  LocalOpPayload,
  WizardOptions,
  WorkflowRunResult,
} from "./types.js";

type Spinner = ReturnType<typeof spinner>;

type StepContext = {
  payload: unknown;
  stepId: string;
  spin: Spinner;
  options: WizardOptions;
};

function nextPhase(
  stepPhases: Map<string, number>,
  stepId: string,
  names: string[]
): string {
  const phase = (stepPhases.get(stepId) ?? 0) + 1;
  stepPhases.set(stepId, phase);
  return names[Math.min(phase - 1, names.length - 1)] ?? "done";
}

async function handleSuspendedStep(
  ctx: StepContext,
  stepPhases: Map<string, number>
): Promise<Record<string, unknown>> {
  const { payload, stepId, spin, options } = ctx;
  const { type: payloadType, operation } = payload as {
    type: string;
    operation?: string;
  };
  const label = STEP_LABELS[stepId] ?? stepId;

  if (payloadType === "local-op") {
    const detail = operation ? ` (${operation})` : "";
    spin.message(`${label}${detail}...`);

    const localResult = await handleLocalOp(payload as LocalOpPayload, options);

    return {
      ...localResult,
      _phase: nextPhase(stepPhases, stepId, ["read-files", "analyze", "done"]),
    };
  }

  if (payloadType === "interactive") {
    // In dry-run mode, verification always fails because no files were written
    // (the server skips apply-patchset). Auto-continue since this is expected.
    if (options.dryRun && stepId === VERIFY_CHANGES_STEP) {
      return {
        action: "continue",
        _phase: nextPhase(stepPhases, stepId, ["apply"]),
      };
    }

    spin.stop(label);

    const interactiveResult = await handleInteractive(
      payload as InteractivePayload,
      options
    );

    spin.start("Processing...");

    return {
      ...interactiveResult,
      _phase: nextPhase(stepPhases, stepId, ["apply"]),
    };
  }

  spin.stop("Error", 1);
  log.error(`Unknown suspend payload type "${payloadType}"`);
  cancel("Setup failed");
  throw new WizardCancelledError();
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function runWizard(options: WizardOptions): Promise<void> {
  const { directory, force, yes, dryRun, features } = options;

  if (!(yes || process.stdin.isTTY)) {
    process.stderr.write(
      "Error: Interactive mode requires a terminal. Use --yes for non-interactive mode.\n"
    );
    process.exitCode = 1;
    return;
  }

  process.stderr.write(`\n${formatBanner()}\n\n`);
  intro("sentry init");

  if (dryRun) {
    log.warn("Dry-run mode: no files will be modified.");
  }

  log.info(
    "This wizard uses AI to analyze your project and configure Sentry." +
      `\nFor manual setup: ${SENTRY_DOCS_URL}`
  );

  const tracingOptions = {
    traceId: randomBytes(16).toString("hex"),
    tags: ["sentry-cli", "init-wizard"],
    metadata: {
      cliVersion: CLI_VERSION,
      os: process.platform,
      arch: process.arch,
      nodeVersion: process.version,
      dryRun,
    },
  };

  const token = getAuthToken();
  const client = new MastraClient({
    baseUrl: MASTRA_API_URL,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const workflow = client.getWorkflow(WORKFLOW_ID);
  const run = await workflow.createRun();

  const spin = spinner();

  let result: WorkflowRunResult;
  try {
    spin.start("Connecting to wizard...");
    result = (await run.startAsync({
      inputData: { directory, force, yes, dryRun, features },
      tracingOptions,
    })) as WorkflowRunResult;
  } catch (err) {
    spin.stop("Connection failed", 1);
    log.error(errorMessage(err));
    cancel("Setup failed");
    return;
  }

  const stepPhases = new Map<string, number>();

  try {
    while (result.status === "suspended") {
      const stepPath = result.suspended?.at(0) ?? [];
      const stepId: string = stepPath.at(-1) ?? "unknown";

      const payload = extractSuspendPayload(result, stepId);
      if (!payload) {
        spin.stop("Error", 1);
        log.error(`No suspend payload found for step "${stepId}"`);
        cancel("Setup failed");
        return;
      }

      const resumeData = await handleSuspendedStep(
        { payload, stepId, spin, options },
        stepPhases
      );

      result = (await run.resumeAsync({
        step: stepId,
        resumeData,
        tracingOptions,
      })) as WorkflowRunResult;
    }
  } catch (err) {
    if (err instanceof WizardCancelledError) {
      return;
    }
    spin.stop("Cancelled", 1);
    log.error(errorMessage(err));
    cancel("Setup failed");
    return;
  }

  handleFinalResult(result, spin);
}

function handleFinalResult(result: WorkflowRunResult, spin: Spinner): void {
  const output = result as unknown as Record<string, unknown>;
  const inner = (output.result as Record<string, unknown>) ?? output;
  const hasError = result.status !== "success" || inner.exitCode;

  if (hasError) {
    spin.stop("Failed", 1);
    formatError(output);
  } else {
    spin.stop("Done");
    formatResult(output);
  }
}

function extractSuspendPayload(
  result: WorkflowRunResult,
  stepId: string
): unknown | undefined {
  const stepPayload = result.steps?.[stepId]?.suspendPayload;
  if (stepPayload) {
    return stepPayload;
  }

  if (result.suspendPayload) {
    return result.suspendPayload;
  }

  for (const key of Object.keys(result.steps ?? {})) {
    const step = result.steps?.[key];
    if (step?.suspendPayload) {
      return step.suspendPayload;
    }
  }

  return;
}
