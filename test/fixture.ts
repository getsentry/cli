/**
 * Test Fixtures and Helpers
 *
 * Shared utilities for creating isolated test environments.
 */

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Create a temporary directory for testing
 *
 * @param options - Configuration for the temp directory
 * @returns Disposable temp directory object
 */
export async function tmpdir(options?: {
  files?: Record<string, string>;
  env?: Record<string, string>;
}) {
  const dir = join(
    homedir(),
    `.sentry-cli-test-${Math.random().toString(36).slice(2)}`
  );
  mkdirSync(dir, { recursive: true });

  // Create files if specified
  if (options?.files) {
    for (const [filepath, content] of Object.entries(options.files)) {
      const fullPath = join(dir, filepath);
      const dirPath = fullPath.slice(0, fullPath.lastIndexOf("/"));
      if (dirPath && dirPath !== dir) {
        mkdirSync(dirPath, { recursive: true });
      }
      writeFileSync(fullPath, content);
    }
  }

  // Create .env file if specified
  if (options?.env) {
    const envContent = Object.entries(options.env)
      .map(([key, value]) => `${key}=${value}`)
      .join("\n");
    writeFileSync(join(dir, ".env"), envContent);
  }

  return {
    path: dir,
    [Symbol.asyncDispose]: async () => {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    },
  };
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
function getCliCommand(): string[] {
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
  const cliDir = join(import.meta.dir, "..");
  const cmd = getCliCommand();

  const proc = Bun.spawn([...cmd, ...args], {
    cwd: options?.cwd ?? cliDir,
    env: { ...process.env, ...options?.env },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);

  return {
    stdout,
    stderr,
    exitCode: await proc.exited,
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
  const { CONFIG_DIR_ENV_VAR } = require("../src/lib/config.js");
  return {
    configDir,
    serverUrl,
    run: (args: string[]) =>
      runCli(args, {
        env: {
          [CONFIG_DIR_ENV_VAR]: configDir,
          SENTRY_URL: serverUrl,
          SENTRY_CLI_NO_TELEMETRY: "1",
        },
      }),
    /**
     * Write auth token directly to this context's config file.
     * This bypasses the global process.env to avoid race conditions
     * when multiple test files run in parallel.
     */
    async setAuthToken(token: string): Promise<void> {
      const configFile = join(configDir, "config.json");
      const config = { auth: { token } };
      mkdirSync(configDir, { recursive: true, mode: 0o700 });
      await Bun.write(configFile, JSON.stringify(config, null, 2));
    },
  };
}
