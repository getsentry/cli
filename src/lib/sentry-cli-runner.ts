/**
 * Sentry CLI Runner
 *
 * Wraps the original sentry-cli (Rust-based) for commands not yet
 * natively implemented. Detects existing installations before falling
 * back to npx. This abstraction allows future migration to native
 * implementations without changing the public interface.
 */

import { spawn } from "node:child_process";
import { join } from "node:path";
import { ConfigError } from "./errors.js";

/** Resolved binary path and any prefix arguments (e.g., npx package name) */
type ResolvedBinary = {
  command: string;
  prefixArgs: string[];
};

/**
 * Resolve the sentry-cli binary to use.
 *
 * Priority:
 * 1. Global sentry-cli binary (brew, curl install, scoop, etc.)
 * 2. Local node_modules/.bin/sentry-cli (project dependency)
 * 3. npx @sentry/cli@latest (auto-download fallback)
 * 4. null (not available)
 */
async function resolveSentryCli(): Promise<ResolvedBinary | null> {
  // 1. Globally installed sentry-cli (fastest path, no npx overhead)
  const globalBin = Bun.which("sentry-cli");
  if (globalBin) {
    return { command: globalBin, prefixArgs: [] };
  }

  // 2. Local node_modules install (@sentry/cli as project dependency)
  const localBin = join(process.cwd(), "node_modules", ".bin", "sentry-cli");
  if (await Bun.file(localBin).exists()) {
    return { command: localBin, prefixArgs: [] };
  }

  // 3. Fall back to npx (auto-downloads on first use)
  const npx = Bun.which("npx");
  if (npx) {
    return { command: npx, prefixArgs: ["@sentry/cli@latest"] };
  }

  return null;
}

/**
 * Build platform-specific installation instructions.
 * Shows the most relevant install methods for the user's OS.
 */
function getInstallInstructions(): string {
  const { platform } = process;
  const lines = [
    "sentry-cli is required but not installed.\n",
    "Install it using one of these methods:\n",
  ];

  if (platform === "darwin") {
    lines.push("  brew install getsentry/tools/sentry-cli");
    lines.push("  curl -sL https://sentry.io/get-cli/ | sh");
  } else if (platform === "win32") {
    lines.push("  scoop install sentry-cli");
  } else {
    lines.push("  curl -sL https://sentry.io/get-cli/ | sh");
  }

  lines.push("  npm install -g @sentry/cli");

  return lines.join("\n");
}

/**
 * Run sentry-cli with the given arguments.
 *
 * Resolves the binary (global > local > npx), then spawns it
 * with stdio: "inherit" for interactive terminal passthrough.
 *
 * @param args - Arguments to pass to sentry-cli (e.g., ["releases", "new", "1.0.0"])
 * @throws ConfigError if sentry-cli is not installed and npx is unavailable
 * @throws Error if sentry-cli exits with non-zero code
 */
export async function runSentryCli(args: string[]): Promise<void> {
  const resolved = await resolveSentryCli();

  if (!resolved) {
    throw new ConfigError(
      "sentry-cli is not installed",
      getInstallInstructions()
    );
  }

  return new Promise((resolve, reject) => {
    const proc = spawn(resolved.command, [...resolved.prefixArgs, ...args], {
      stdio: "inherit",
      env: process.env,
    });

    proc.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`sentry-cli exited with code ${code}`));
      }
    });

    proc.on("error", (err) => {
      reject(new Error(`Failed to run sentry-cli: ${err.message}`));
    });
  });
}
