/**
 * Run installed binaries with inherited stdio, allowing transient Windows
 * executable locks to clear. Commands own exit-code and signal diagnostics.
 */

import { spawn } from "node:child_process";
import { setTimeout } from "node:timers/promises";
import type { ConsolaInstance } from "consola";

/** Five attempts allow up to five seconds for antivirus scanning to finish. */
const SPAWN_MAX_ATTEMPTS = 5;

/** Base delay in milliseconds; each failed launch adds another 500 ms. */
const SPAWN_RETRY_BASE_MS = 500;

/** Completion status of a child that launched successfully. */
type SpawnResult = {
  /** Exit code, or null when the child was terminated by a signal. */
  code: number | null;
  /** Terminating signal, or null when the child exited normally. */
  signal: NodeJS.Signals | null;
};

/**
 * Run a binary, retrying only EBUSY launch errors from transient executable locks.
 *
 * Handles both synchronous spawn throws and asynchronous error events. Completed
 * children return their status without retrying, including failures and signals.
 * Other launch errors and exhausted retries propagate to the caller.
 */
export async function spawnWithRetry(
  binaryPath: string,
  args: string[],
  env: NodeJS.ProcessEnv | undefined,
  log: Pick<ConsolaInstance, "warn">
): Promise<SpawnResult> {
  for (let attempt = 1; ; attempt++) {
    try {
      const child = spawn(binaryPath, args, { stdio: "inherit", env });
      return await new Promise<SpawnResult>((resolve, reject) => {
        child.on("error", reject);
        child.on("close", (code, signal) => resolve({ code, signal }));
      });
    } catch (error) {
      if (
        !(
          error instanceof Error &&
          "code" in error &&
          error.code === "EBUSY"
        ) ||
        attempt === SPAWN_MAX_ATTEMPTS
      ) {
        throw error;
      }
      const delay = attempt * SPAWN_RETRY_BASE_MS;
      log.warn(
        `Binary is locked (antivirus scan?), retrying in ${delay}ms... (attempt ${attempt}/${SPAWN_MAX_ATTEMPTS})`
      );
      await setTimeout(delay);
    }
  }
}
