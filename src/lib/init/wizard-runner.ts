/**
 * Wizard Runner
 *
 * Main suspend/resume loop that drives the remote Mastra workflow.
 * Each iteration: check status → if suspended, perform local-op or
 * interactive prompt → resume with result → repeat.
 */

import { randomBytes } from "node:crypto";
import {
  cancel,
  confirm,
  intro,
  isCancel,
  log,
  select,
  spinner,
} from "@clack/prompts";
import { MastraClient } from "@mastra/client-js";
import { captureException, getTraceData } from "@sentry/node-core/light";
import { formatBanner } from "../banner.js";
import { CLI_VERSION } from "../constants.js";
import { getAuthToken } from "../db/auth.js";
import { terminalLink } from "../formatters/colors.js";
import { slugify } from "../utils.js";
import {
  abortIfCancelled,
  STEP_LABELS,
  WizardCancelledError,
} from "./clack-utils.js";
import {
  API_TIMEOUT_MS,
  MASTRA_API_URL,
  SENTRY_DOCS_URL,
  VERIFY_CHANGES_STEP,
  WORKFLOW_ID,
} from "./constants.js";
import { formatError, formatResult } from "./formatters.js";
import { checkGitStatus } from "./git.js";
import { handleInteractive } from "./interactive.js";
import {
  detectExistingProject,
  handleLocalOp,
  precomputeDirListing,
  resolveOrgSlug,
  tryGetExistingProject,
} from "./local-ops.js";
import type {
  LocalOpResult,
  SuspendPayload,
  WizardOptions,
  WorkflowRunResult,
} from "./types.js";

type Spinner = ReturnType<typeof spinner>;

type SpinState = { running: boolean };

type StepContext = {
  payload: SuspendPayload;
  stepId: string;
  spin: Spinner;
  spinState: SpinState;
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

/**
 * Truncate a spinner message to fit within the terminal width.
 * Leaves room for the spinner character and padding.
 */
function truncateForTerminal(message: string): string {
  // Reserve space for spinner (2 chars) + some padding
  const maxWidth = (process.stdout.columns || 80) - 4;
  if (message.length <= maxWidth) {
    return message;
  }
  return `${message.slice(0, maxWidth - 1)}…`;
}

async function handleSuspendedStep(
  ctx: StepContext,
  stepPhases: Map<string, number>,
  stepHistory: Map<string, Record<string, unknown>[]>
): Promise<Record<string, unknown>> {
  const { payload, stepId, spin, spinState, options } = ctx;
  const label = STEP_LABELS[stepId] ?? stepId;

  if (payload.type === "local-op") {
    const message = payload.detail
      ? payload.detail
      : `${label} (${payload.operation})...`;
    spin.message(truncateForTerminal(message));

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
    spinState.running = false;

    const interactiveResult = await handleInteractive(payload, options);

    spin.start("Processing...");
    spinState.running = true;

    return {
      ...interactiveResult,
      _phase: nextPhase(stepPhases, stepId, ["apply"]),
    };
  }

  // Unreachable: assertSuspendPayload validates the type before we get here.
  // Kept as a defensive fallback.
  spin.stop("Error", 1);
  spinState.running = false;
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

/** Returns `true` if the user confirmed, `false` if they declined. */
async function confirmExperimental(yes: boolean): Promise<boolean> {
  if (yes) {
    return true;
  }
  const proceed = await confirm({
    message:
      "EXPERIMENTAL: This feature is experimental and may modify your code. Continue?",
  });
  abortIfCancelled(proceed);
  return !!proceed;
}

/**
 * Pre-flight checks: TTY guard, banner, intro, and experimental warning.
 * Returns `true` when the wizard should continue, `false` to abort.
 */
async function preamble(
  directory: string,
  yes: boolean,
  dryRun: boolean
): Promise<boolean> {
  if (!(yes || process.stdin.isTTY)) {
    process.stderr.write(
      "Error: Interactive mode requires a terminal. Use --yes for non-interactive mode.\n"
    );
    process.exitCode = 1;
    return false;
  }

  process.stderr.write(`\n${formatBanner()}\n\n`);
  intro("sentry init");

  let confirmed: boolean;
  try {
    confirmed = await confirmExperimental(yes);
  } catch (err) {
    if (err instanceof WizardCancelledError) {
      // Intentionally captured: track why users bail before completing
      // instrumentation so we can improve the onboarding flow.
      captureException(err);
      process.exitCode = 0;
      return false;
    }
    throw err;
  }
  if (!confirmed) {
    cancel("Setup cancelled.");
    process.exitCode = 0;
    return false;
  }

  if (dryRun) {
    log.warn("Dry-run mode: no files will be modified.");
  }

  const gitOk = await checkGitStatus({ cwd: directory, yes });
  if (!gitOk) {
    cancel("Setup cancelled.");
    process.exitCode = 0;
    return false;
  }

  return true;
}

/**
 * Resolve org and detect an existing Sentry project before the spinner starts.
 *
 * Clack requires all interactive prompts to complete before any spinner/task
 * begins — the spinner's setInterval writes output below an active prompt if
 * interleaved. This function surfaces all interactive decisions upfront.
 *
 * @returns Updated options with org and project resolved, or `null` to abort.
 *          When `null` is returned, `process.exitCode` is already set.
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: sequential wizard pre-flight branches are inherently nested
async function resolvePreSpinnerOptions(
  options: WizardOptions
): Promise<WizardOptions | null> {
  const { directory, yes } = options;
  let opts = options;

  if (!(opts.org || opts.project)) {
    const existing = await detectExistingProject(directory);
    if (existing) {
      if (yes) {
        opts = {
          ...opts,
          org: existing.orgSlug,
          project: existing.projectSlug,
        };
      } else {
        const choice = await select({
          message: "Found an existing Sentry project in this codebase.",
          options: [
            {
              value: "existing" as const,
              label: `Use existing project (${existing.orgSlug}/${existing.projectSlug})`,
              hint: "Sentry is already configured here",
            },
            {
              value: "create" as const,
              label: "Create a new Sentry project",
            },
          ],
        });
        if (isCancel(choice)) {
          cancel("Setup cancelled.");
          process.exitCode = 0;
          return null;
        }
        if (choice === "existing") {
          opts = {
            ...opts,
            org: existing.orgSlug,
            project: existing.projectSlug,
          };
        }
      }
    }
  }

  if (!opts.org) {
    let orgResult: string | LocalOpResult;
    try {
      orgResult = await resolveOrgSlug(directory, yes);
    } catch (err) {
      if (err instanceof WizardCancelledError) {
        cancel("Setup cancelled.");
        process.exitCode = 0;
        return null;
      }
      log.error(errorMessage(err));
      cancel("Setup failed.");
      process.exitCode = 1;
      return null;
    }
    if (typeof orgResult !== "string") {
      log.error(orgResult.error ?? "Failed to resolve organization.");
      cancel("Setup failed.");
      process.exitCode = 1;
      return null;
    }
    opts = { ...opts, org: orgResult };
  }

  // Bare slug case: user ran `sentry init my-app` (project set, org not originally
  // provided). Org was just resolved above. Check if this named project already
  // exists in the resolved org and prompt the user — must happen before the spinner.
  if (opts.project && !options.org && opts.org) {
    const slug = slugify(opts.project);
    const resolvedOrg = opts.org;
    if (slug) {
      try {
        const existing = await tryGetExistingProject(resolvedOrg, slug);
        if (existing && !yes) {
          const choice = await select({
            message: `Found existing project '${slug}' in ${resolvedOrg}.`,
            options: [
              {
                value: "existing" as const,
                label: `Use existing (${resolvedOrg}/${slug})`,
                hint: "Already configured",
              },
              {
                value: "create" as const,
                label: "Create a new project",
                hint: "Wizard will detect the project name from your codebase",
              },
            ],
          });
          if (isCancel(choice)) {
            cancel("Setup cancelled.");
            process.exitCode = 0;
            return null;
          }
          if (choice === "create") {
            // Clear project so the wizard auto-detects the name from the codebase
            opts = { ...opts, project: undefined };
          }
        }
      } catch {
        // API error checking for existing project — proceed and let createSentryProject handle it
      }
    }
  }

  return opts;
}

export async function runWizard(initialOptions: WizardOptions): Promise<void> {
  const { directory, yes, dryRun, features } = initialOptions;

  if (!(await preamble(directory, yes, dryRun))) {
    return;
  }

  log.info(
    "This wizard uses AI to analyze your project and configure Sentry." +
      `\nFor manual setup: ${terminalLink(SENTRY_DOCS_URL)}`
  );

  const options = await resolvePreSpinnerOptions(initialOptions);
  if (!options) {
    return;
  }

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
    fetch: ((url, init) => {
      const traceData = getTraceData();
      return fetch(url, {
        ...init,
        headers: {
          ...(init?.headers as Record<string, string> | undefined),
          ...(traceData["sentry-trace"] && {
            "sentry-trace": traceData["sentry-trace"],
          }),
          ...(traceData.baggage && { baggage: traceData.baggage }),
        },
      });
    }) as typeof fetch,
  });
  const workflow = client.getWorkflow(WORKFLOW_ID);

  const spin = spinner();
  const spinState: SpinState = { running: false };

  spin.start("Scanning project...");
  spinState.running = true;

  let run: Awaited<ReturnType<typeof workflow.createRun>>;
  let result: WorkflowRunResult;
  try {
    const dirListing = precomputeDirListing(directory);
    spin.message("Connecting to wizard...");
    run = await workflow.createRun();
    result = assertWorkflowResult(
      await withTimeout(
        run.startAsync({
          inputData: { directory, yes, dryRun, features, dirListing },
          tracingOptions,
        }),
        API_TIMEOUT_MS,
        "Workflow start"
      )
    );
  } catch (err) {
    spin.stop("Connection failed", 1);
    spinState.running = false;
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
        spinState.running = false;
        log.error(`No suspend payload found for step "${stepId}"`);
        cancel("Setup failed");
        process.exitCode = 1;
        return;
      }

      const resumeData = await handleSuspendedStep(
        {
          payload: extracted.payload,
          stepId: extracted.stepId,
          spin,
          spinState,
          options,
        },
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
      // Intentionally captured: track why users bail before completing
      // instrumentation so we can improve the onboarding flow.
      captureException(err);
      process.exitCode = 0;
      return;
    }
    if (spinState.running) {
      spin.stop("Error", 1);
      spinState.running = false;
    }
    log.error(errorMessage(err));
    cancel("Setup failed");
    process.exitCode = 1;
    return;
  }

  handleFinalResult(result, spin, spinState);
}

function handleFinalResult(
  result: WorkflowRunResult,
  spin: Spinner,
  spinState: SpinState
): void {
  const hasError = result.status !== "success" || result.result?.exitCode;

  if (hasError) {
    if (spinState.running) {
      spin.stop("Failed", 1);
      spinState.running = false;
    }
    formatError(result);
    process.exitCode = 1;
  } else {
    if (spinState.running) {
      spin.stop("Done");
      spinState.running = false;
    }
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
