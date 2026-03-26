/**
 * Direct command invocation for the typed SDK layer.
 *
 * Resolves commands from the Stricli route tree and calls their wrapped
 * handler functions directly — no string parsing, no route scanning.
 * Shares env isolation, telemetry, and error wrapping with `sentry()`.
 *
 * @module
 */

import { homedir } from "node:os";
import type { SentryOptions } from "../index.js";
import { SentryError } from "../index.js";
import type { Writer } from "../types/index.js";
import { setEnv } from "./env.js";

/** Type alias for command handler functions loaded from Stricli's route tree. */
type CommandHandler = (...args: unknown[]) => unknown;

/** Cached command loaders, keyed by joined path (e.g., "org.list") */
const commandCache = new Map<string, () => Promise<CommandHandler>>();

/**
 * Resolve a command from the route tree by path segments.
 * Result is cached — route tree is only walked once per command.
 */
async function resolveCommand(path: string[]): Promise<CommandHandler> {
  const key = path.join(".");
  let loaderFn = commandCache.get(key);
  if (!loaderFn) {
    const { routes } = await import("../app.js");
    // Walk route tree: routes → sub-route → command
    // biome-ignore lint/suspicious/noExplicitAny: Stricli's RoutingTarget union requires runtime duck-typing
    let target: any = routes;
    for (const segment of path) {
      target = target.getRoutingTargetForInput(segment);
      if (!target) {
        throw new Error(`SDK: command not found: ${path.join(" ")}`);
      }
    }
    // target is now a Command — cache its loader
    const command = target;
    loaderFn = () =>
      command.loader().then(
        // biome-ignore lint/suspicious/noExplicitAny: Stricli CommandModule shape has a default export
        (m: any) => (typeof m === "function" ? m : m.default)
      );
    commandCache.set(key, loaderFn);
  }
  return loaderFn();
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape sequences use ESC (0x1b)
const ANSI_RE = /\x1b\[[0-9;]*m/g;

/** Flush Sentry telemetry (no beforeExit handler in library mode). */
async function flushTelemetry(): Promise<void> {
  try {
    const Sentry = await import("@sentry/node-core/light");
    const client = Sentry.getClient();
    if (client) {
      await client.flush(3000);
    }
  } catch {
    // Telemetry flush is non-critical
  }
}

/** Build a SentryError from captured stderr and a thrown error or exit code. */
function buildSdkError(
  stderrChunks: string[],
  exitCode: number,
  thrown?: unknown
): SentryError {
  const stderrStr = stderrChunks.join("");
  const message =
    stderrStr.replace(ANSI_RE, "").trim() ||
    (thrown instanceof Error ? thrown.message : undefined) ||
    `Command failed with exit code ${exitCode}`;
  return new SentryError(message, exitCode, stderrStr);
}

/** Extract exit code from a thrown error, or return 0 if unknown. */
function extractExitCode(thrown: unknown): number {
  if (thrown instanceof Error && "exitCode" in thrown) {
    return (thrown as { exitCode: number }).exitCode;
  }
  return 0;
}

/** Parse captured output: prefer zero-copy object, then JSON, then raw string. */
function parseOutput<T>(capturedResult: unknown, stdoutChunks: string[]): T {
  if (capturedResult !== undefined) {
    return capturedResult as T;
  }
  const stdoutStr = stdoutChunks.join("");
  if (!stdoutStr.trim()) {
    return undefined as T;
  }
  try {
    return JSON.parse(stdoutStr) as T;
  } catch {
    return stdoutStr.trim() as T;
  }
}

/** Build output capture writers and a SentryContext-compatible context object. */
async function buildCaptureContext(
  env: NodeJS.ProcessEnv,
  cwd: string
): Promise<{
  context: {
    process: {
      stdout: Writer & { captureObject?: (obj: unknown) => void };
      stderr: Writer;
      stdin: NodeJS.ReadStream & { fd: 0 };
      env: NodeJS.ProcessEnv;
      cwd: () => string;
      exitCode: number;
    };
    stdout: Writer & { captureObject?: (obj: unknown) => void };
    stderr: Writer;
    stdin: NodeJS.ReadStream & { fd: 0 };
    env: NodeJS.ProcessEnv;
    cwd: string;
    homeDir: string;
    configDir: string;
  };
  stdoutChunks: string[];
  stderrChunks: string[];
  getCapturedResult: () => unknown;
}> {
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  let capturedResult: unknown;

  const stdout: Writer & { captureObject?: (obj: unknown) => void } = {
    write: (s: string) => {
      stdoutChunks.push(s);
    },
    captureObject: (obj: unknown) => {
      capturedResult = obj;
    },
  };
  const stderr: Writer = {
    write: (s: string) => {
      stderrChunks.push(s);
    },
  };

  const { getConfigDir } = await import("./db/index.js");

  const context = {
    process: {
      stdout,
      stderr,
      stdin: process.stdin,
      env,
      cwd: () => cwd,
      exitCode: 0,
    },
    stdout,
    stderr,
    stdin: process.stdin,
    env,
    cwd,
    homeDir: homedir(),
    configDir: getConfigDir(),
  };

  return {
    context,
    stdoutChunks,
    stderrChunks,
    getCapturedResult: () => capturedResult,
  };
}

/**
 * Build an invoker function bound to the given options.
 *
 * The invoker handles env isolation, context building, telemetry,
 * zero-copy capture, and error wrapping — the same guarantees as `sentry()`.
 */
export function buildInvoker(options?: SentryOptions) {
  return async function invokeCommand<T>(
    commandPath: string[],
    flags: Record<string, unknown>,
    positionalArgs: string[]
  ): Promise<T> {
    // Build isolated env (same as sentry())
    const env: NodeJS.ProcessEnv = { ...process.env };
    if (options?.token) {
      env.SENTRY_AUTH_TOKEN = options.token;
    }
    env.SENTRY_OUTPUT_FORMAT = "json";

    const cwd = options?.cwd ?? process.cwd();
    setEnv(env);

    try {
      const { context, stdoutChunks, stderrChunks, getCapturedResult } =
        await buildCaptureContext(env, cwd);

      const func = await resolveCommand(commandPath);
      const { withTelemetry, setCommandSpanName } = await import(
        "./telemetry.js"
      );

      try {
        await withTelemetry(
          async (span) => {
            if (span) {
              setCommandSpanName(span, commandPath.join("."));
            }
            await func.call(
              context,
              { ...flags, json: true },
              ...positionalArgs
            );
          },
          { libraryMode: true }
        );
      } catch (thrown) {
        await flushTelemetry();

        // OutputError: data was already rendered (captured) before the throw.
        // Return it despite the non-zero exit code — this is the "HTTP 404 body"
        // pattern where the data is useful even though the operation "failed".
        const captured = getCapturedResult();
        if (captured !== undefined) {
          return captured as T;
        }

        const exitCode =
          extractExitCode(thrown) || context.process.exitCode || 1;
        throw buildSdkError(stderrChunks, exitCode, thrown);
      }

      await flushTelemetry();

      // Check exit code (Stricli sets it without throwing for some errors)
      if (context.process.exitCode !== 0) {
        throw buildSdkError(stderrChunks, context.process.exitCode);
      }

      return parseOutput<T>(getCapturedResult(), stdoutChunks);
    } finally {
      setEnv(process.env);
    }
  };
}
