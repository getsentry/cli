/**
 * Sentry CLI Runner
 *
 * Wraps the original sentry-cli (Rust-based) for commands not yet
 * natively implemented. Uses npx to avoid requiring a separate install.
 * This abstraction allows future migration to native implementations
 * without changing the public interface.
 */

import { spawn } from "node:child_process";

/**
 * Run sentry-cli via npx with the given arguments.
 *
 * Uses stdio: "inherit" for interactive terminal passthrough,
 * matching the wizard.ts pattern.
 *
 * @param args - Arguments to pass to sentry-cli (e.g., ["releases", "new", "1.0.0"])
 * @throws Error if npx is not found or sentry-cli exits with non-zero code
 */
export function runSentryCli(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const npx = Bun.which("npx");
    if (!npx) {
      reject(
        new Error(
          "npx not found. Please install Node.js/npm to use this command."
        )
      );
      return;
    }

    const proc = spawn(npx, ["@sentry/cli@latest", ...args], {
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
