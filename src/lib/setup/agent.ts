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
 * stored via `pi auth`.
 *
 * @returns `true` if at least one provider credential is found, `false` otherwise.
 */
export function checkPiAuth(): boolean {
  // Check well-known environment variables — covers the common case without
  // requiring a dynamic import of the Pi SDK.
  for (const envVar of PROVIDER_ENV_VARS) {
    if (process.env[envVar]) {
      return true;
    }
  }
  return false;
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

  const authStorage = AuthStorage.create();
  const modelRegistry = new ModelRegistry(authStorage);

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
  });

  return session;
}

/** Extract a human-readable string from a tool result object. */
function extractResultSummary(result: unknown): string {
  if (typeof result === "string") {
    return result;
  }
  if (result !== null && typeof result === "object" && "content" in result) {
    return String((result as { content: unknown }).content);
  }
  return "Tool failed";
}

/** Handle a single agent session event, writing formatted output to stdout/stderr. */
function handleSessionEvent(
  event: AgentSessionEvent,
  stdout: { write(s: string): void },
  stderr: { write(s: string): void }
): void {
  if (event.type === "message_update") {
    const msgEvent = event.assistantMessageEvent;
    if (msgEvent.type === "text_delta") {
      stdout.write(msgEvent.delta);
    }
    // thinking_delta is intentionally skipped for V1
    return;
  }

  if (event.type === "tool_execution_start") {
    stderr.write(`\n⚡ ${event.toolName}\n`);
    return;
  }

  if (event.type === "tool_execution_end" && event.isError) {
    const summary = extractResultSummary(event.result);
    stderr.write(`\n❌ ${event.toolName} failed: ${summary}\n`);
    return;
  }

  if (event.type === "agent_end" && "error" in event && event.error) {
    stderr.write(`\n❌ Agent error: ${String(event.error)}\n`);
  }
}

/**
 * Run an interactive REPL loop for the Sentry setup wizard.
 *
 * Subscribes to session events and streams agent output to stdout. Tool
 * execution summaries are written to stderr so they don't interfere with
 * the agent's text output. The loop continues until the user types "exit",
 * "quit", sends EOF (Ctrl+D), or presses Ctrl+C when not streaming.
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
  const unsubscribe = session.subscribe((event: AgentSessionEvent) => {
    handleSessionEvent(event, stdout, stderr);
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
    process.removeListener("SIGINT", sigintHandler);
    if (!exited) {
      exited = true;
      rl.close();
      unsubscribe();
    }
  }
}
