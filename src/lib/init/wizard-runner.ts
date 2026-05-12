/**
 * Wizard Runner
 *
 * Main suspend/resume loop that drives the remote Mastra workflow.
 * Each iteration: check status → if suspended, perform tool or
 * interactive prompt → resume with result → repeat.
 *
 * All UI I/O — banners, spinners, logs, prompts, outro — flows through
 * a single `WizardUI` instance constructed by `getUI()`. The runner
 * itself is implementation-agnostic: it works the same against
 * `LoggingUI` (CI / `--yes`) and `InkUI` (interactive terminal).
 */

import { randomBytes } from "node:crypto";

import { MastraClient } from "@mastra/client-js";
import {
  captureException,
  getTraceData,
  setTag,
} from "@sentry/node-core/light";
import { formatBanner } from "../banner.js";
import { CLI_VERSION } from "../constants.js";
import { detectAgent } from "../detect-agent.js";
import { EXIT, WizardError } from "../errors.js";
import {
  renderInlineMarkdown,
  stripColorTags,
} from "../formatters/markdown.js";
import {
  abortIfCancelled,
  STEP_ACTIVE_LABELS,
  STEP_LABELS,
  WizardCancelledError,
} from "./clack-utils.js";
import {
  API_TIMEOUT_MS,
  EXIT_DEPENDENCY_INSTALL_FAILED,
  EXIT_PLATFORM_NOT_DETECTED,
  EXIT_VERIFICATION_FAILED,
  MASTRA_API_URL,
  VERIFY_CHANGES_STEP,
  WORKFLOW_ID,
} from "./constants.js";
import { formatError, formatResult } from "./formatters.js";
import { checkGitStatus } from "./git.js";
import { handleInteractive } from "./interactive.js";
import { resolveInitContext } from "./preflight.js";
import { checkReadiness } from "./readiness.js";

import { describeTool, executeTool } from "./tools/registry.js";
import type {
  ResolvedInitContext,
  SuspendPayload,
  WizardOptions,
  WorkflowRunResult,
} from "./types.js";
import { getUIAsync } from "./ui/factory.js";
import { LoggingUIPromptError } from "./ui/logging-ui.js";
import type { SpinnerHandle, WelcomeOptions, WizardUI } from "./ui/types.js";
import {
  precomputeDirListing,
  precomputeSentryDetection,
  preReadCommonFiles,
} from "./workflow-inputs.js";

type SpinState = { running: boolean };

type StepContext = {
  payload: SuspendPayload;
  stepId: string;
  spin: SpinnerHandle;
  spinState: SpinState;
  context: ResolvedInitContext;
  ui: WizardUI;
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
  return message.split("\n").map(truncateLineForTerminal).join("\n");
}

function truncateLineForTerminal(line: string): string {
  const maxWidth = (process.stdout.columns || 80) - 4;
  const visibleLine = stripColorTags(line).replace(/`/g, "");
  if (visibleLine.length <= maxWidth) {
    return line;
  }
  let truncated = line.slice(0, maxWidth - 1);
  const backtickCount = truncated.split("`").length - 1;
  if (backtickCount % 2 !== 0) {
    const lastBacktick = truncated.lastIndexOf("`");
    truncated =
      truncated.slice(0, lastBacktick) + truncated.slice(lastBacktick + 1);
  }
  return `${truncated}…`;
}

type ReadFilesDisplay = {
  paths: string[];
  phase: "reading" | "analyzing";
};

function formatReadFilesSummary(progress: ReadFilesDisplay): string {
  const { paths, phase } = progress;
  const count = paths.length;
  if (count === 0) {
    return phase === "analyzing" ? "Analyzing files..." : "Reading files...";
  }
  if (phase === "analyzing") {
    return count === 1 ? "Analyzing 1 file..." : `Analyzing ${count} files...`;
  }
  return count === 1 ? "Reading 1 file..." : `Reading ${count} files...`;
}

/**
 * Build a follow-up spinner message after a tool succeeds and the CLI is
 * waiting for the server to continue processing the returned data.
 */
function describePostTool(payload: SuspendPayload): string | undefined {
  if (payload.type !== "tool") {
    return;
  }

  switch (payload.operation) {
    case "read-files":
      return formatReadFilesSummary({
        paths: payload.params.paths,
        phase: "analyzing",
      });
    case "list-dir":
      return "Analyzing directory structure...";
    case "file-exists-batch":
      return "Analyzing project files...";
    default:
      return;
  }
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: suspend handling needs to branch across tool and interactive payload kinds
async function handleSuspendedStep(
  ctx: StepContext,
  stepPhases: Map<string, number>,
  stepHistory: Map<string, Record<string, unknown>[]>
): Promise<Record<string, unknown>> {
  const { payload, stepId, spin, spinState, context, ui } = ctx;
  const label = STEP_LABELS[stepId] ?? stepId;

  if (payload.type === "tool") {
    const message =
      ("detail" in payload && typeof payload.detail === "string"
        ? payload.detail
        : undefined) ??
      (payload.operation === "read-files"
        ? formatReadFilesSummary({
            paths: payload.params.paths,
            phase: "reading",
          })
        : describeTool(payload));
    spin.message(renderInlineMarkdown(truncateForTerminal(message)));

    // Inline / sidebar file-read status (`InkUI` only — `LoggingUI`
    // leaves these methods undefined). The previous flow showed a
    // half-second tree of files in the spinner before the next tool
    // overwrote it; users couldn't see what context the wizard
    // looked at. We feed the read paths into the status indicator
    // before the tool runs, then mark them analyzed afterwards.
    if (payload.operation === "read-files") {
      ui.recordFilesReading?.(payload.params.paths);
    }

    const toolResult = await executeTool(payload, context);

    if (toolResult.message) {
      spin.stop(renderInlineMarkdown(toolResult.message));
      spin.start("Processing...");
    } else {
      const followUpMessage =
        toolResult.ok === false ? undefined : describePostTool(payload);
      if (followUpMessage) {
        spin.message(
          renderInlineMarkdown(truncateForTerminal(followUpMessage))
        );
      }
    }

    if (payload.operation === "read-files" && toolResult.ok !== false) {
      ui.markFilesAnalyzed?.(payload.params.paths);
    }

    const history = stepHistory.get(stepId) ?? [];
    history.push(toolResult);
    stepHistory.set(stepId, history);

    return {
      ...toolResult,
      _phase: nextPhase(stepPhases, stepId, ["read-files", "analyze", "done"]),
      _prevPhases: history.slice(0, -1),
    };
  }

  if (payload.type === "interactive") {
    if (context.dryRun && stepId === VERIFY_CHANGES_STEP) {
      return {
        action: "continue",
        _phase: nextPhase(stepPhases, stepId, ["apply"]),
      };
    }

    spin.stop(label);
    spinState.running = false;

    const interactiveResult = await handleInteractive(payload, context, ui);

    spin.start("Processing...");
    spinState.running = true;

    return {
      ...interactiveResult,
      _phase: nextPhase(stepPhases, stepId, ["apply"]),
    };
  }

  spin.stop("Error", 1);
  spinState.running = false;
  const message = `Unknown suspend payload type "${(payload as { type: string }).type}"`;
  ui.log.error(message);
  throw new WizardError(message);
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function showCancelledFeedback(ui: WizardUI): void {
  ui.cancel("Setup cancelled.");
  ui.feedback("cancelled");
}

function showFailedFeedback(ui: WizardUI, message = "Setup failed"): void {
  ui.cancel(message);
  ui.feedback("failed");
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
    !["tool", "interactive"].includes(obj.type)
  ) {
    throw new Error(`Unknown suspend payload type: ${String(obj.type)}`);
  }
  return obj as SuspendPayload;
}

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

function buildWelcomeOptions(): WelcomeOptions {
  return {
    title: "Sentry Init",
    body: [
      "We'll use AI to inspect this project and configure Sentry.",
      "You'll choose the setup before local files change.",
    ],
    punchline: "Continue to let Sentry use AI for setup.",
  };
}

async function confirmExperimental(
  options: WizardOptions,
  ui: WizardUI
): Promise<boolean> {
  if (options.yes || options.dryRun) {
    return true;
  }
  if (ui.welcome) {
    const choice = await ui.welcome(buildWelcomeOptions());
    return abortIfCancelled(choice) === "continue";
  }
  // The wizard modifies files on disk. We use `select` rather than
  // `confirm` so the cancel path can carry a muted, explicit hint
  // ("exits without changes") — the previous binary yes/no felt
  // ambiguous about what "no" did. The earlier wording used an
  // all-caps "EXPERIMENTAL:" prefix which read like a warning the
  // user had to dismiss; this version frames the question as a
  // sanity check before the wizard does work.
  const choice = await ui.select<"continue" | "exit">({
    message:
      "This is experimental and will modify files in this directory. Continue?",
    options: [
      {
        value: "continue",
        label: "Yes, continue",
        hint: "wizard will detect your stack and apply changes",
      },
      {
        value: "exit",
        label: "No, exit",
        hint: "exits without making any changes",
      },
    ],
    initialValue: "continue",
  });
  const resolved = abortIfCancelled(choice);
  return resolved === "continue";
}

async function preamble(
  options: WizardOptions,
  ui: WizardUI
): Promise<boolean> {
  if (!(options.yes || options.dryRun || process.stdin.isTTY)) {
    throw new WizardError(
      "Interactive mode requires a terminal. Use --yes for non-interactive mode.",
      { rendered: false }
    );
  }

  // Suppress the ASCII art banner for agent-driven runs — it wastes
  // tokens and adds noise to structured output without value to the
  // agent. For interactive runs, the UI implementation handles
  // rendering: InkUI paints from a pre-loaded gradient, LoggingUI
  // writes plain ANSI to stderr.
  if (!detectAgent()) {
    ui.banner(formatBanner());
  }
  ui.intro("sentry init");

  let confirmed: boolean;
  try {
    confirmed = await confirmExperimental(options, ui);
  } catch (err) {
    if (err instanceof WizardCancelledError) {
      captureException(err);
      showCancelledFeedback(ui);
      process.exitCode = 0;
      return false;
    }
    if (err instanceof LoggingUIPromptError) {
      throw new WizardError(
        "The interactive UI failed to load. Run with --yes for non-interactive mode.",
        { rendered: false }
      );
    }
    throw err;
  }
  if (!confirmed) {
    showCancelledFeedback(ui);
    process.exitCode = 0;
    return false;
  }

  if (options.dryRun) {
    ui.log.warn("Dry-run mode: no files will be modified.");
  }

  const gitOk = await checkGitStatus({
    cwd: options.directory,
    yes: options.yes || options.dryRun,
    ui,
  });
  if (!gitOk) {
    showCancelledFeedback(ui);
    process.exitCode = 0;
    return false;
  }

  return true;
}

const MAX_RESUME_RETRIES = 3;
const RETRY_BACKOFF_MS = [2000, 4000, 8000];

type ResumeRetryArgs = {
  run: {
    resumeAsync: (args: Record<string, unknown>) => Promise<unknown>;
    readonly runId: string;
  };
  workflow: {
    runById: (runId: string, opts?: { fields?: string[] }) => Promise<unknown>;
  };
  stepId: string;
  resumeData: Record<string, unknown>;
  tracingOptions: Record<string, unknown>;
  ui: WizardUI;
};

/**
 * Detect Mastra's "step not suspended" 500 — means the server already
 * processed this step (our previous request succeeded but the response was
 * dropped before we received it). The MastraClientError message embeds the
 * server body, e.g.:
 *   "HTTP error! status: 500 - {"error":"This workflow step 'X' was not suspended..."}"
 */
function isStepAlreadyAdvancedError(err: unknown): boolean {
  return err instanceof Error && err.message.includes("not suspended");
}

/**
 * Recover from a stale-step retry by fetching the current run state.
 * If the workflow has already advanced (e.g. plan-codemods is now suspended),
 * the returned WorkflowRunResult lets the main loop continue from the right step.
 */
async function tryRecoverCurrentRunState(
  workflow: ResumeRetryArgs["workflow"],
  runId: string
): Promise<WorkflowRunResult | null> {
  try {
    const state = await withTimeout(
      workflow.runById(runId, {
        fields: ["steps", "activeStepsPath", "result"],
      }),
      API_TIMEOUT_MS,
      "Run state recovery"
    );
    return assertWorkflowResult(state);
  } catch {
    return null;
  }
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: retry loop branches across transient errors, stale-step recovery, and backoff
async function resumeWithRetry(
  args: ResumeRetryArgs
): Promise<WorkflowRunResult> {
  const { run, workflow, stepId, resumeData, tracingOptions, ui } = args;
  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_RESUME_RETRIES; attempt++) {
    try {
      if (attempt > 0) {
        ui.setOverlay?.({
          kind: "health",
          message: "Connection interrupted, retrying...",
          retryCount: attempt,
        });
        await new Promise((r) =>
          setTimeout(r, RETRY_BACKOFF_MS[attempt - 1] ?? 8000)
        );
      }
      const raw = await withTimeout(
        run.resumeAsync({ step: stepId, resumeData, tracingOptions }),
        API_TIMEOUT_MS,
        "Workflow resume"
      );
      if (attempt > 0) {
        ui.clearOverlay?.();
      }
      return assertWorkflowResult(raw);
    } catch (err) {
      lastError = err;
      // "Step not suspended" means the server processed our step but the
      // response was dropped (network blip, CF response timeout, etc.).
      // Retrying the same step will always 500. Fetch the current run state
      // so the main loop can continue from whichever step is actually suspended.
      if (isStepAlreadyAdvancedError(err)) {
        ui.clearOverlay?.();
        const recovered = await tryRecoverCurrentRunState(workflow, run.runId);
        if (recovered) {
          return recovered;
        }
        // Recovery failed — the step is confirmed not suspended and retrying
        // it will always 500. Throw immediately instead of wasting 14s.
        throw err;
      }
      if (attempt === MAX_RESUME_RETRIES) {
        ui.clearOverlay?.();
        throw err;
      }
    }
  }
  ui.clearOverlay?.();
  throw lastError;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: sequential wizard orchestration with error handling branches
export async function runWizard(initialOptions: WizardOptions): Promise<void> {
  // Note: a previous `forwardFreshTtyToStdin()` call lived here as a
  // macOS-only workaround for clack reading from a broken inherited
  // stdin fd (PRs #824/#831/#833/#835). It's gone now because:
  //
  //   1. `LoggingUI` doesn't read from stdin at all (its prompts
  //      throw without `--yes`).
  //   2. `InkUI` opens its own fresh `/dev/tty` ReadStream and
  //      passes it directly to Ink's `stdin` option, sidestepping
  //      both the macOS clack bug and a separate Bun/Ink stdin bug
  //      (oven-sh/bun#6862, vadimdemedes/ink#636) where Bun's
  //      `process.stdin` accepts `setRawMode(true)` but never
  //      delivers `readable` events.
  //
  // The `forwardFreshTtyToStdin` function is preserved in
  // `stdin-reopen.ts` for future callers (and its tests) but no
  // longer wired into the wizard.

  const { directory, yes, dryRun, features, forceLegacyUi } = initialOptions;

  // Construct the UI once for the entire run; tear down on every exit
  // path via `await using`. The factory picks `InkUI` for interactive
  // runs and `LoggingUI` for CI / `--yes` / `--no-tui`.
  const initialWelcome = yes || dryRun ? undefined : buildWelcomeOptions();
  await using ui = await getUIAsync({
    yes,
    forceLegacy: forceLegacyUi,
    ...(initialWelcome ? { initialWelcome } : {}),
  });
  ui.setIntroMode?.(!yes);

  if (!(await preamble(initialOptions, ui))) {
    return;
  }

  await checkReadiness(ui);

  const effectiveOptions = dryRun
    ? { ...initialOptions, yes: true }
    : initialOptions;
  const context = await resolveInitContext(effectiveOptions, ui);
  if (!context) {
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

  const token = context.authToken;

  // AbortController bound to the MastraClient lifecycle. Aborting on
  // teardown (success OR failure, via `using` below) cancels any in-flight
  // fetches — releasing keep-alive sockets so the event loop drains and
  // `sentry init` returns to the shell promptly. Without this, a stuck or
  // idle socket in Bun's fetch dispatcher can hold the process alive past
  // the wizard's natural exit.
  const abortController = new AbortController();
  using _mastraCleanup = {
    [Symbol.dispose]: (): void => {
      // AbortController.abort() is spec-idempotent, so no guard needed.
      abortController.abort();
    },
  };

  const client = new MastraClient({
    baseUrl: MASTRA_API_URL,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    abortSignal: abortController.signal,
    fetch: ((url, init) => {
      const traceData = getTraceData();
      // Preserve `init.signal` via the spread — MastraClient may pass its
      // own per-request signal, and the client-level `abortSignal` is
      // forwarded through the same channel.
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

  const spin = ui.spinner();
  const spinState: SpinState = { running: false };

  spin.start("Scanning project...");
  spinState.running = true;

  let run: Awaited<ReturnType<typeof workflow.createRun>>;
  let result: WorkflowRunResult;
  try {
    const [dirListing, existingSentry] = await Promise.all([
      precomputeDirListing(directory),
      precomputeSentryDetection(directory).catch(() => null),
    ]);
    const fileCache = await preReadCommonFiles(directory, dirListing);
    ui.setIntroMode?.(false);
    spin.message("Connecting to wizard...");
    run = await workflow.createRun();
    // Large shared context (dirListing, fileCache, existingSentry)
    // travels via Mastra's workflow `initialState` instead of `inputData`.
    // Keeping it on state means the server stores it exactly once per run
    // rather than duplicating it across every step's output in the D1
    // snapshot — which used to overflow the per-row size limit on big
    // projects and surface as a cascading "workflow run was not suspended"
    // error. See getsentry/cli-init-api#98.
    result = assertWorkflowResult(
      await withTimeout(
        run.startAsync({
          inputData: {
            directory,
            yes,
            dryRun,
            features,
          },
          initialState: {
            dirListing,
            fileCache,
            existingSentry: existingSentry?.data,
            knownPlatform: context.existingProject?.platform,
          },
          tracingOptions,
        }),
        API_TIMEOUT_MS,
        "Workflow start"
      )
    );
  } catch (err) {
    spin.stop("Connection failed", 1);
    spinState.running = false;
    ui.log.error(errorMessage(err));
    showFailedFeedback(ui);
    throw new WizardError(errorMessage(err));
  }

  const stepPhases = new Map<string, number>();
  const stepHistory = new Map<string, Record<string, unknown>[]>();

  // Track which step the runner is currently suspended on so the
  // sidebar checklist can flip rows as the workflow advances. A
  // single step can suspend multiple times (read-files → analyze →
  // done); `setStep("...", "in_progress")` is idempotent in the
  // store, and we only fire the `completed` transition when the
  // active step changes.
  let activeStepId: string | undefined;

  try {
    while (result.status === "suspended") {
      const stepPath = result.suspended?.at(0) ?? [];
      const stepId: string = stepPath.at(-1) ?? "unknown";

      const extracted = extractSuspendPayload(result, stepId);
      if (!extracted) {
        spin.stop("Error", 1);
        spinState.running = false;
        if (activeStepId) {
          ui.setStep?.(activeStepId, "failed");
        }
        ui.log.error(`No suspend payload found for step "${stepId}"`);
        throw new WizardError(`No suspend payload found for step "${stepId}"`);
      }

      // Step transition: if the active step just changed, mark the
      // previous one completed before flipping this one to
      // in_progress. The store back-fills any earlier `pending`
      // entries as `skipped` on the in_progress transition.
      if (activeStepId && activeStepId !== extracted.stepId) {
        ui.setStep?.(activeStepId, "completed");
      }
      activeStepId = extracted.stepId;
      ui.setStep?.(extracted.stepId, "in_progress");
      let activeLabel = STEP_ACTIVE_LABELS[extracted.stepId];
      if (
        extracted.stepId === "detect-platform" &&
        context.existingProject?.platform
      ) {
        activeLabel = `Analyzing project (existing Sentry platform: ${context.existingProject.platform})...`;
      }
      if (activeLabel && spinState.running) {
        spin.message(activeLabel);
      }

      const resumeData = await handleSuspendedStep(
        {
          payload: extracted.payload,
          stepId: extracted.stepId,
          spin,
          spinState,
          context,
          ui,
        },
        stepPhases,
        stepHistory
      );

      result = await resumeWithRetry({
        run,
        workflow,
        stepId: extracted.stepId,
        resumeData,
        tracingOptions,
        ui,
      });
    }
  } catch (err) {
    // A running spinner owns a live interval, so stop it before any early
    // return or rethrow to avoid leaving the event loop artificially busy.
    if (spinState.running) {
      const [label, code] =
        err instanceof WizardCancelledError
          ? (["Cancelled", 0] as const)
          : (["Error", 1] as const);
      spin.stop(label, code);
      spinState.running = false;
    }
    if (err instanceof WizardCancelledError) {
      // Cancellation is a clean exit, not a failure — leave the
      // active step as `in_progress` rather than flipping it to
      // failed; the post-dispose report shows the cancel message
      // instead.
      captureException(err);
      setTag("wizard.outcome", "bailed");
      showCancelledFeedback(ui);
      process.exitCode = 0;
      return;
    }
    if (activeStepId) {
      ui.setStep?.(activeStepId, "failed");
    }
    if (err instanceof WizardError) {
      showFailedFeedback(ui);
      setTag("wizard.outcome", "errored");
      throw err;
    }
    ui.log.error(errorMessage(err));
    showFailedFeedback(ui);
    setTag("wizard.outcome", "errored");
    throw new WizardError(errorMessage(err));
  }

  // Workflow exited the suspend loop successfully — mark the last
  // active step (if any) as completed before the final-result handler
  // emits its outcome line. Status === "success" implies the final
  // step finished; failure paths run through the catch above and
  // already marked the step `failed`.
  if (activeStepId && result.status === "success") {
    ui.setStep?.(activeStepId, "completed");
  }

  handleFinalResult(result, spin, spinState, ui);
  setTag("wizard.outcome", "completed");
  if (result.result?.platform) {
    setTag("wizard.platform", String(result.result.platform));
  }
  if (result.result?.features) {
    const resultFeatures = result.result.features;
    setTag(
      "wizard.features",
      Array.isArray(resultFeatures)
        ? resultFeatures.join(",")
        : String(resultFeatures)
    );
  }
}

function handleFinalResult(
  result: WorkflowRunResult,
  spin: SpinnerHandle,
  spinState: SpinState,
  ui: WizardUI
): void {
  const hasError = result.status !== "success" || result.result?.exitCode;

  if (hasError) {
    if (spinState.running) {
      spin.stop("Failed", 1);
      spinState.running = false;
    }
    formatError(result, ui);

    // Map workflow-internal exit codes to semantic EXIT.* constants
    const workflowCode = result.result?.exitCode;
    const exitCode = mapWorkflowExitCode(workflowCode);
    setTag("wizard.outcome", "errored");
    throw new WizardError("Workflow returned an error", { exitCode });
  }

  if (spinState.running) {
    spin.stop("Done");
    spinState.running = false;
  }
  formatResult(result, ui);
}

/**
 * Map a workflow-internal exit code to a semantic EXIT.* constant.
 *
 * The remote workflow uses its own code scheme (20=platform not detected,
 * 30=deps failed, 40/41=codemod failed, 50=verification). We translate
 * these into the CLI's decade-based exit codes so scripts can distinguish
 * wizard failure categories.
 */
function mapWorkflowExitCode(workflowCode: number | undefined): number {
  switch (workflowCode) {
    case EXIT_PLATFORM_NOT_DETECTED:
      return EXIT.CONFIG;
    case EXIT_DEPENDENCY_INSTALL_FAILED:
      return EXIT.WIZARD_DEPS;
    // 40/41 are server-side only (codemod plan/apply) — not in constants.ts
    case 40:
    case 41:
      return EXIT.WIZARD_CODEMOD;
    case EXIT_VERIFICATION_FAILED:
      return EXIT.WIZARD_VERIFY;
    default:
      return EXIT.WIZARD;
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
