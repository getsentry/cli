/**
 * Test Fixtures and Helpers
 *
 * Shared utilities for creating isolated test environments.
 */

import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

function noop(): void {
  // Intentionally empty — absorbs async spawn errors
}

/**
 * Mock process for capturing CLI output
 */
export function mockProcess() {
  const output = { stdout: "", stderr: "", exitCode: 0 };

  return {
    output,
    process: {
      stdout: {
        write: (s: string) => {
          output.stdout += s;
        },
      },
      stderr: {
        write: (s: string) => {
          output.stderr += s;
        },
      },
      get exitCode() {
        return output.exitCode;
      },
      set exitCode(code: number) {
        output.exitCode = code;
      },
    },
  };
}

export type CliResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

/**
 * Get the CLI command to execute.
 * Uses SENTRY_CLI_BINARY env var if set (for CI with pre-built binary),
 * otherwise falls back to running source via bun.
 */
export function getCliCommand(): string[] {
  const binaryPath = process.env.SENTRY_CLI_BINARY;
  if (binaryPath) {
    return [binaryPath];
  }
  return [process.execPath, "run", "src/bin.ts"];
}

/**
 * Run CLI command and capture output.
 */
export async function runCli(
  args: string[],
  options?: {
    cwd?: string;
    env?: Record<string, string>;
  }
): Promise<CliResult> {
  const cliDir = join(import.meta.dirname, "..");
  const [cmdBin, ...cmdArgs] = getCliCommand();

  const proc = spawn(cmdBin, [...cmdArgs, ...args], {
    cwd: options?.cwd ?? cliDir,
    env: { ...process.env, ...options?.env },
    stdio: ["pipe", "pipe", "pipe"],
  });
  proc.on("error", noop);

  let stdout = "";
  let stderr = "";
  proc.stdout.on("data", (d: Buffer) => {
    stdout += d;
  });
  proc.stderr.on("data", (d: Buffer) => {
    stderr += d;
  });

  const exitCode = await new Promise<number>((resolve) =>
    proc.on("close", (code) => resolve(code ?? 1))
  );

  return {
    stdout,
    stderr,
    exitCode,
  };
}

export type E2EContext = {
  run: (args: string[]) => Promise<CliResult>;
  /** Write auth token directly to this context's config directory (race-safe) */
  setAuthToken: (token: string) => Promise<void>;
  configDir: string;
  serverUrl: string;
};

/**
 * Create an E2E test context with mock server environment pre-configured.
 * Call this in beforeEach to get a `run` function that includes the mock server URL
 * and config directory in the environment automatically.
 *
 * IMPORTANT: Use ctx.setAuthToken() instead of the global setAuthToken() to avoid
 * race conditions when test files run in parallel.
 */
export function createE2EContext(
  configDir: string,
  serverUrl: string
): E2EContext {
  const { CONFIG_DIR_ENV_VAR } = require("../src/lib/db/index.js");
  return {
    configDir,
    serverUrl,
    run: (args: string[]) =>
      runCli(args, {
        env: {
          SENTRY_AUTH_TOKEN: "",
          SENTRY_TOKEN: "",
          [CONFIG_DIR_ENV_VAR]: configDir,
          SENTRY_URL: serverUrl,
          SENTRY_CLI_NO_TELEMETRY: "1",
        },
      }),
    /**
     * Write auth token directly to this context's database.
     * This bypasses the global process.env to avoid race conditions
     * when multiple test files run in parallel.
     *
     * Scopes the token to this context's `serverUrl` (the mock server) so
     * the host-scoping fetch-layer guard admits the request — without this,
     * the stored token would default to SaaS (DEFAULT_SENTRY_URL) while
     * `ctx.run` points `SENTRY_URL` at the mock server, causing the guard
     * to refuse to attach credentials.
     */
    async setAuthToken(token: string): Promise<void> {
      mkdirSync(configDir, { recursive: true, mode: 0o700 });
      const prevDir = process.env[CONFIG_DIR_ENV_VAR];
      process.env[CONFIG_DIR_ENV_VAR] = configDir;
      try {
        const { setAuthToken: dbSetAuthToken } =
          require("../src/lib/db/auth.js");
        const { closeDatabase } = require("../src/lib/db/index.js");
        await dbSetAuthToken(token, undefined, undefined, { host: serverUrl });
        closeDatabase();
      } finally {
        if (prevDir !== undefined) {
          process.env[CONFIG_DIR_ENV_VAR] = prevDir;
        } else {
          // This delete is acceptable here — it's a scoped try/finally restore,
          // not a test lifecycle hook. preload.ts always sets the var so this
          // branch rarely fires.
          delete process.env[CONFIG_DIR_ENV_VAR];
        }
      }
    },
  };
}
