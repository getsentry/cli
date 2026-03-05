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
import { formatBanner } from "../banner.js";
import { CLI_VERSION } from "../constants.js";
import { getAuthToken } from "../db/auth.js";
import { STEP_LABELS, WizardCancelledError } from "./clack-utils.js";
import {
  API_TIMEOUT_MS,
  MASTRA_API_URL,
  SENTRY_DOCS_URL,
  VERIFY_CHANGES_STEP,
  WORKFLOW_ID,
} from "./constants.js";
import { formatError, formatResult } from "./formatters.js";
import { handleInteractive } from "./interactive.js";
import { handleLocalOp, precomputeDirListing } from "./local-ops.js";
import type {
  SuspendPayload,
  WizardOptions,
  WorkflowRunResult,
} from "./types.js";

type Spinner = ReturnType<typeof spinner>;

type StepContext = {
  payload: SuspendPayload;
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
  stepPhases: Map<string, number>,
  stepHistory: Map<string, Record<string, unknown>[]>
): Promise<Record<string, unknown>> {
  const { payload, stepId, spin, options } = ctx;
  const label = STEP_LABELS[stepId] ?? stepId;

  if (payload.type === "local-op") {
    const detail = payload.operation ? ` (${payload.operation})` : "";
    spin.message(`${label}${detail}...`);

    const localResult = await handleLocalOp(payload, options);

    const history = stepHistory.get(stepId) ?? [];
    history.push(localResult);
    stepHistory.set(stepId, history);

    return {
      ...localResult,
      _phase: nextPhase(stepPhases, stepId, ["read-files", "analyze", "done"]),
      _prevPhases: history.slice(0, -1),
    };
  }

  if (payload.type === "interactive") {
    // In dry-run mode, verification always fails because no files were written
    // (the server skips apply-patchset). Auto-continue since this is expected.
    if (options.dryRun && stepId === VERIFY_CHANGES_STEP) {
      return {
        action: "continue",
        _phase: nextPhase(stepPhases, stepId, ["apply"]),
      };
    }

    spin.stop(label);

    const interactiveResult = await handleInteractive(payload, options);

    spin.start("Processing...");

    return {
      ...interactiveResult,
      _phase: nextPhase(stepPhases, stepId, ["apply"]),
    };
  }

  // Unreachable: assertSuspendPayload validates the type before we get here.
  // Kept as a defensive fallback.
  spin.stop("Error", 1);
  log.error(
    `Unknown suspend payload type "${(payload as { type: string }).type}"`
  );
  cancel("Setup failed");
  throw new WizardCancelledError();
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function assertWorkflowResult(raw: unknown): WorkflowRunResult {
  if (!raw || typeof raw !== "object") {
    throw new Error("Invalid workflow response: expected object");
  }
  const obj = raw as Record<string, unknown>;
  if (
    typeof obj.status !== "string" ||
    !["suspended", "success", "failed"].includes(obj.status)
  ) {
    throw new Error(`Unexpected workflow status: ${String(obj.status)}`);
  }
  return obj as WorkflowRunResult;
}

function assertSuspendPayload(raw: unknown): SuspendPayload {
  if (!raw || typeof raw !== "object") {
    throw new Error("Invalid suspend payload: expected object");
  }
  const obj = raw as Record<string, unknown>;
  if (
    typeof obj.type !== "string" ||
    !["local-op", "interactive"].includes(obj.type)
  ) {
    throw new Error(`Unknown suspend payload type: ${String(obj.type)}`);
  }
  return obj as SuspendPayload;
}

/**
 * Race a promise against a timeout. Rejects with a descriptive error
 * if the promise doesn't settle within `ms` milliseconds.
 */
function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms / 1000}s`)),
      ms
    );
    promise.then(
      (val) => {
        clearTimeout(timer);
        resolve(val);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
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

  const spin = spinner();

  spin.start("Scanning project...");
  const dirListing = precomputeDirListing(directory);

  let run: Awaited<ReturnType<typeof workflow.createRun>>;
  let result: WorkflowRunResult;
  try {
    spin.message("Connecting to wizard...");
    run = await workflow.createRun();
    result = assertWorkflowResult(
      await withTimeout(
        run.startAsync({
          inputData: { directory, force, yes, dryRun, features, dirListing },
          tracingOptions,
        }),
        API_TIMEOUT_MS,
        "Workflow start"
      )
    );
  } catch (err) {
    spin.stop("Connection failed", 1);
    log.error(errorMessage(err));
    cancel("Setup failed");
    process.exitCode = 1;
    return;
  }

  const stepPhases = new Map<string, number>();
  const stepHistory = new Map<string, Record<string, unknown>[]>();

  try {
    while (result.status === "suspended") {
      const stepPath = result.suspended?.at(0) ?? [];
      const stepId: string = stepPath.at(-1) ?? "unknown";

      const extracted = extractSuspendPayload(result, stepId);
      if (!extracted) {
        spin.stop("Error", 1);
        log.error(`No suspend payload found for step "${stepId}"`);
        cancel("Setup failed");
        process.exitCode = 1;
        return;
      }

      const resumeData = await handleSuspendedStep(
        { payload: extracted.payload, stepId: extracted.stepId, spin, options },
        stepPhases,
        stepHistory
      );

      result = assertWorkflowResult(
        await withTimeout(
          run.resumeAsync({
            step: extracted.stepId,
            resumeData,
            tracingOptions,
          }),
          API_TIMEOUT_MS,
          "Workflow resume"
        )
      );
    }
  } catch (err) {
    if (err instanceof WizardCancelledError) {
      process.exitCode = 1;
      return;
    }
    spin.stop("Error", 1);
    log.error(errorMessage(err));
    cancel("Setup failed");
    process.exitCode = 1;
    return;
  }

  handleFinalResult(result, spin);
}

function handleFinalResult(result: WorkflowRunResult, spin: Spinner): void {
  const hasError = result.status !== "success" || result.result?.exitCode;

  if (hasError) {
    spin.stop("Failed", 1);
    formatError(result);
    process.exitCode = 1;
  } else {
    spin.stop("Done");
    formatResult(result);
  }
}

function extractSuspendPayload(
  result: WorkflowRunResult,
  stepId: string
): { payload: SuspendPayload; stepId: string } | undefined {
  const stepPayload = result.steps?.[stepId]?.suspendPayload;
  if (stepPayload) {
    return { payload: assertSuspendPayload(stepPayload), stepId };
  }

  if (result.suspendPayload) {
    return { payload: assertSuspendPayload(result.suspendPayload), stepId };
  }

  for (const key of Object.keys(result.steps ?? {})) {
    const step = result.steps?.[key];
    if (step?.suspendPayload) {
      return {
        payload: assertSuspendPayload(step.suspendPayload),
        stepId: key,
      };
    }
  }

  return;
}
