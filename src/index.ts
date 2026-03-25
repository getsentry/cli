/**
 * Library entry point for programmatic Sentry CLI usage.
 *
 * Provides a variadic `sentry()` function that runs CLI commands in-process
 * and returns parsed JSON (or raw text). Errors are thrown as `SentryError`.
 *
 * CLI runner is re-exported as `_cli` for the npm bin wrapper (`dist/bin.cjs`).
 *
 * @example
 * ```typescript
 * import sentry from "sentry";
 *
 * const issues = await sentry("issue", "list", "-l", "5");
 * const orgs = await sentry("org", "list", { token: "sntrys_..." });
 * ```
 *
 * @module
 */

import { setEnv } from "./lib/env.js";
import type { Writer } from "./types/index.js";

/** Options for programmatic CLI invocation. */
export type SentryOptions = {
  /**
   * Auth token override. When omitted, falls back to `SENTRY_AUTH_TOKEN`
   * or `SENTRY_TOKEN` environment variables, then stored credentials.
   */
  token?: string;

  /**
   * Return human-readable text instead of parsed JSON.
   * When `true`, the function returns a `string` instead of a parsed object.
   */
  text?: boolean;

  /**
   * Working directory for this invocation.
   * Affects DSN auto-detection and project root resolution.
   * Defaults to `process.cwd()`.
   */
  cwd?: string;
};

/**
 * Error thrown when a CLI command exits with a non-zero code.
 *
 * Wraps the stderr output and exit code for programmatic error handling.
 */
export class SentryError extends Error {
  /** CLI exit code (non-zero). */
  readonly exitCode: number;

  /** Raw stderr output from the command. */
  readonly stderr: string;

  constructor(message: string, exitCode: number, stderr: string) {
    super(message);
    this.name = "SentryError";
    this.exitCode = exitCode;
    this.stderr = stderr;
  }
}

/**
 * Run a Sentry CLI command programmatically.
 *
 * Returns the parsed JSON result for data commands (default), or a trimmed
 * string for commands without JSON support (help, --version) or when
 * `{ text: true }` is passed.
 *
 * Throws {@link SentryError} on non-zero exit codes.
 *
 * @param args - CLI arguments as variadic strings, with an optional trailing
 *   {@link SentryOptions} object.
 * @returns Parsed JSON object/array, or trimmed string
 *
 * @example
 * ```typescript
 * // JSON mode (default)
 * const issues = await sentry("issue", "list", "-l", "5");
 *
 * // With auth token
 * const orgs = await sentry("org", "list", { token: "sntrys_..." });
 *
 * // Human-readable text
 * const text = await sentry("issue", "list", { text: true });
 *
 * // Error handling
 * try {
 *   await sentry("issue", "view", "NONEXISTENT-1");
 * } catch (err) {
 *   if (err instanceof SentryError) {
 *     console.error(err.exitCode, err.stderr);
 *   }
 * }
 * ```
 */
function sentry(...input: string[]): Promise<unknown>;
function sentry(...input: [...string[], SentryOptions]): Promise<unknown>;
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: library entry orchestrates env isolation, output capture, telemetry, and error conversion in one function
async function sentry(...input: (string | SentryOptions)[]): Promise<unknown> {
  // Detect trailing options object
  let args: string[];
  let options: SentryOptions | undefined;
  const last = input.at(-1);
  if (typeof last === "object" && last !== null) {
    options = last as SentryOptions;
    args = input.slice(0, -1) as string[];
  } else {
    args = input as string[];
  }

  // Build isolated env — inherits consumer's process.env, never mutates it
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (options?.token) {
    env.SENTRY_AUTH_TOKEN = options.token;
  }
  if (!options?.text) {
    env.SENTRY_OUTPUT_FORMAT = "json";
  }

  const cwd = options?.cwd ?? process.cwd();

  setEnv(env);

  try {
    // Capture output
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

    const fakeProcess = {
      stdout,
      stderr,
      stdin: process.stdin,
      env,
      cwd: () => cwd,
      exitCode: 0,
    };

    // Dynamic imports — heavy deps only load on first call
    const { run } = await import("@stricli/core");
    const { app } = await import("./app.js");
    const { buildContext } = await import("./context.js");
    const { withTelemetry } = await import("./lib/telemetry.js");

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

    try {
      await withTelemetry(
        // biome-ignore lint/suspicious/noExplicitAny: fakeProcess duck-types the process interface
        async (span) => run(app, args, buildContext(fakeProcess as any, span)),
        { libraryMode: true }
      );
    } catch (thrown) {
      // Flush telemetry before converting the error — ensures error events
      // captured by withTelemetry are sent even on the failure path.
      await flushTelemetry();

      // Stricli catches command errors and writes them to stderr + sets exitCode.
      // But some errors (AuthError, OutputError) are re-thrown through Stricli.
      // Convert any that escape into SentryError for a consistent library API.
      const stderrStr = stderrChunks.join("");
      // Prefer the thrown error's exitCode (CliError subclasses carry it),
      // then fakeProcess.exitCode (set by Stricli), then default to 1.
      const thrownCode =
        thrown instanceof Error && "exitCode" in thrown
          ? (thrown as { exitCode: number }).exitCode
          : 0;
      const exitCode = thrownCode || fakeProcess.exitCode || 1;
      // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape sequences use ESC (0x1b)
      const ANSI_RE = /\x1b\[[0-9;]*m/g;
      const message =
        stderrStr.replace(ANSI_RE, "").trim() ||
        (thrown instanceof Error ? thrown.message : String(thrown));
      throw new SentryError(message, exitCode, stderrStr);
    }

    // Flush telemetry on the success path too
    await flushTelemetry();

    const stderrStr = stderrChunks.join("");
    const stdoutStr = stdoutChunks.join("");

    // Non-zero exit → throw
    if (fakeProcess.exitCode !== 0) {
      // Strip ANSI codes from message for clean programmatic errors
      // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape sequences use ESC (0x1b)
      const ANSI_RE = /\x1b\[[0-9;]*m/g;
      const message =
        stderrStr.replace(ANSI_RE, "").trim() ||
        `Command failed with exit code ${fakeProcess.exitCode}`;
      throw new SentryError(message, fakeProcess.exitCode, stderrStr);
    }

    // Return captured object (zero-copy) or fall back to stdout parsing
    if (capturedResult !== undefined) {
      return capturedResult;
    }
    if (!stdoutStr.trim()) {
      return;
    }
    try {
      return JSON.parse(stdoutStr);
    } catch {
      return stdoutStr.trim();
    }
  } finally {
    setEnv(process.env);
  }
}

export { sentry };
export default sentry;

// CLI runner — internal, used by dist/bin.cjs wrapper
// biome-ignore lint/performance/noBarrelFile: library entry point must re-export both API and CLI runner
export { startCli as _cli } from "./cli.js";
