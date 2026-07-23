/**
 * Agent DO Runner — the canary transport.
 *
 * Drives the Cloudflare Durable Object agent over a resilient WebSocket instead
 * of the Mastra suspend/resume HTTP loop. The DO holds the live agent context;
 * the CLI reacts to messages:
 *   - `tool-request` → run locally via the SAME `executeTool` registry
 *   - `prompt`       → the SAME `handleInteractive` prompts
 *   - `status`/`done`/`error` → spinner + final result
 *
 * Resilience: the run id is stable for the whole run. If the socket drops (e.g.
 * the laptop sleeps), we reconnect to the SAME id and the DO re-sends whatever
 * it was waiting on. Correlation is by message id; the DO ignores stale ids.
 */

import { randomUUID } from "node:crypto";
import { setTag } from "@sentry/node-core/light";
import { WebSocket } from "ws";
import { EXIT, WizardError } from "../errors.js";
import { renderInlineMarkdown } from "../formatters/markdown.js";
import { WizardCancelledError } from "./clack-utils.js";
import {
  EXIT_DEPENDENCY_INSTALL_FAILED,
  EXIT_PLATFORM_NOT_DETECTED,
  EXIT_VERIFICATION_FAILED,
  INIT_AGENT_DO_URL,
} from "./constants.js";
import { formatError, formatResult } from "./formatters.js";
import { handleInteractive } from "./interactive.js";
import { executeTool } from "./tools/registry.js";
import type {
  ApplyPatchsetPatch,
  InteractivePayload,
  ResolvedInitContext,
  ToolPayload,
  WizardOutput,
  WorkflowRunResult,
} from "./types.js";
import type { SpinnerHandle, WizardUI } from "./ui/types.js";
import { verifySetup } from "./verify-setup.js";

type SpinState = { running: boolean };

type ServerMessage =
  | {
      type: "tool-request";
      id: string;
      op: string;
      params: Record<string, unknown>;
      detail?: string;
    }
  | {
      type: "prompt";
      id: string;
      kind: "select" | "multiselect" | "confirm";
      prompt: string;
      options?: { value: string; label: string }[];
    }
  | { type: "status"; text: string }
  | { type: "done"; output: Record<string, unknown> }
  | { type: "error"; message: string; exitCode?: number };

/** Sentinel used to trigger a reconnect from the connection promise. */
class ReconnectSignal extends Error {}

const MAX_RECONNECT_ATTEMPTS = 40;
const RECONNECT_MAX_BACKOFF_MS = 15_000;
const TRAILING_SLASHES_RE = /\/+$/;
/** WebSocket-protocol ping cadence. Cloudflare auto-answers pong without waking the DO. */
const PING_INTERVAL_MS = 20_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function truncateForTerminal(message: string): string {
  const maxWidth = (process.stdout.columns || 80) - 4;
  const flat = message.replace(/`/g, "");
  return flat.length <= maxWidth
    ? message
    : `${message.slice(0, maxWidth - 1)}…`;
}

function mapExitCode(workflowCode: unknown): number {
  switch (workflowCode) {
    case EXIT_PLATFORM_NOT_DETECTED:
      return EXIT.CONFIG;
    case EXIT_DEPENDENCY_INSTALL_FAILED:
      return EXIT.WIZARD_DEPS;
    case 40:
    case 41:
      return EXIT.WIZARD_CODEMOD;
    case EXIT_VERIFICATION_FAILED:
      return EXIT.WIZARD_VERIFY;
    default:
      return EXIT.WIZARD;
  }
}

/** Map the DO's apply_patch changes to the CLI's apply-patchset patch shape. */
function toPatches(changes: unknown): ApplyPatchsetPatch[] {
  if (!Array.isArray(changes)) {
    return [];
  }
  return changes.map((c: Record<string, unknown>) => {
    const path = String(c.filePath ?? "");
    if (c.action === "create") {
      return { path, action: "create", patch: String(c.content ?? "") };
    }
    return {
      path,
      action: "modify",
      edits: [
        {
          oldString: String(c.oldString ?? ""),
          newString: String(c.newString ?? ""),
        },
      ],
    };
  });
}

/** Adapt a DO tool-request into the CLI's typed ToolPayload (or null if unknown). */
function toToolPayload(
  op: string,
  params: Record<string, unknown>,
  cwd: string,
  context: ResolvedInitContext
): ToolPayload | null {
  switch (op) {
    case "list-dir":
      return {
        type: "tool",
        operation: "list-dir",
        cwd,
        params: {
          path: String(params.path ?? "."),
          ...(typeof params.maxDepth === "number"
            ? { maxDepth: params.maxDepth }
            : {}),
          ...(typeof params.maxEntries === "number"
            ? { maxEntries: params.maxEntries }
            : {}),
        },
      };
    case "read-files":
      return {
        type: "tool",
        operation: "read-files",
        cwd,
        params: { paths: (params.paths as string[]) ?? [] },
      };
    case "file-exists-batch":
      return {
        type: "tool",
        operation: "file-exists-batch",
        cwd,
        params: { paths: (params.paths as string[]) ?? [] },
      };
    case "run-commands":
      return {
        type: "tool",
        operation: "run-commands",
        cwd,
        params: {
          commands: (params.commands as string[]) ?? [],
          ...(typeof params.timeoutMs === "number"
            ? { timeoutMs: params.timeoutMs }
            : {}),
        },
      };
    case "apply-patchset":
      return {
        type: "tool",
        operation: "apply-patchset",
        cwd,
        params: { patches: toPatches(params.changes ?? params.patches) },
      };
    case "create-sentry-project":
      return {
        type: "tool",
        operation: "create-sentry-project",
        cwd,
        params: {
          name: context.project ?? String(params.project ?? params.name ?? ""),
          platform: String(params.platform ?? ""),
        },
      };
    default:
      return null;
  }
}

function toInteractivePayload(
  msg: Extract<ServerMessage, { type: "prompt" }>
): InteractivePayload {
  const values = (msg.options ?? []).map((o) => o.value);
  if (msg.kind === "select") {
    return {
      type: "interactive",
      kind: "select",
      prompt: msg.prompt,
      options: values,
      apps: values.map((name) => ({ name, path: "" })),
    };
  }
  if (msg.kind === "multiselect") {
    return {
      type: "interactive",
      kind: "multi-select",
      prompt: msg.prompt,
      availableFeatures: values,
      options: values,
    };
  }
  return { type: "interactive", kind: "confirm", prompt: msg.prompt };
}

function extractPromptValue(
  kind: Extract<ServerMessage, { type: "prompt" }>["kind"],
  result: Record<string, unknown>
): unknown {
  if (kind === "select") {
    return result.selectedApp;
  }
  if (kind === "multiselect") {
    return result.features ?? [];
  }
  return result.action === "continue";
}

function buildFlags(context: ResolvedInitContext): Record<string, unknown> {
  return {
    org: context.org,
    project: context.project,
    team: context.team,
    features: context.features,
    dryRun: context.dryRun,
    app: context.app,
  };
}

function normalizeOutput(
  output: Record<string, unknown>,
  cwd: string
): WizardOutput {
  const changed = output.changedFiles;
  return {
    platform: typeof output.platform === "string" ? output.platform : undefined,
    features: Array.isArray(output.features)
      ? (output.features as string[])
      : undefined,
    changedFiles: Array.isArray(changed)
      ? changed.map((c) =>
          typeof c === "string"
            ? { action: "modified", path: c }
            : (c as { action: string; path: string })
        )
      : undefined,
    sentryProjectUrl:
      typeof output.sentryProjectUrl === "string"
        ? output.sentryProjectUrl
        : undefined,
    projectDir: cwd,
    exitCode: typeof output.exitCode === "number" ? output.exitCode : 0,
    message: typeof output.message === "string" ? output.message : undefined,
  };
}

type MessageCtx = {
  ws: WebSocket;
  context: ResolvedInitContext;
  ui: WizardUI;
  spin: SpinnerHandle;
  spinState: SpinState;
  resolveDone: (output: Record<string, unknown>) => void;
  fail: (err: Error) => void;
};

async function handleToolRequest(
  msg: Extract<ServerMessage, { type: "tool-request" }>,
  ctx: MessageCtx
): Promise<void> {
  const { ws, context, ui, spin, spinState } = ctx;
  const payload = toToolPayload(msg.op, msg.params, context.directory, context);
  if (!payload) {
    ws.send(
      JSON.stringify({
        type: "tool-result",
        id: msg.id,
        ok: false,
        error: `Unsupported op: ${msg.op}`,
      })
    );
    return;
  }
  if (msg.detail && spinState.running) {
    spin.message(renderInlineMarkdown(truncateForTerminal(msg.detail)));
  }
  if (payload.operation === "read-files") {
    ui.recordFilesReading?.(payload.params.paths);
  }
  const result = await executeTool(payload, context);
  if (payload.operation === "read-files" && result.ok !== false) {
    ui.markFilesAnalyzed?.(payload.params.paths);
  }
  ws.send(
    JSON.stringify({
      type: "tool-result",
      id: msg.id,
      ok: result.ok,
      data: result.data,
      error: result.error,
    })
  );
}

async function handlePrompt(
  msg: Extract<ServerMessage, { type: "prompt" }>,
  ctx: MessageCtx
): Promise<void> {
  const { ws, context, ui, spin, spinState } = ctx;
  const interactive = toInteractivePayload(msg);
  if (spinState.running) {
    spin.stop();
    spinState.running = false;
  }
  const result = await handleInteractive(interactive, context, ui);
  spin.start("Working...");
  spinState.running = true;
  ws.send(
    JSON.stringify({
      type: "prompt-response",
      id: msg.id,
      value: extractPromptValue(msg.kind, result),
    })
  );
}

async function handleServerMessage(
  msg: ServerMessage,
  ctx: MessageCtx
): Promise<void> {
  switch (msg.type) {
    case "status":
      if (ctx.spinState.running) {
        ctx.spin.message(renderInlineMarkdown(truncateForTerminal(msg.text)));
      }
      return;
    case "tool-request":
      await handleToolRequest(msg, ctx);
      return;
    case "prompt":
      await handlePrompt(msg, ctx);
      return;
    case "done":
      ctx.resolveDone(msg.output ?? {});
      return;
    case "error":
      ctx.fail(
        new WizardError(String(msg.message ?? "Setup failed"), {
          exitCode: mapExitCode(msg.exitCode),
        })
      );
      return;
    default:
      return;
  }
}

/**
 * Own one WebSocket connection; resolve with the `done` output, or reject.
 * A clean-but-early close rejects with {@link ReconnectSignal} so the caller
 * reconnects to the same run id.
 */
function connectOnce(args: {
  url: string;
  token?: string;
  /** Shared across reconnects: `start` is sent exactly once, on the FIRST open. */
  startState: { sent: boolean };
  context: ResolvedInitContext;
  ui: WizardUI;
  spin: SpinnerHandle;
  spinState: SpinState;
}): Promise<Record<string, unknown>> {
  const { url, token, startState, context, ui, spin, spinState } = args;
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    const ws = new WebSocket(
      url,
      token ? { headers: { Authorization: `Bearer ${token}` } } : undefined
    );
    let settled = false;
    let pingTimer: ReturnType<typeof setInterval> | null = null;
    const stopPing = () => {
      if (pingTimer) {
        clearInterval(pingTimer);
        pingTimer = null;
      }
    };
    const settle = (fn: () => void) => {
      if (!settled) {
        settled = true;
        stopPing();
        fn();
      }
    };

    ws.on("open", () => {
      ui.clearOverlay?.();
      // Keepalive: WebSocket-protocol pings keep the connection open during long
      // LLM "thinking" gaps. Cloudflare auto-responds with pong WITHOUT waking the
      // Durable Object, so this stays hibernation-friendly (no server-side timer).
      pingTimer = setInterval(() => {
        try {
          ws.ping();
        } catch {
          // Socket not open; the close handler will trigger a reconnect.
        }
      }, PING_INTERVAL_MS);
      if (spinState.running) {
        spin.message("Analyzing your project...");
      }
      // Send `start` exactly once — on the first socket that actually opens.
      // A reconnect after a successful start relies on the DO re-sending its
      // pending request, so we must NOT resend start; but if the first connect
      // failed before opening, start was never sent and must go out now.
      if (!startState.sent) {
        startState.sent = true;
        ws.send(
          JSON.stringify({
            type: "start",
            cwd: context.directory,
            flags: buildFlags(context),
          })
        );
      }
    });

    ws.on("message", (raw: Buffer | ArrayBuffer | Buffer[]) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(raw.toString()) as ServerMessage;
      } catch {
        return;
      }
      if (
        typeof (msg as { type?: string }).type === "string" &&
        (msg.type as string).startsWith("cf_agent")
      ) {
        return; // SDK internal state-sync frames
      }
      handleServerMessage(msg, {
        ws,
        context,
        ui,
        spin,
        spinState,
        resolveDone: (output) => settle(() => resolve(output)),
        fail: (err) => {
          try {
            ws.close();
          } catch {
            // ignore
          }
          settle(() => reject(err));
        },
      }).catch((err: unknown) => {
        try {
          ws.close();
        } catch {
          // ignore
        }
        settle(() =>
          reject(err instanceof Error ? err : new Error(String(err)))
        );
      });
    });

    ws.on("error", () => {
      // A socket error is always followed by 'close'; let that path decide.
    });

    ws.on("close", () => {
      settle(() => reject(new ReconnectSignal()));
    });
  });
}

async function driveWithReconnect(args: {
  url: string;
  context: ResolvedInitContext;
  ui: WizardUI;
  spin: SpinnerHandle;
  spinState: SpinState;
}): Promise<Record<string, unknown>> {
  const { url, context, ui, spin, spinState } = args;
  const token = context.authToken;
  // `start` is sent exactly once, on the first socket that opens (tracked here so
  // an early connect failure before `open` doesn't skip it on the retry).
  const startState = { sent: false };
  let attempt = 0;

  for (;;) {
    try {
      const output = await connectOnce({
        url,
        token,
        startState,
        context,
        ui,
        spin,
        spinState,
      });
      return output;
    } catch (err) {
      if (!(err instanceof ReconnectSignal)) {
        throw err;
      }
      attempt += 1;
      if (attempt > MAX_RECONNECT_ATTEMPTS) {
        throw new WizardError(
          "Lost connection to the setup service after multiple retries."
        );
      }
      const backoff = Math.min(
        1000 * 2 ** Math.min(attempt, 4),
        RECONNECT_MAX_BACKOFF_MS
      );
      ui.setOverlay?.({
        kind: "health",
        message: "Connection interrupted, reconnecting...",
        retryCount: attempt,
      });
      if (spinState.running) {
        spin.message("Reconnecting...");
      }
      await sleep(backoff);
    }
  }
}

async function finalize(args: {
  result: WorkflowRunResult;
  spin: SpinnerHandle;
  spinState: SpinState;
  ui: WizardUI;
  cwd: string;
}): Promise<void> {
  const { result, spin, spinState, ui, cwd } = args;
  const hasError = result.status !== "success" || result.result?.exitCode;
  if (hasError) {
    if (spinState.running) {
      spin.stop("Failed", 1);
      spinState.running = false;
    }
    formatError(result, ui);
    throw new WizardError(
      result.error ?? result.result?.message ?? "Setup returned an error",
      { exitCode: mapExitCode(result.result?.exitCode) }
    );
  }

  if (spinState.running) {
    spin.message("Verifying setup...");
  }
  try {
    await verifySetup(result, ui, cwd);
  } catch {
    // Verification is best-effort; never fail the run on a verify hiccup.
  }

  if (spinState.running) {
    spin.stop("Done");
    spinState.running = false;
  }
  formatResult(result, ui);
}

function tagSuccess(result: WorkflowRunResult): void {
  setTag("wizard.outcome", "completed");
  if (result.result?.platform) {
    setTag("wizard.platform", String(result.result.platform));
  }
  if (result.result?.features) {
    setTag("wizard.features", (result.result.features as string[]).join(","));
  }
}

/**
 * Terminal error handling for a DO run. Returns normally for a clean
 * cancellation (exit 0); otherwise (re)throws a WizardError.
 */
function handleRunFailure(
  err: unknown,
  ui: WizardUI,
  spin: SpinnerHandle,
  spinState: SpinState
): void {
  if (spinState.running) {
    const cancelled = err instanceof WizardCancelledError;
    spin.stop(cancelled ? "Cancelled" : "Error", cancelled ? 0 : 1);
    spinState.running = false;
  }
  if (err instanceof WizardCancelledError) {
    setTag("wizard.outcome", "bailed");
    ui.cancel("Setup cancelled.");
    ui.feedback("cancelled");
    process.exitCode = 0;
    return;
  }
  setTag("wizard.outcome", "errored");
  ui.cancel("Setup failed");
  ui.feedback("failed");
  if (err instanceof WizardError) {
    throw err;
  }
  throw new WizardError(err instanceof Error ? err.message : String(err));
}

/**
 * Run the wizard via the Durable Object agent (WebSocket transport). Assumes
 * preamble + readiness + preflight already ran; `context` is resolved.
 */
export async function runViaAgentDO(args: {
  context: ResolvedInitContext;
  ui: WizardUI;
  /** Optional WS base URL from the server routing decision (overrides the constant). */
  agentDoUrl?: string;
}): Promise<void> {
  const { context, ui } = args;
  const runId = randomUUID();
  const base = (args.agentDoUrl ?? INIT_AGENT_DO_URL).replace(
    TRAILING_SLASHES_RE,
    ""
  );
  const url = `${base}/agents/sentry-init-agent/${runId}`;

  setTag("wizard.transport", "agent-do");
  ui.setIntroMode?.(false);

  const spin = ui.spinner();
  const spinState: SpinState = { running: true };
  spin.start("Connecting to Sentry...");

  try {
    const output = await driveWithReconnect({
      url,
      context,
      ui,
      spin,
      spinState,
    });
    const result: WorkflowRunResult = {
      status: "success",
      result: normalizeOutput(output, context.directory),
    };
    await finalize({ result, spin, spinState, ui, cwd: context.directory });
    tagSuccess(result);
  } catch (err) {
    handleRunFailure(err, ui, spin, spinState);
  }
}
