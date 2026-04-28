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
 * `ClackUI`, `LoggingUI`, and the upcoming OpenTUI implementation.
 */

import { randomBytes } from "node:crypto";
import { basename } from "node:path";
import { MastraClient } from "@mastra/client-js";
import { captureException, getTraceData } from "@sentry/node-core/light";
import { formatBanner } from "../banner.js";
import { CLI_VERSION } from "../constants.js";
import { WizardError } from "../errors.js";
import { terminalLink } from "../formatters/colors.js";
import {
  colorTag,
  renderInlineMarkdown,
  safeCodeSpan,
  stripColorTags,
} from "../formatters/markdown.js";
import { cancel, confirm, intro, log } from "./clack-plain.js";
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
import { resolveInitContext } from "./preflight.js";
import { forwardFreshTtyToStdin } from "./stdin-reopen.js";
import { describeTool, executeTool } from "./tools/registry.js";
import type {
  ResolvedInitContext,
  SuspendPayload,
  WizardOptions,
  WorkflowRunResult,
} from "./types.js";
import { getUIAsync } from "./ui/factory.js";
import type { SpinnerHandle, WizardUI } from "./ui/types.js";
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
  if (paths.length === 0) {
    return phase === "analyzing" ? "Analyzing files..." : "Reading files...";
  }

  let header: string;
  if (phase === "analyzing") {
    header = paths.length === 1 ? "Analyzing file..." : "Analyzing files...";
  } else {
    header = paths.length === 1 ? "Reading file..." : "Reading files...";
  }

  const icon = readFilesStatusIcon(phase);
  const displayPaths = compactDisplayPaths(paths);
  const items = displayPaths.map((filePath, index) => {
    const branch = index === paths.length - 1 ? "└─" : "├─";
    return `${branch} ${icon} ${safeCodeSpan(filePath)}`;
  });
  return `${header}\n${items.join("\n")}`;
}

function readFilesStatusIcon(phase: ReadFilesDisplay["phase"]): string {
  return phase === "analyzing"
    ? colorTag("green", "✓")
    : colorTag("yellow", "●");
}

function compactDisplayPaths(paths: string[]): string[] {
  const basenameCounts = new Map<string, number>();
  for (const filePath of paths) {
    const name = basename(filePath);
    basenameCounts.set(name, (basenameCounts.get(name) ?? 0) + 1);
  }
  return paths.map((filePath) => {
    const name = basename(filePath);
    return basenameCounts.get(name) === 1 ? name : filePath;
  });
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
  ui.log.error(
    `Unknown suspend payload type "${(payload as { type: string }).type}"`
  );
  ui.cancel("Setup failed");
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

async function confirmExperimental(
  yes: boolean,
  ui: WizardUI
): Promise<boolean> {
  if (yes) {
    return true;
  }
  // The wizard modifies files on disk. Keep the prompt short — the
  // tone used to be "EXPERIMENTAL: …" in all caps, which felt
  // alarming. The friendlier wording still telegraphs that the
  // wizard will edit code, and gives an obvious abort path before
  // anything happens.
  const proceed = await ui.confirm({
    message:
      "Ready to set up Sentry? The wizard will edit files in this directory.",
    initialValue: true,
  });
  return Boolean(abortIfCancelled(proceed));
}

async function preamble(
  directory: string,
  yes: boolean,
  dryRun: boolean,
  ui: WizardUI
): Promise<boolean> {
  if (!(yes || dryRun || process.stdin.isTTY)) {
    throw new WizardError(
      "Interactive mode requires a terminal. Use --yes for non-interactive mode.",
      { rendered: false }
    );
  }

  // Banner rendering is delegated to the UI implementation:
  //   - `OpenTuiUI` paints the banner inside its alternate-screen
  //     header, gradient-colored row by row, and treats `banner()` as
  //     a no-op (the layout already includes it).
  //   - `LoggingUI` writes a plain ANSI version to stderr.
  // Calling it on `ui` directly avoids the previous bug where a raw
  // `process.stderr.write` was hidden behind OpenTUI's alternate-
  // screen takeover.
  ui.banner(formatBanner());
  ui.intro("sentry init");

  let confirmed: boolean;
  try {
    confirmed = await confirmExperimental(yes || dryRun, ui);
  } catch (err) {
    if (err instanceof WizardCancelledError) {
      captureException(err);
      process.exitCode = 0;
      return false;
    }
    throw err;
  }
  if (!confirmed) {
    ui.cancel("Setup cancelled.");
    process.exitCode = 0;
    return false;
  }

  if (dryRun) {
    ui.log.warn("Dry-run mode: no files will be modified.");
  }

  const gitOk = await checkGitStatus({
    cwd: directory,
    yes: yes || dryRun,
    ui,
  });
  if (!gitOk) {
    ui.cancel("Setup cancelled.");
    process.exitCode = 0;
    return false;
  }

  return true;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: sequential wizard orchestration with error handling branches
export async function runWizard(initialOptions: WizardOptions): Promise<void> {
  // macOS-only: Bun's compiled binaries on Darwin don't deliver keystrokes
  // through TTY fds inherited via shell redirection (`curl | bash` →
  // `exec sentry init </dev/tty` in install.sh), so clack prompts hang
  // forever at the first question. The workaround in stdin-reopen.ts opens
  // a fresh `/dev/tty` and forwards its data events onto process.stdin.
  //
  // The bug is fixed on Linux (verified via PTY harness in PR #835) — we
  // skip the workaround there because it has a side cost: a libuv handle
  // leak that requires `initCommand.func`'s `setTimeout().unref()` safety
  // net to force-exit cleanly. Keep the install narrow.
  //
  // The `using` declaration guarantees teardown on every exit path via the
  // Disposable returned by forwardFreshTtyToStdin(). On non-Darwin, the
  // disposable is a no-op (install short-circuits on platform check).
  using _tty =
    process.platform === "darwin"
      ? forwardFreshTtyToStdin()
      : {
          [Symbol.dispose]: (): void => {
            // intentionally empty — workaround not installed on this platform
          },
        };

  const { directory, yes, dryRun, features, forceLegacyUi } = initialOptions;

  // Construct the UI once for the entire run; tear down on every exit
  // path via `await using`. The factory picks `OpenTuiUI` for
  // interactive runs on the Bun binary and `LoggingUI` everywhere else
  // (CI, `--yes`, `--no-tui`, npm/Node distribution).
  await using ui = await getUIAsync({
    yes,
    forceLegacy: forceLegacyUi,
  });

  if (!(await preamble(directory, yes, dryRun, ui))) {
    return;
  }

  ui.log.info(
    "This wizard uses AI to analyze your project and configure Sentry." +
      `\nFor manual setup: ${terminalLink(SENTRY_DOCS_URL)}`
  );

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
    ui.cancel("Setup failed");
    throw new WizardError(errorMessage(err));
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
        ui.log.error(`No suspend payload found for step "${stepId}"`);
        ui.cancel("Setup failed");
        throw new WizardError(`No suspend payload found for step "${stepId}"`);
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
      captureException(err);
      process.exitCode = 0;
      return;
    }
    if (err instanceof WizardError) {
      throw err;
    }
    ui.log.error(errorMessage(err));
    ui.cancel("Setup failed");
    throw new WizardError(errorMessage(err));
  }

  handleFinalResult(result, spin, spinState, ui);
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
    throw new WizardError("Workflow returned an error");
  }

  if (spinState.running) {
    spin.stop("Done");
    spinState.running = false;
  }
  formatResult(result, ui);
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
