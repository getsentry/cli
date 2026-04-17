/**
 * Wizard Runner
 *
 * Drives the remote init workflow by:
 * 1. Starting a durable run
 * 2. Streaming NDJSON progress events
 * 3. Executing local tools/prompts when requested
 * 4. Resuming the workflow with local results
 * 5. Reconnecting to the stream when needed
 */

import { basename } from "node:path";
import { cancel, confirm, intro, log } from "@clack/prompts";
import { captureException } from "@sentry/node-core/light";
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
import { abortIfCancelled, WizardCancelledError } from "./clack-utils.js";
import { INIT_API_URL, MAX_STREAM_RECONNECTS, SENTRY_DOCS_URL } from "./constants.js";
import { formatError, formatResult } from "./formatters.js";
import { checkGitStatus } from "./git.js";
import { handleInteractive } from "./interactive.js";
import { resolveInitContext } from "./preflight.js";
import { createWizardSpinner } from "./spinner.js";
import {
  readNdjsonStream,
  reconnectInitStream,
  resumeInitAction,
  startInitStream,
} from "./transport.js";
import { describeTool, executeTool } from "./tools/registry.js";
import type {
  InitActionRequestEvent,
  InitActionResumeBody,
  InitDoneEvent,
  InitErrorEvent,
  InitEvent,
  InitStartInput,
  InteractivePayload,
  ResolvedInitContext,
  ToolPayload,
  WizardOutput,
  WizardOptions,
} from "./types.js";
import { precomputeSentryDetection } from "./workflow-inputs.js";

const VERIFY_CHANGES_STEP = "verify-changes";

type Spinner = ReturnType<typeof createWizardSpinner>;

type SpinState = { running: boolean };

type StepContext = {
  event: InitActionRequestEvent;
  spin: Spinner;
  spinState: SpinState;
  context: ResolvedInitContext;
};

type ReadFilesDisplay = {
  paths: string[];
  phase: "reading" | "analyzing";
};

type StreamState = {
  nextStartIndex: number;
  finalOutput?: WizardOutput;
  finalError?: InitErrorEvent;
  done?: InitDoneEvent;
  completedActionIds: Set<string>;
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

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function assertToolPayload(raw: unknown): ToolPayload {
  if (!isRecord(raw) || raw.type !== "tool" || typeof raw.operation !== "string") {
    throw new Error("Invalid tool action payload");
  }
  return raw as ToolPayload;
}

function assertInteractivePayload(raw: unknown): InteractivePayload {
  if (
    !isRecord(raw) ||
    raw.type !== "interactive" ||
    typeof raw.kind !== "string"
  ) {
    throw new Error("Invalid prompt action payload");
  }
  return raw as InteractivePayload;
}

function nextReconnectDelay(attempt: number): number {
  return Math.min(250 * 2 ** attempt, 4_000);
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function formatReadFilesSummary(progress: ReadFilesDisplay): string {
  const { paths, phase } = progress;
  if (paths.length === 0) {
    return phase === "analyzing" ? "Analyzing files..." : "Reading files...";
  }

  const header =
    phase === "analyzing"
      ? paths.length === 1
        ? "Analyzing file..."
        : "Analyzing files..."
      : paths.length === 1
        ? "Reading file..."
        : "Reading files...";

  const icon = readFilesStatusIcon(phase);
  const displayPaths = compactDisplayPaths(paths);
  const items = displayPaths.map((filePath, index) => {
    const branch = index === paths.length - 1 ? "└─" : "├─";
    return `${branch} ${icon} ${safeCodeSpan(filePath)}`;
  });
  return `${header}\n${items.join("\n")}`;
}

function describePostTool(payload: ToolPayload): string | undefined {
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

function toResumeError(error: unknown): InitActionResumeBody {
  const message = errorMessage(error);
  return {
    ok: false,
    error: {
      message,
      details: error,
    },
  };
}

async function performActionRequest(
  ctx: StepContext,
  stepPhases: Map<string, number>,
  stepHistory: Map<string, Record<string, unknown>[]>
): Promise<InitActionResumeBody> {
  const { event, context, spin, spinState } = ctx;
  const stepId = event.name;

  if (event.kind === "tool") {
    const payload = assertToolPayload(event.payload);
    const message =
      event.description ??
      (payload.operation === "read-files"
        ? formatReadFilesSummary({
            paths: payload.params.paths,
            phase: "reading",
          })
        : describeTool(payload));

    spin.message(renderInlineMarkdown(truncateForTerminal(message)));

    const toolResult = await executeTool(payload, context);
    if (toolResult.ok === false) {
      return {
        ok: false,
        error: {
          message: toolResult.error ?? "Local tool failed",
          details: toolResult.data,
        },
      };
    }

    if (toolResult.message) {
      spin.stop(renderInlineMarkdown(toolResult.message));
      spin.start("Processing...");
      spinState.running = true;
    } else {
      const followUp = describePostTool(payload);
      if (followUp) {
        spin.message(renderInlineMarkdown(truncateForTerminal(followUp)));
      }
    }

    const history = stepHistory.get(stepId) ?? [];
    history.push(toolResult as Record<string, unknown>);
    stepHistory.set(stepId, history);

    return {
      ok: true,
      output: {
        ...toolResult,
        _phase: nextPhase(stepPhases, stepId, [
          "read-files",
          "analyze",
          "done",
        ]),
        _prevPhases: history.slice(0, -1),
      },
    };
  }

  const payload = assertInteractivePayload(event.payload);
  if (context.dryRun && event.name === VERIFY_CHANGES_STEP) {
    return {
      ok: true,
      output: {
        action: "continue",
        _phase: nextPhase(stepPhases, stepId, ["apply"]),
      },
    };
  }

  if (spinState.running) {
    spin.stop(event.description ?? payload.prompt);
    spinState.running = false;
  }

  try {
    const promptResult = await handleInteractive(payload, context);
    spin.start("Processing...");
    spinState.running = true;
    return {
      ok: true,
      output: {
        ...promptResult,
        _phase: nextPhase(stepPhases, stepId, ["apply"]),
      },
    };
  } catch (error) {
    if (!(error instanceof WizardCancelledError)) {
      spin.start("Processing...");
      spinState.running = true;
    }
    throw error;
  }
}

async function handleEvent(
  event: InitEvent,
  context: ResolvedInitContext,
  spin: Spinner,
  spinState: SpinState,
  state: StreamState,
  stepPhases: Map<string, number>,
  stepHistory: Map<string, Record<string, unknown>[]>
): Promise<void> {
  state.nextStartIndex += 1;

  switch (event.type) {
    case "status":
      spin.message(renderInlineMarkdown(truncateForTerminal(event.message)));
      return;
    case "warning":
      log.warn(event.message);
      return;
    case "summary":
      state.finalOutput = event.output;
      return;
    case "error":
      state.finalError = event;
      return;
    case "done":
      state.done = event;
      return;
    case "action_result":
      if (event.summary) {
        spin.message(renderInlineMarkdown(truncateForTerminal(event.summary)));
      }
      return;
    case "action_request":
      if (state.completedActionIds.has(event.actionId)) {
        return;
      }

      try {
        const resumeBody = await performActionRequest(
          {
            event,
            context,
            spin,
            spinState,
          },
          stepPhases,
          stepHistory
        );
        await resumeInitAction(event.actionId, resumeBody, {
          baseUrl: INIT_API_URL,
        });
        state.completedActionIds.add(event.actionId);
      } catch (error) {
        if (error instanceof WizardCancelledError) {
          throw error;
        }
        await resumeInitAction(event.actionId, toResumeError(error), {
          baseUrl: INIT_API_URL,
        });
        state.completedActionIds.add(event.actionId);
      }
      return;
    default: {
      const _exhaustive: never = event;
      throw new Error(`Unhandled init event: ${String(_exhaustive)}`);
    }
  }
}

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

async function preamble(
  directory: string,
  yes: boolean,
  dryRun: boolean
): Promise<boolean> {
  if (!(yes || dryRun || process.stdin.isTTY)) {
    throw new WizardError(
      "Interactive mode requires a terminal. Use --yes for non-interactive mode.",
      { rendered: false }
    );
  }

  process.stderr.write(`\n${formatBanner()}\n\n`);
  intro("sentry init");

  let confirmed: boolean;
  try {
    confirmed = await confirmExperimental(yes || dryRun);
  } catch (error) {
    if (error instanceof WizardCancelledError) {
      captureException(error);
      process.exitCode = 0;
      return false;
    }
    throw error;
  }

  if (!confirmed) {
    cancel("Setup cancelled.");
    process.exitCode = 0;
    return false;
  }

  if (dryRun) {
    log.warn("Dry-run mode: no files will be modified.");
  }

  const gitOk = await checkGitStatus({ cwd: directory, yes: yes || dryRun });
  if (!gitOk) {
    cancel("Setup cancelled.");
    process.exitCode = 0;
    return false;
  }

  return true;
}

function buildFinalError(
  finalError: InitErrorEvent | undefined,
  finalOutput: WizardOutput | undefined,
  done: InitDoneEvent | undefined
): InitErrorEvent {
  if (finalError) {
    return {
      ...finalError,
      output: finalError.output ?? finalOutput,
    };
  }

  return {
    type: "error",
    message:
      done?.ok === false
        ? "Workflow completed with an error."
        : "Workflow completed without a success result.",
    output: finalOutput,
  };
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: sequential wizard orchestration with stream reconnect handling
export async function runWizard(initialOptions: WizardOptions): Promise<void> {
  const { directory, yes, dryRun, features } = initialOptions;

  if (!(await preamble(directory, yes, dryRun))) {
    return;
  }

  log.info(
    "This wizard uses AI to analyze your project and configure Sentry." +
      `\nFor manual setup: ${terminalLink(SENTRY_DOCS_URL)}`
  );

  const effectiveOptions = dryRun
    ? { ...initialOptions, yes: true }
    : initialOptions;
  const context = await resolveInitContext(effectiveOptions);
  if (!context) {
    return;
  }

  const spin = createWizardSpinner();
  const spinState: SpinState = { running: false };
  const state: StreamState = {
    nextStartIndex: 0,
    completedActionIds: new Set<string>(),
  };
  const stepPhases = new Map<string, number>();
  const stepHistory = new Map<string, Record<string, unknown>[]>();

  spin.start("Scanning project...");
  spinState.running = true;

  let runId: string | undefined;
  try {
    const existingSentry = await precomputeSentryDetection(directory).catch(
      () => null
    );
    const startInput: InitStartInput = {
      directory,
      yes,
      dryRun,
      features,
      org: context.org,
      team: context.team,
      project: context.project,
      existingProject: context.existingProject,
      existingSentry:
        existingSentry?.ok === true
          ? (existingSentry.data as InitStartInput["existingSentry"])
          : null,
      cliVersion: CLI_VERSION,
    };

    spin.message("Connecting to wizard...");
    const started = await startInitStream(startInput, {
      baseUrl: INIT_API_URL,
    });
    runId = started.runId;
  } catch (error) {
    spin.stop("Connection failed", 1);
    spinState.running = false;
    log.error(errorMessage(error));
    cancel("Setup failed");
    throw new WizardError(errorMessage(error));
  }

  try {
    if (!runId) {
      throw new Error("Init start succeeded but no workflow runId was returned.");
    }

    let reconnectAttempt = 0;
    let currentResponse = await reconnectInitStream(runId, state.nextStartIndex, {
      baseUrl: INIT_API_URL,
    });

    while (!(state.done || state.finalError)) {
      const eventCount = await readNdjsonStream(currentResponse, async (event) => {
        await handleEvent(
          event,
          context,
          spin,
          spinState,
          state,
          stepPhases,
          stepHistory
        );
      });

      if (state.done || state.finalError) {
        break;
      }

      reconnectAttempt = eventCount === 0 ? reconnectAttempt + 1 : 0;
      if (reconnectAttempt > MAX_STREAM_RECONNECTS) {
        throw new Error(
          `Init stream disconnected too many times (${MAX_STREAM_RECONNECTS})`
        );
      }

      spin.message(
        renderInlineMarkdown(
          truncateForTerminal("Connection interrupted. Reconnecting...")
        )
      );
      await sleepMs(nextReconnectDelay(reconnectAttempt));
      currentResponse = await reconnectInitStream(runId, state.nextStartIndex, {
        baseUrl: INIT_API_URL,
      });
    }
  } catch (error) {
    if (error instanceof WizardCancelledError) {
      captureException(error);
      process.exitCode = 0;
      return;
    }
    if (spinState.running) {
      spin.stop("Error", 1);
      spinState.running = false;
    }
    log.error(errorMessage(error));
    cancel("Setup failed");
    throw new WizardError(errorMessage(error));
  }

  if (state.done?.ok) {
    if (spinState.running) {
      spin.stop("Done");
      spinState.running = false;
    }
    formatResult(state.finalOutput ?? {});
    return;
  }

  const finalError = buildFinalError(
    state.finalError,
    state.finalOutput,
    state.done
  );

  if (spinState.running) {
    spin.stop("Failed", 1);
    spinState.running = false;
  }
  formatError(finalError);
  throw new WizardError(finalError.message);
}
