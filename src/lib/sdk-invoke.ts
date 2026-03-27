/**
 * Direct command invocation for the typed SDK layer.
 *
 * Resolves commands from the Stricli route tree and calls their wrapped
 * handler functions directly — no string parsing, no route scanning.
 *
 * Also provides `buildRunner()` — the variadic `run()` escape hatch
 * that accepts CLI argument strings and routes them through Stricli.
 *
 * Both `buildInvoker` and `buildRunner` share the same env isolation,
 * telemetry, zero-copy capture, and error wrapping guarantees via the
 * `executeWithCapture` helper.
 *
 * @module
 */

import { homedir } from "node:os";
import type { Span } from "@sentry/core";
import type { Writer } from "../types/index.js";
import { setEnv } from "./env.js";
import { SentryError, type SentryOptions } from "./sdk-types.js";

/** Flags that trigger infinite streaming — not supported in library mode. */
const STREAMING_FLAGS = new Set(["--refresh", "--follow", "-f"]);

/**
 * Build an isolated env from options, inheriting the consumer's process.env.
 * Sets auth token, host URL, default org/project, and output format.
 */
function buildIsolatedEnv(
  options?: SentryOptions,
  jsonByDefault = true
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (options?.token) {
    env.SENTRY_AUTH_TOKEN = options.token;
  }
  if (options?.url) {
    env.SENTRY_HOST = options.url;
  }
  if (options?.org) {
    env.SENTRY_ORG = options.org;
  }
  if (options?.project) {
    env.SENTRY_PROJECT = options.project;
  }
  if (jsonByDefault && !options?.text) {
    env.SENTRY_OUTPUT_FORMAT = "json";
  }
  return env;
}

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
    (thrown !== undefined ? String(thrown) : undefined) ||
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

/** Captured output state from a command execution. */
type CaptureContext = {
  /** SentryContext-compatible object for direct command invocation. */
  context: {
    process: {
      stdout: Writer;
      stderr: Writer;
      stdin: NodeJS.ReadStream & { fd: 0 };
      env: NodeJS.ProcessEnv;
      cwd: () => string;
      exitCode: number;
    };
    stdout: Writer;
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
};

/** Build output capture writers and a SentryContext-compatible context object. */
async function buildCaptureContext(
  env: NodeJS.ProcessEnv,
  cwd: string
): Promise<CaptureContext> {
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  const capturedResults: unknown[] = [];

  const stdout: Writer = {
    write: (s: string) => {
      stdoutChunks.push(s);
    },
    captureObject: (obj: unknown) => {
      capturedResults.push(obj);
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
    getCapturedResult: () => {
      if (capturedResults.length === 0) {
        return;
      }
      return capturedResults.length === 1
        ? capturedResults[0]
        : capturedResults;
    },
  };
}

/**
 * Core execution wrapper shared by buildInvoker and buildRunner.
 *
 * Handles env isolation, capture context, telemetry, error wrapping,
 * and output parsing. Both public factories become thin wrappers that
 * only provide the executor callback.
 */
async function executeWithCapture<T>(
  options: SentryOptions | undefined,
  executor: (
    captureCtx: CaptureContext,
    span: Span | undefined
  ) => Promise<void>
): Promise<T> {
  const env = buildIsolatedEnv(options);
  const cwd = options?.cwd ?? process.cwd();
  setEnv(env);

  try {
    const captureCtx = await buildCaptureContext(env, cwd);
    const { withTelemetry } = await import("./telemetry.js");

    try {
      await withTelemetry(async (span) => executor(captureCtx, span), {
        libraryMode: true,
      });
    } catch (thrown) {
      await flushTelemetry();

      // OutputError: data was already rendered (captured) before the throw.
      // Return it despite the non-zero exit code — this is the "HTTP 404 body"
      // pattern where the data is useful even though the operation "failed".
      const captured = captureCtx.getCapturedResult();
      if (captured !== undefined) {
        return captured as T;
      }

      const exitCode =
        extractExitCode(thrown) || captureCtx.context.process.exitCode || 1;
      throw buildSdkError(captureCtx.stderrChunks, exitCode, thrown);
    }

    await flushTelemetry();

    // Check exit code (Stricli sets it without throwing for some errors)
    if (captureCtx.context.process.exitCode !== 0) {
      throw buildSdkError(
        captureCtx.stderrChunks,
        captureCtx.context.process.exitCode
      );
    }

    return parseOutput<T>(
      captureCtx.getCapturedResult(),
      captureCtx.stdoutChunks
    );
  } finally {
    setEnv(process.env);
  }
}

/**
 * Build an invoker function bound to the given options.
 *
 * The invoker handles env isolation, context building, telemetry,
 * zero-copy capture, and error wrapping — used by the typed SDK methods.
 */
export function buildInvoker(options?: SentryOptions) {
  return async function invokeCommand<T>(
    commandPath: string[],
    flags: Record<string, unknown>,
    positionalArgs: string[]
  ): Promise<T> {
    return await executeWithCapture<T>(options, async (ctx, span) => {
      const func = await resolveCommand(commandPath);
      if (span) {
        const { setCommandSpanName } = await import("./telemetry.js");
        setCommandSpanName(span, commandPath.join("."));
      }
      await func.call(ctx.context, { ...flags, json: true }, ...positionalArgs);
    });
  };
}

/**
 * Build a runner function bound to the given options.
 *
 * The runner accepts variadic CLI argument strings and routes them
 * through Stricli — the escape hatch for commands not covered by
 * typed SDK methods (or for passing raw CLI flags).
 *
 * Returns parsed JSON by default, or trimmed text for commands
 * without JSON support.
 *
 * @throws {SentryError} When a streaming flag (`--refresh`, `--follow`, `-f`)
 *   is passed — streaming is not supported in library mode.
 */
export function buildRunner(options?: SentryOptions) {
  return async function run(...args: string[]): Promise<unknown> {
    // Reject streaming flags — they produce infinite output unsuitable for library mode
    for (const arg of args) {
      if (STREAMING_FLAGS.has(arg)) {
        throw new SentryError(
          `Streaming flag "${arg}" is not supported in library mode. Use the CLI directly for streaming commands.`,
          1,
          ""
        );
      }
    }

    return await executeWithCapture<unknown>(options, async (ctx, span) => {
      const { run: stricliRun } = await import("@stricli/core");
      const { app } = await import("../app.js");
      const { buildContext } = await import("../context.js");
      // biome-ignore lint/suspicious/noExplicitAny: fakeProcess duck-types the process interface
      const process_ = ctx.context.process as any;
      await stricliRun(app, args, buildContext(process_, span));
    });
  };
}
