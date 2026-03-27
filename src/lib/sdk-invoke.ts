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
import { type AsyncChannel, createAsyncChannel } from "./async-channel.js";
import { setEnv } from "./env.js";
import { SentryError, type SentryOptions } from "./sdk-types.js";

/** CLI flag names/aliases that trigger infinite streaming output. */
const STREAMING_FLAG_NAMES = new Set(["--refresh", "--follow", "-f"]);

/** Check if CLI args contain any streaming flag. */
function hasStreamingFlag(args: string[]): boolean {
  return args.some((arg) => STREAMING_FLAG_NAMES.has(arg));
}

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

/** Options for building a capture context. */
type CaptureOptions = {
  /** When set, captureObject pushes to this channel instead of accumulating. */
  channel?: AsyncChannel<unknown>;
  /** When set, placed on the fake process for streaming commands to honor. */
  abortSignal?: AbortSignal;
};

/** Build output capture writers and a SentryContext-compatible context object. */
async function buildCaptureContext(
  env: NodeJS.ProcessEnv,
  cwd: string,
  opts?: CaptureOptions
): Promise<CaptureContext> {
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  const capturedResults: unknown[] = [];

  const captureObject = opts?.channel
    ? (obj: unknown) => {
        opts.channel?.push(obj);
      }
    : (obj: unknown) => {
        capturedResults.push(obj);
      };

  const stdout: Writer = {
    write: (s: string) => {
      stdoutChunks.push(s);
    },
    captureObject,
  };
  const stderr: Writer = {
    write: (s: string) => {
      stderrChunks.push(s);
    },
  };

  const { getConfigDir } = await import("./db/index.js");

  // biome-ignore lint/suspicious/noExplicitAny: abortSignal is an internal extension to the fake process
  const fakeProcess: any = {
    stdout,
    stderr,
    stdin: process.stdin,
    env,
    cwd: () => cwd,
    exitCode: 0,
  };

  if (opts?.abortSignal) {
    fakeProcess.abortSignal = opts.abortSignal;
  }

  const context = {
    process: fakeProcess,
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
 * Streaming execution wrapper — runs the command in the background and
 * returns an AsyncChannel that yields values as they arrive.
 *
 * An AbortController is created per call. Consumer `break` (iterator return)
 * and `SentryOptions.signal` both cascade to the controller. The abort signal
 * is placed on the fake process so streaming commands can honor it.
 */
function executeWithStream<T>(
  options: SentryOptions | undefined,
  executor: (
    captureCtx: CaptureContext,
    span: Span | undefined
  ) => Promise<void>
): AsyncChannel<T> {
  const controller = new AbortController();

  // Cascade external signal to our controller
  if (options?.signal) {
    if (options.signal.aborted) {
      controller.abort();
    } else {
      options.signal.addEventListener("abort", () => controller.abort(), {
        once: true,
      });
    }
  }

  const channel = createAsyncChannel<T>({
    onReturn: () => controller.abort(),
  });

  // Fire-and-forget — command runs in background
  (async () => {
    const env = buildIsolatedEnv(options);
    const cwd = options?.cwd ?? process.cwd();
    setEnv(env);

    let captureCtx: CaptureContext | undefined;
    try {
      captureCtx = await buildCaptureContext(env, cwd, {
        channel: channel as AsyncChannel<unknown>,
        abortSignal: controller.signal,
      });

      const { withTelemetry } = await import("./telemetry.js");

      // biome-ignore lint/style/noNonNullAssertion: captureCtx is assigned on the line above
      await withTelemetry(async (span) => executor(captureCtx!, span), {
        libraryMode: true,
      });

      // Check exit code — Stricli sets it without throwing for some errors
      if (captureCtx.context.process.exitCode !== 0) {
        channel.error(
          buildSdkError(
            captureCtx.stderrChunks,
            captureCtx.context.process.exitCode
          )
        );
      } else {
        channel.close();
      }
    } catch (thrown) {
      const stderrChunks = captureCtx?.stderrChunks ?? [];
      const exitCode =
        extractExitCode(thrown) || captureCtx?.context.process.exitCode || 1;
      const err =
        thrown instanceof SentryError
          ? thrown
          : buildSdkError(stderrChunks, exitCode, thrown);
      channel.error(err);
    } finally {
      await flushTelemetry();
      setEnv(process.env);
    }
  })();

  return channel;
}

/**
 * Build an invoker function bound to the given options.
 *
 * The invoker handles env isolation, context building, telemetry,
 * zero-copy capture, and error wrapping — used by the typed SDK methods.
 *
 * When `meta.streaming` is true, returns an AsyncIterable that yields
 * values as the command produces them (for `--follow`/`--refresh` commands).
 */
export function buildInvoker(options?: SentryOptions) {
  return function invokeCommand<T>(
    commandPath: string[],
    flags: Record<string, unknown>,
    positionalArgs: string[],
    meta?: { streaming?: boolean }
  ): Promise<T> | AsyncIterable<T> {
    if (meta?.streaming) {
      return executeWithStream<T>(options, async (ctx, span) => {
        const func = await resolveCommand(commandPath);
        if (span) {
          const { setCommandSpanName } = await import("./telemetry.js");
          setCommandSpanName(span, commandPath.join("."));
        }
        await func.call(
          ctx.context,
          { ...flags, json: true },
          ...positionalArgs
        );
      });
    }

    return executeWithCapture<T>(options, async (ctx, span) => {
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
 * without JSON support. When streaming flags are detected, returns
 * an AsyncIterable instead.
 */
export function buildRunner(options?: SentryOptions) {
  return function run(
    ...args: string[]
  ): Promise<unknown> | AsyncIterable<unknown> {
    if (hasStreamingFlag(args)) {
      return executeWithStream<unknown>(options, async (ctx, span) => {
        const { run: stricliRun } = await import("@stricli/core");
        const { app } = await import("../app.js");
        const { buildContext } = await import("../context.js");
        // biome-ignore lint/suspicious/noExplicitAny: fakeProcess duck-types the process interface
        const process_ = ctx.context.process as any;
        await stricliRun(app, args, buildContext(process_, span));
      });
    }

    return executeWithCapture<unknown>(options, async (ctx, span) => {
      const { run: stricliRun } = await import("@stricli/core");
      const { app } = await import("../app.js");
      const { buildContext } = await import("../context.js");
      // biome-ignore lint/suspicious/noExplicitAny: fakeProcess duck-types the process interface
      const process_ = ctx.context.process as any;
      await stricliRun(app, args, buildContext(process_, span));
    });
  };
}
