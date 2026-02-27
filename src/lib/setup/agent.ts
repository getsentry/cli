/**
 * Agent session management and REPL loop for the Sentry setup wizard.
 *
 * Provides three main exports:
 * - `checkPiAuth()` — detect configured model provider credentials
 * - `createSetupSession()` — create an in-memory Pi AgentSession
 * - `runSetupRepl()` — run an interactive REPL that streams output
 */

import { createInterface } from "node:readline";
import type {
  AgentSession,
  AgentSessionEvent,
} from "@mariozechner/pi-coding-agent";
import { error, muted } from "../formatters/colors.js";
import { SENTRY_SETUP_SYSTEM_PROMPT } from "./system-prompt.js";

/** Environment variable names for common model provider API keys. */
const PROVIDER_ENV_VARS = [
  "ANTHROPIC_API_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "OPENAI_API_KEY",
  "GROQ_API_KEY",
  "XAI_API_KEY",
  "OPENROUTER_API_KEY",
] as const;

/**
 * Check whether at least one model provider API key is configured.
 *
 * Checks common environment variables first for a fast path, then falls back
 * to reading AuthStorage (which reads ~/.pi/agent/auth.json) to detect keys
 * stored via `pi auth` or OAuth login.
 *
 * @returns `true` if at least one provider credential is found, `false` otherwise.
 */
export async function checkPiAuth(): Promise<boolean> {
  // Fast path: check well-known environment variables
  for (const envVar of PROVIDER_ENV_VARS) {
    if (process.env[envVar]) {
      return true;
    }
  }

  // Slower path: check ~/.pi/agent/auth.json via AuthStorage
  // This catches OAuth tokens and keys stored via `pi auth`
  try {
    const { AuthStorage } = await import("@mariozechner/pi-coding-agent");
    const authStorage = AuthStorage.create();
    return authStorage.list().length > 0;
  } catch {
    return false;
  }
}

/**
 * Create a Pi AgentSession wired up for the Sentry setup wizard.
 *
 * The session is fully in-memory (no disk persistence), loads the
 * Sentry setup system prompt, and skips Pi extensions so that only
 * the built-in coding tools are available.
 *
 * @param cwd - The working directory the agent will operate in (the project root).
 * @param skillPaths - Paths to additional skill directories to inject into the session.
 * @returns The ready-to-use `AgentSession`.
 */
export async function createSetupSession(
  cwd: string,
  skillPaths: string[]
): Promise<AgentSession> {
  const {
    AuthStorage,
    createAgentSession,
    createCodingTools,
    DefaultResourceLoader,
    ModelRegistry,
    SessionManager,
  } = await import("@mariozechner/pi-coding-agent");
  const { getModel } = await import("@mariozechner/pi-ai");

  const authStorage = AuthStorage.create();
  const modelRegistry = new ModelRegistry(authStorage);

  // Default to flagship models: Opus 4.6 primary, GPT-5.3 Codex as Ctrl+P alternative
  const defaultModel = getModel("anthropic", "claude-opus-4-6");
  const altModel = getModel("openai", "gpt-5.3-codex");

  const loader = new DefaultResourceLoader({
    cwd,
    systemPrompt: SENTRY_SETUP_SYSTEM_PROMPT,
    additionalSkillPaths: skillPaths,
    noExtensions: true,
  });
  await loader.reload();

  const { session } = await createAgentSession({
    cwd,
    resourceLoader: loader,
    sessionManager: SessionManager.inMemory(),
    authStorage,
    modelRegistry,
    tools: createCodingTools(cwd),
    model: defaultModel,
    thinkingLevel: "high" as const,
    scopedModels: [
      { model: defaultModel, thinkingLevel: "high" as const },
      { model: altModel, thinkingLevel: "high" as const },
    ],
  });

  return session;
}

/** Spinner frames — braille pattern matching the rest of the CLI (polling.ts) */
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/** Animation interval matching the CLI standard (50ms = 20fps) */
const ANIMATION_INTERVAL_MS = 50;

/**
 * Animated spinner that shows the agent is working.
 *
 * Displays a braille spinner with a message on stderr. The spinner
 * line is overwritten in-place using `\r\x1b[K` so it doesn't spam
 * the terminal. Call `stop()` before writing any other output to
 * stderr to avoid garbled lines.
 */
function createSpinner(stderr: { write(s: string): void }) {
  let message = "Thinking...";
  let tick = 0;
  let stopped = true;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const render = () => {
    if (stopped) {
      return;
    }
    const frame = SPINNER_FRAMES[tick % SPINNER_FRAMES.length];
    stderr.write(`\r\x1b[K${muted(`${frame} ${message}`)}`);
    tick += 1;
    timer = setTimeout(render, ANIMATION_INTERVAL_MS);
    timer.unref();
  };

  return {
    start: (msg?: string) => {
      if (msg) {
        message = msg;
      }
      stopped = false;
      tick = 0;
      render();
    },
    update: (msg: string) => {
      message = msg;
    },
    stop: () => {
      if (stopped) {
        return;
      }
      stopped = true;
      if (timer) {
        clearTimeout(timer);
      }
      stderr.write("\r\x1b[K");
    },
  };
}

/**
 * Format tool args into a concise, human-readable description.
 *
 * Tool args follow the Pi SDK schemas:
 * - bash: `{ command: string }`
 * - read: `{ path: string }`
 * - edit: `{ path: string, oldText, newText }`
 * - write: `{ path: string, content }`
 */
function formatToolDescription(toolName: string, args: unknown): string {
  if (args === null || typeof args !== "object") {
    return toolName;
  }
  const a = args as Record<string, unknown>;

  switch (toolName) {
    case "bash": {
      const cmd = typeof a.command === "string" ? a.command : "";
      // Truncate long commands to keep the line readable
      const truncated = cmd.length > 120 ? `${cmd.slice(0, 117)}...` : cmd;
      return `$ ${truncated}`;
    }
    case "read":
      return `read ${a.path ?? ""}`;
    case "edit":
      return `edit ${a.path ?? ""}`;
    case "write":
      return `write ${a.path ?? ""}`;
    case "grep":
      return `grep ${typeof a.pattern === "string" ? `"${a.pattern}" ` : ""}${a.path ?? ""}`;
    case "find":
      return `find ${a.pattern ?? a.path ?? ""}`;
    case "ls":
      return `ls ${a.path ?? "."}`;
    default:
      return toolName;
  }
}

/**
 * Extract a human-readable error string from a tool result.
 *
 * Tool results can be plain strings, or structured objects with a `content`
 * array (Pi SDK ToolResult format). This handles both without `[object Object]`.
 */
function extractErrorSummary(result: unknown): string {
  if (typeof result === "string") {
    return result;
  }
  if (result !== null && typeof result === "object") {
    // Pi SDK ToolResult: { content: [{ type: "text", text: "..." }] }
    if (
      "content" in result &&
      Array.isArray((result as { content: unknown }).content)
    ) {
      const parts = (
        result as { content: Array<{ type?: string; text?: string }> }
      ).content;
      const texts = parts
        .filter((p) => p.type === "text" && typeof p.text === "string")
        .map((p) => p.text);
      if (texts.length > 0) {
        return texts.join("\n");
      }
    }
    // Fallback: try .message (Error-like) or .text
    if (
      "message" in result &&
      typeof (result as { message: unknown }).message === "string"
    ) {
      return (result as { message: string }).message;
    }
    if (
      "text" in result &&
      typeof (result as { text: unknown }).text === "string"
    ) {
      return (result as { text: string }).text;
    }
  }
  return "Unknown error";
}

/** Output targets for the event handler. */
type EventHandlerIO = {
  stdout: { write(s: string): void };
  stderr: { write(s: string): void };
};

/** Handle tool_execution_start: print a description and restart spinner. */
function handleToolStart(
  event: { toolName: string; args: unknown },
  spinner: ReturnType<typeof createSpinner>,
  io: EventHandlerIO
): void {
  spinner.stop();
  const desc = formatToolDescription(event.toolName, event.args);
  io.stderr.write(`${muted(desc)}\n`);
  spinner.start(`Running ${event.toolName}...`);
}

/** Handle tool_execution_end: show errors if any and restart spinner. */
function handleToolEnd(
  event: { result: unknown; isError: boolean },
  spinner: ReturnType<typeof createSpinner>,
  io: EventHandlerIO
): void {
  spinner.stop();
  if (event.isError) {
    const summary = extractErrorSummary(event.result);
    const firstLine = summary.split("\n")[0] ?? summary;
    const truncated =
      firstLine.length > 200 ? `${firstLine.slice(0, 197)}...` : firstLine;
    io.stderr.write(`${error("✗")} ${muted(truncated)}\n`);
  }
  spinner.start("Thinking...");
}

/**
 * Create an event handler that formats agent output for the terminal.
 *
 * Shows a spinner while the agent is thinking/working, prints tool calls
 * with descriptive summaries, and streams text deltas to stdout.
 */
function createEventHandler(
  stdout: { write(s: string): void },
  stderr: { write(s: string): void }
) {
  const spinner = createSpinner(stderr);
  const io: EventHandlerIO = { stdout, stderr };

  return {
    handle: (event: AgentSessionEvent) => {
      switch (event.type) {
        case "agent_start":
          spinner.start("Thinking...");
          break;
        case "agent_end":
          spinner.stop();
          if ("error" in event && event.error) {
            stderr.write(`\n${error("Error:")} ${String(event.error)}\n`);
          }
          break;
        case "message_update":
          if (event.assistantMessageEvent.type === "text_delta") {
            spinner.stop();
            stdout.write(event.assistantMessageEvent.delta);
          }
          break;
        case "tool_execution_start":
          handleToolStart(event, spinner, io);
          break;
        case "tool_execution_end":
          handleToolEnd(event, spinner, io);
          break;
        default:
          break;
      }
    },
    stop: () => spinner.stop(),
  };
}

/**
 * Initial prompt sent automatically when the setup wizard starts.
 *
 * Triggers the agent's Phase 1 (Detect) without waiting for user input,
 * so `sentry setup` immediately scans the project and proposes a plan.
 */
const INITIAL_PROMPT =
  "Scan this project, detect the language and framework, check for any existing " +
  "Sentry setup, and recommend what Sentry features to add.";

/**
 * Run an interactive REPL loop for the Sentry setup wizard.
 *
 * Sends an initial prompt immediately so the agent starts scanning the project
 * without waiting for user input. Then enters a REPL loop where agent output
 * streams to stdout, tool summaries go to stderr, and the user can type
 * follow-up questions.
 *
 * The loop continues until the user types "exit", "quit", sends EOF (Ctrl+D),
 * or presses Ctrl+C when not streaming.
 *
 * Ctrl+C while the agent is streaming aborts the current turn and re-prompts.
 *
 * @param session - The agent session to interact with.
 * @param stdin - Standard input stream.
 * @param stdout - Standard output (receives streaming agent text).
 * @param stderr - Standard error (receives tool summaries and errors).
 */
export async function runSetupRepl(
  session: AgentSession,
  stdin: NodeJS.ReadStream & { fd: 0 },
  stdout: { write(s: string): void },
  stderr: { write(s: string): void }
): Promise<void> {
  const handler = createEventHandler(stdout, stderr);
  const unsubscribe = session.subscribe((event: AgentSessionEvent) => {
    handler.handle(event);
  });

  // biome-ignore lint/suspicious/noExplicitAny: readline types don't align with NodeJS.ReadStream fd-branded type
  const rl = createInterface({ input: stdin as any, terminal: false });

  const question = (prompt: string): Promise<string> =>
    new Promise((resolve, reject) => {
      stdout.write(prompt);
      const onLine = (line: string) => {
        rl.removeListener("close", onClose);
        resolve(line);
      };
      const onClose = () => {
        rl.removeListener("line", onLine);
        reject(new Error("readline closed"));
      };
      rl.once("line", onLine);
      rl.once("close", onClose);
    });

  // Handle Ctrl+C at the process level. readline with terminal:false never
  // emits the "SIGINT" event, so we must listen on the process directly.
  // The handler is removed in the finally block to avoid accumulation.
  const sigintHandler = () => {
    handler.stop();
    if (session.isStreaming) {
      stderr.write("\n^C\n");
      session.abort().catch((_err: unknown) => {
        /* abort errors are expected */
      });
    } else {
      stdout.write("\n");
      rl.close();
    }
  };
  process.on("SIGINT", sigintHandler);

  // Track whether cleanup has run to prevent double-cleanup
  let exited = false;

  // Handle Ctrl+D (readline close event)
  rl.on("close", () => {
    if (!exited) {
      exited = true;
      unsubscribe();
    }
  });

  try {
    // Fire the initial prompt immediately — the agent starts scanning
    // the project without waiting for user input
    await session.prompt(INITIAL_PROMPT);

    // Main REPL loop
    while (true) {
      let input: string;
      try {
        input = await question("\n> ");
      } catch {
        // readline was closed (Ctrl+D or rl.close())
        break;
      }

      const trimmed = input.trim();

      if (!trimmed) {
        // Re-prompt silently on empty input
        continue;
      }

      if (trimmed === "exit" || trimmed === "quit") {
        break;
      }

      // prompt() resolves when the agent turn is fully complete
      await session.prompt(trimmed);
    }
  } finally {
    handler.stop();
    process.removeListener("SIGINT", sigintHandler);
    if (!exited) {
      exited = true;
      rl.close();
      unsubscribe();
    }
  }
}
