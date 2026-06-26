/**
 * Runs the local Sentry init coding agent via the Claude Agent SDK.
 *
 * Model traffic is routed through the Sentry init gateway (which forwards to
 * the Vercel AI Gateway) by setting the ANTHROPIC_* env vars on the SDK
 * subprocess. Tools are the built-in Read/Write/Edit/Glob/Grep/Bash/TodoWrite
 * plus the in-process Sentry MCP tools (docs lookup + Xcode transforms).
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { WizardError } from "../../errors.js";
import type { WizardOutput } from "../types.js";
import type { SpinnerHandle, WizardUI } from "../ui/types.js";
import { canUseInitAgentTool } from "./permissions.js";
import { resolveClaudeExecutable } from "./runtime.js";
import { buildAgentSandbox } from "./sandbox.js";
import { loadAgentSdk, type SdkMessage } from "./sdk-loader.js";
import { createSentryToolsServer, SENTRY_TOOL_NAMES } from "./tools.js";

const STATUS_RE = /^\[STATUS\]\s*(.+)$/u;
const ABORT_RE = /^\[ABORT\]\s*(.+)$/mu;
const AGENT_MODEL = "anthropic/claude-sonnet-4.6";
/** Bound runaway sessions: the SDK has no built-in wall-clock timeout. */
const AGENT_MAX_TURNS = 80;

/**
 * Resolve the model id. Defaults to the Vercel-gateway-style slug; overridable
 * via `SENTRY_INIT_AGENT_MODEL` (e.g. a raw Anthropic id like
 * `claude-sonnet-4-6` for the direct/BYO-key path below).
 */
function resolveModel(): string {
  return process.env.SENTRY_INIT_AGENT_MODEL?.trim() || AGENT_MODEL;
}

export type InitAgentRunOptions = {
  authToken: string;
  gatewayUrl: string;
  dryRun: boolean;
  prompt: string;
  appendSystemPrompt: string;
  ui: WizardUI;
  workingDirectory: string;
};

function messageContent(
  message: SdkMessage
): Array<{ type?: string; text?: string }> {
  const content = message.message?.content ?? message.content;
  if (Array.isArray(content)) {
    return content as Array<{ type?: string; text?: string }>;
  }
  if (typeof content === "string") {
    return [{ type: "text", text: content }];
  }
  return [];
}

function extractText(message: SdkMessage): string {
  return messageContent(message)
    .map((part) => (part.type === "text" ? part.text : undefined))
    .filter((text): text is string => Boolean(text))
    .join("\n");
}

function statusLines(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.match(STATUS_RE)?.[1]?.trim())
    .filter((line): line is string => Boolean(line));
}

function abortReason(text: string): string | null {
  return text.match(ABORT_RE)?.[1]?.trim() ?? null;
}

function buildAllowedTools(dryRun: boolean): string[] {
  return [
    "Read",
    "Glob",
    "Grep",
    "TodoWrite",
    ...(dryRun ? [] : ["Write", "Edit", "Bash"]),
    ...SENTRY_TOOL_NAMES,
  ];
}

function buildAgentEnv(
  gatewayUrl: string,
  authToken: string,
  agentTempDir: string
): Record<string, string | undefined> {
  const base: Record<string, string | undefined> = {
    ...process.env,
    CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS: "1",
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
    CLAUDE_CODE_AUTO_CONNECT_IDE: "false",
    ENABLE_TOOL_SEARCH: "auto:0",
    // Isolate the spawned CLI from the user's own Claude Code setup: keep its
    // config/transcripts in our scratch dir (not ~/.claude) and don't auto-load
    // the user's CLAUDE.md memory (which loads regardless of settingSources and
    // would be a prompt-injection vector).
    CLAUDE_CONFIG_DIR: agentTempDir,
    CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
    TMP: agentTempDir,
    TEMP: agentTempDir,
    TMPDIR: agentTempDir,
  };

  // BYO-key / dev / self-host path: when an explicit Anthropic key is provided,
  // talk to Anthropic directly (or a custom base) instead of the Sentry gateway.
  const directKey = process.env.SENTRY_INIT_ANTHROPIC_API_KEY?.trim();
  if (directKey) {
    return {
      ...base,
      ANTHROPIC_API_KEY: directKey,
      ANTHROPIC_AUTH_TOKEN: "",
      ...(process.env.SENTRY_INIT_ANTHROPIC_BASE_URL
        ? { ANTHROPIC_BASE_URL: process.env.SENTRY_INIT_ANTHROPIC_BASE_URL }
        : { ANTHROPIC_BASE_URL: undefined }),
    };
  }

  // Default: route through the Sentry init gateway with the user's Sentry token.
  return {
    ...base,
    ANTHROPIC_BASE_URL: gatewayUrl,
    ANTHROPIC_AUTH_TOKEN: authToken,
    ANTHROPIC_API_KEY: "",
  };
}

function writeSdkLog(prompt: string): string {
  const dir = path.join(tmpdir(), "sentry-init-agent");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, `run-${Date.now()}.log`);
  writeFileSync(file, `Prompt:\n${prompt}\n`, { mode: 0o600 });
  return file;
}

function appendLog(logFile: string, contents: string): void {
  try {
    writeFileSync(logFile, contents, { flag: "a" });
  } catch {
    // Logging is best-effort; never fail a run because the log write failed.
  }
}

function isResultMessage(message: SdkMessage): boolean {
  return message.type === "result";
}

function isSuccessResult(message: SdkMessage): boolean {
  return (
    isResultMessage(message) &&
    message.subtype !== "error" &&
    message.is_error !== true
  );
}

type ConsumeContext = {
  spin: SpinnerHandle;
  ui: WizardUI;
  logFile: string;
};

type ConsumeResult = { success: boolean; finalText: string; lastText: string };

async function consumeAgentResponse(
  response: AsyncIterable<SdkMessage>,
  { spin, ui, logFile }: ConsumeContext
): Promise<ConsumeResult> {
  let success = false;
  let finalText = "";
  let lastText = "";

  for await (const message of response) {
    const text = extractText(message);
    if (text) {
      lastText = text;
      appendLog(logFile, `\n${text}\n`);
      for (const status of statusLines(text)) {
        spin.message(status);
        ui.log.info(status);
      }
      const reason = abortReason(text);
      if (reason) {
        throw new WizardError(reason);
      }
    }
    if (isSuccessResult(message)) {
      success = true;
      finalText = text || finalText;
    }
  }

  return { success, finalText, lastText };
}

export async function runInitAgent({
  authToken,
  gatewayUrl,
  dryRun,
  prompt,
  appendSystemPrompt,
  ui,
  workingDirectory,
}: InitAgentRunOptions): Promise<WizardOutput> {
  const { query } = await loadAgentSdk();
  const toolsServer = await createSentryToolsServer({ workingDirectory });
  const logFile = writeSdkLog(prompt);
  const agentTempDir = mkdtempSync(path.join(tmpdir(), "sentry-init-claude-"));
  ui.log.info(`Verbose agent logs: ${logFile}`);

  const spin: SpinnerHandle = ui.spinner();
  spin.start("Configuring Sentry with Claude...");

  try {
    const pathToClaudeCodeExecutable = await resolveClaudeExecutable({
      onDownload: () =>
        spin.message(
          "Downloading the init agent runtime (~62 MB, one-time)..."
        ),
    });
    const response = query({
      prompt,
      options: {
        model: resolveModel(),
        maxTurns: AGENT_MAX_TURNS,
        pathToClaudeCodeExecutable,
        cwd: workingDirectory,
        additionalDirectories: [workingDirectory],
        permissionMode: "acceptEdits",
        settingSources: [],
        mcpServers: { sentry: toolsServer },
        allowedTools: buildAllowedTools(dryRun),
        sandbox: buildAgentSandbox(workingDirectory, agentTempDir),
        canUseTool: (toolName: string, input: Record<string, unknown>) =>
          Promise.resolve(canUseInitAgentTool(toolName, input)),
        systemPrompt: {
          type: "preset",
          preset: "claude_code",
          append: appendSystemPrompt,
        },
        env: buildAgentEnv(gatewayUrl, authToken, agentTempDir),
        stderr: (data: string) => appendLog(logFile, `\nSTDERR:\n${data}`),
      },
    });

    const { success, finalText, lastText } = await consumeAgentResponse(
      response,
      { spin, ui, logFile }
    );

    if (!success) {
      throw new WizardError(
        "The init agent did not complete successfully. See the verbose log for details."
      );
    }

    spin.stop("Sentry configuration complete");
    return { message: finalText || lastText };
  } catch (error) {
    spin.stop("Sentry configuration failed", 1);
    throw error;
  } finally {
    try {
      rmSync(agentTempDir, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup of SDK scratch dir.
    }
  }
}
