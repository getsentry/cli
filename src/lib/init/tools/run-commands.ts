import { spawn } from "node:child_process";
import { addBreadcrumb } from "@sentry/node-core/light";
import { whichSync } from "../../which.js";
import { DEFAULT_COMMAND_TIMEOUT_MS } from "../constants.js";
import type { RunCommandsPayload, ToolResult } from "../types.js";
import {
  parseCommand,
  readSpawnOutput,
  validateCommand as validateToolCommand,
} from "./command-utils.js";
import type { InitToolDefinition, ToolContext } from "./types.js";

/**
 * Validate and execute a batch of shell-free commands.
 */
export async function runCommands(
  payload: RunCommandsPayload,
  context: Pick<ToolContext, "dryRun">
): Promise<ToolResult> {
  const timeoutMs = payload.params.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;
  const parsedCommands: ReturnType<typeof parseCommand>[] = [];

  for (const command of payload.params.commands) {
    const validationError = validateToolCommand(command);
    if (validationError) {
      return { ok: false, error: validationError };
    }
    parsedCommands.push(parseCommand(command));
  }

  const results: Array<{
    command: string;
    exitCode: number;
    stdout: string;
    stderr: string;
  }> = [];

  for (const command of parsedCommands) {
    if (context.dryRun) {
      results.push({
        command: command.original,
        exitCode: 0,
        stdout: "(dry-run: skipped)",
        stderr: "",
      });
      continue;
    }

    const result = await runSingleCommand(command, payload.cwd, timeoutMs);
    results.push(result);
    if (result.exitCode !== 0) {
      addBreadcrumb({
        level: "error",
        message: `Command failed: ${command.original}`,
        data: {
          exitCode: result.exitCode,
          stderr: result.stderr.slice(0, 500),
          cwd: payload.cwd,
        },
      });
      return {
        ok: false,
        error: `Command "${command.original}" failed with exit code ${result.exitCode}: ${result.stderr}`,
        data: { results },
      };
    }
  }

  return { ok: true, data: { results } };
}

async function runSingleCommand(
  command: ReturnType<typeof parseCommand>,
  cwd: string,
  timeoutMs: number
): Promise<{
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
}> {
  const executable = whichSync(command.executable) ?? command.executable;

  try {
    const child = spawn(executable, command.args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const exited = new Promise<number>((resolve) => {
      child.on("close", (code) => resolve(code ?? 1));
      child.on("error", () => resolve(1));
    });
    let timedOut = false;
    const timer = globalThis.setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);

    const [exitCode, stdout, stderr] = await Promise.all([
      exited,
      readSpawnOutput(child.stdout),
      readSpawnOutput(child.stderr),
    ]);
    clearTimeout(timer);

    return {
      command: command.original,
      exitCode: timedOut ? 1 : exitCode,
      stdout,
      stderr: timedOut
        ? stderr || `Command timed out after ${timeoutMs}ms`
        : stderr,
    };
  } catch (error) {
    return {
      command: command.original,
      exitCode: 1,
      stdout: "",
      stderr: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Tool definition for sandboxed command execution.
 */
export const runCommandsTool: InitToolDefinition<"run-commands"> = {
  operation: "run-commands",
  describe: (payload) => {
    const [first] = payload.params.commands;
    if (payload.params.commands.length === 1 && first) {
      return `Running \`${first}\`...`;
    }
    return `Running ${payload.params.commands.length} commands (\`${first ?? "..."}\`, ...)...`;
  },
  execute: runCommands,
};
