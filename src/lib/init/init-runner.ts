/**
 * sentry init — local driver.
 *
 * Talks to the Nitro+Hono server in `cli-init-api/apps/server`:
 *   1. Preflight (banner, git, org/team/project, features) on the local box.
 *   2. POST /api/init  -> {runId}
 *   3. GET  /api/init/:runId/stream (NDJSON of `InitEvent`s)
 *   4. For each `action_request` event: run the local tool / prompt, then
 *      POST /api/init/actions/:actionId with the result.
 *   5. Render `summary` / `error`; the stream ends on `done`.
 */

import { cancel, confirm, intro, log } from "@clack/prompts";
import { captureException } from "@sentry/node-core/light";
import { formatBanner } from "../banner.js";
import { CLI_VERSION } from "../constants.js";
import { WizardError } from "../errors.js";
import { terminalLink } from "../formatters/colors.js";
import {
  renderInlineMarkdown,
  stripColorTags,
} from "../formatters/markdown.js";
import {
  abortIfCancelled,
  WizardCancelledError,
} from "./clack-utils.js";
import {
  INIT_API_URL,
  MAX_STREAM_RECONNECTS,
  SENTRY_DOCS_URL,
} from "./constants.js";
import { ensureSentryProject } from "./ensure-project.js";
import { formatError, formatResult } from "./formatters.js";
import { checkGitStatus } from "./git.js";
import { handleInteractive } from "./interactive.js";
import { resolveInitContext } from "./preflight.js";
import { selectFeatures } from "./select-features.js";
import { createWizardSpinner } from "./spinner.js";
import { forwardFreshTtyToStdin } from "./stdin-reopen.js";
import {
  openInitStream,
  readNdjsonStream,
  resumeInitAction,
  startInit,
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
  WizardOptions,
  WizardOutput,
} from "./types.js";

type Spinner = ReturnType<typeof createWizardSpinner>;
type SpinState = { running: boolean };

type StreamState = {
  /**
   * Index of the next un-handled event in the workflow's NDJSON stream.
   * When the stream drops (idle body timeout, network blip, etc.) we
   * reopen with `?startIndex=nextStartIndex` so the workflow replays
   * everything we haven't seen yet.
   */
  nextStartIndex: number;
  finalOutput?: WizardOutput;
  finalError?: InitErrorEvent;
  done?: InitDoneEvent;
  completedActionIds: Set<string>;
};

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nextReconnectDelay(attempt: number): number {
  return Math.min(250 * 2 ** attempt, 4_000);
}

function describeStreamReadError(error: unknown): string {
  const message = errorMessage(error);
  if (
    message.includes("Invalid ") ||
    message.includes("Unknown init event type") ||
    message.includes("JSON")
  ) {
    return `Malformed init stream event: ${message}`;
  }
  return `Init stream read failed: ${message}`;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function assertToolPayload(raw: unknown): ToolPayload {
  if (
    !isRecord(raw) ||
    raw.type !== "tool" ||
    typeof raw.operation !== "string"
  ) {
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

/** Truncate a spinner message so it doesn't wrap. */
function truncateForTerminal(message: string): string {
  return message.split("\n").map(truncateLineForTerminal).join("\n");
}

function truncateLineForTerminal(line: string): string {
  const maxWidth = (process.stdout.columns || 80) - 4;
  const visibleLine = stripColorTags(line).replace(/`/g, "");
  if (visibleLine.length <= maxWidth) return line;
  let truncated = line.slice(0, maxWidth - 1);
  const backtickCount = truncated.split("`").length - 1;
  if (backtickCount % 2 !== 0) {
    const lastBacktick = truncated.lastIndexOf("`");
    truncated =
      truncated.slice(0, lastBacktick) + truncated.slice(lastBacktick + 1);
  }
  return `${truncated}…`;
}

function toResumeError(error: unknown): InitActionResumeBody {
  return {
    ok: false,
    error: { message: errorMessage(error), details: error },
  };
}

function stopSpinner(
  spin: Spinner,
  spinState: SpinState,
  message: string,
  code?: number
): void {
  if (!spinState.running) return;
  spin.stop(message, code);
  spinState.running = false;
}

async function performActionRequest(
  event: InitActionRequestEvent,
  context: ResolvedInitContext,
  spin: Spinner,
  spinState: SpinState
): Promise<InitActionResumeBody> {
  if (event.kind === "tool") {
    const payload = assertToolPayload(event.payload);
    const message = event.description ?? describeTool(payload);
    spin.message(renderInlineMarkdown(truncateForTerminal(message)));

    const toolResult = await executeTool(payload, context);
    if (!toolResult.ok) {
      return {
        ok: false,
        error: {
          message: toolResult.error ?? "Local tool failed",
          details: toolResult.data,
        },
      };
    }

    if (toolResult.message) {
      spin.message(renderInlineMarkdown(toolResult.message));
    }

    return { ok: true, output: toolResult as Record<string, unknown> };
  }

  const payload = assertInteractivePayload(event.payload);

  if (spinState.running) {
    spin.stop(event.description ?? payload.prompt);
    spinState.running = false;
  }

  try {
    const promptResult = await handleInteractive(payload, context);
    spin.start("Processing...");
    spinState.running = true;
    return { ok: true, output: promptResult };
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
  state: StreamState
): Promise<void> {
  // Bump BEFORE handling. If the handler throws or the stream then
  // drops, the reconnect uses this updated index to skip events we've
  // already processed and ones currently being handled.
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
    case "action_request": {
      if (state.completedActionIds.has(event.actionId)) return;
      try {
        const resumeBody = await performActionRequest(
          event,
          context,
          spin,
          spinState
        );
        await resumeInitAction(event.actionId, resumeBody, {
          baseUrl: INIT_API_URL,
        });
      } catch (error) {
        if (error instanceof WizardCancelledError) throw error;
        await resumeInitAction(event.actionId, toResumeError(error), {
          baseUrl: INIT_API_URL,
        });
      }
      state.completedActionIds.add(event.actionId);
      return;
    }
    default: {
      const _exhaustive: never = event;
      throw new Error(`Unhandled init event: ${String(_exhaustive)}`);
    }
  }
}

async function confirmExperimental(yes: boolean): Promise<boolean> {
  if (yes) return true;
  const proceed = await confirm({
    message:
      "EXPERIMENTAL: This feature is experimental and may modify your code. Continue?",
    initialValue: true,
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
  intro(`sentry init  ${CLI_VERSION} (experimental)`);

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

  if (dryRun) log.warn("Dry-run mode: no files will be modified.");

  const gitOk = await checkGitStatus({ cwd: directory, yes: yes || dryRun });
  if (!gitOk) {
    cancel("Setup cancelled.");
    process.exitCode = 0;
    return false;
  }

  return true;
}

/**
 * Read the workflow's NDJSON stream until we receive `done` or `error`.
 *
 * Bun's `fetch` raises a bare TimeoutError on long-idle SSE bodies; the
 * server uses `Cache-Control: no-store` but doesn't issue keepalive
 * pings. Whenever a read returns zero new events we treat the stream as
 * dropped and reconnect with `?startIndex=state.nextStartIndex` (the
 * server replays from there). Capped at MAX_STREAM_RECONNECTS
 * consecutive empty reconnects with exponential backoff.
 */
async function consumeStreamUntilTerminal(args: {
  runId: string;
  context: ResolvedInitContext;
  spin: Spinner;
  spinState: SpinState;
  state: StreamState;
}): Promise<void> {
  let reconnectAttempt = 0;
  let currentResponse = await openInitStream(args.runId, {
    baseUrl: INIT_API_URL,
    startIndex: args.state.nextStartIndex,
  });

  while (!(args.state.done || args.state.finalError)) {
    let eventCount: number;
    try {
      eventCount = await readNdjsonStream(currentResponse, async (event) => {
        await handleEvent(event, args.context, args.spin, args.spinState, args.state);
      });
    } catch (error) {
      throw new Error(describeStreamReadError(error));
    }

    if (args.state.done || args.state.finalError) return;

    reconnectAttempt = eventCount === 0 ? reconnectAttempt + 1 : 0;
    if (reconnectAttempt > MAX_STREAM_RECONNECTS) {
      throw new Error(
        `Init stream disconnected too many times without new events (${MAX_STREAM_RECONNECTS})`
      );
    }

    args.spin.message("Connection interrupted. Reconnecting...");
    await sleepMs(nextReconnectDelay(reconnectAttempt));

    try {
      currentResponse = await openInitStream(args.runId, {
        baseUrl: INIT_API_URL,
        startIndex: args.state.nextStartIndex,
      });
    } catch (error) {
      throw new Error(`Failed to reconnect to the init stream: ${errorMessage(error)}`);
    }
  }
}

function buildFinalError(
  finalError: InitErrorEvent | undefined,
  finalOutput: WizardOutput | undefined,
  done: InitDoneEvent | undefined
): InitErrorEvent {
  if (finalError) {
    return { ...finalError, output: finalError.output ?? finalOutput };
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

export async function runInit(initialOptions: WizardOptions): Promise<void> {
  const { directory, yes, dryRun } = initialOptions;

  if (!(await preamble(directory, yes, dryRun))) return;

  log.info(
    `This wizard uses AI to analyze your project and configure Sentry.\nFor manual setup: ${terminalLink(SENTRY_DOCS_URL)}`
  );

  const effectiveOptions = dryRun
    ? { ...initialOptions, yes: true }
    : initialOptions;

  // Local TTY workaround for macOS Bun (see stdin-reopen.ts).
  using _tty =
    process.platform === "darwin"
      ? forwardFreshTtyToStdin()
      : { [Symbol.dispose]: () => undefined };

  const context = await resolveInitContext(effectiveOptions);
  if (!context) return;

  // Resolve / create the Sentry project so the workflow has a real DSN.
  const project = await ensureSentryProject(context);
  // Pick features (or use the --features flag).
  const selectedFeatures = await selectFeatures({
    yes: context.yes,
    fromFlag: context.features,
  });

  const startInput: InitStartInput = {
    directory,
    yes,
    dryRun,
    features: selectedFeatures,
    org: project.orgSlug,
    team: project.teamSlug,
    project: project.projectSlug,
    existingProject: {
      orgSlug: project.orgSlug,
      projectSlug: project.projectSlug,
      projectId: project.projectId,
      dsn: project.dsn,
      url: project.url,
    },
    sentryAuthToken: context.authToken,
    cliVersion: CLI_VERSION,
  };

  const spin = createWizardSpinner();
  const spinState: SpinState = { running: false };
  const state: StreamState = {
    nextStartIndex: 0,
    completedActionIds: new Set<string>(),
  };

  spin.start("Starting wizard...");
  spinState.running = true;

  let runId: string;
  try {
    spin.message("Connecting to wizard...");
    const started = await startInit(startInput, { baseUrl: INIT_API_URL });
    runId = started.runId;
  } catch (error) {
    stopSpinner(spin, spinState, "Connection failed", 1);
    log.error(errorMessage(error));
    cancel("Setup failed");
    throw new WizardError(errorMessage(error));
  }

  try {
    await consumeStreamUntilTerminal({
      runId,
      context,
      spin,
      spinState,
      state,
    });
  } catch (error) {
    if (error instanceof WizardCancelledError) {
      captureException(error);
      process.exitCode = 0;
      return;
    }
    stopSpinner(spin, spinState, "Error", 1);
    log.error(errorMessage(error));
    cancel("Setup failed");
    throw new WizardError(errorMessage(error));
  }

  if (state.done?.ok) {
    stopSpinner(spin, spinState, "Done");
    formatResult(state.finalOutput ?? {});
    return;
  }

  const finalError = buildFinalError(
    state.finalError,
    state.finalOutput,
    state.done
  );
  stopSpinner(spin, spinState, "Failed", 1);
  formatError(finalError);
  throw new WizardError(finalError.message);
}
