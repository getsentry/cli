/**
 * Generic Polling Utility
 *
 * Provides a reusable polling mechanism with progress spinner display.
 * Used by commands that need to wait for async operations to complete.
 */

import type { Writer } from "../types/index.js";
import {
  formatProgressLine,
  truncateProgressMessage,
} from "./formatters/seer.js";

/** Default polling interval in milliseconds */
const DEFAULT_POLL_INTERVAL_MS = 1000;

/** Animation interval for spinner updates — 50ms gives 20fps, matching the ora/inquirer standard */
const ANIMATION_INTERVAL_MS = 50;

/** Default timeout in milliseconds (6 minutes) */
const DEFAULT_TIMEOUT_MS = 360_000;

/**
 * Options for the generic poll function.
 */
export type PollOptions<T> = {
  /** Function to fetch current state */
  fetchState: () => Promise<T | null>;
  /** Predicate to determine if polling should stop */
  shouldStop: (state: T) => boolean;
  /** Get progress message from state */
  getProgressMessage: (state: T) => string;
  /** Output stream for progress */
  stderr: Writer;
  /** Suppress progress output (JSON mode) */
  json?: boolean;
  /** Poll interval in ms (default: 1000) */
  pollIntervalMs?: number;
  /** Timeout in ms (default: 360000 / 6 min) */
  timeoutMs?: number;
  /** Custom timeout message */
  timeoutMessage?: string;
  /** Initial progress message */
  initialMessage?: string;
};

/**
 * Generic polling function with animated progress display.
 *
 * Polls the fetchState function until shouldStop returns true or timeout is reached.
 * Displays an animated spinner with progress messages when not in JSON mode.
 * Animation runs at 50ms intervals (20fps) independently of polling frequency.
 *
 * @typeParam T - The type of state being polled
 * @param options - Polling configuration
 * @returns The final state when shouldStop returns true
 * @throws {Error} When timeout is reached before shouldStop returns true
 *
 * @example
 * ```typescript
 * const finalState = await poll({
 *   fetchState: () => getAutofixState(org, issueId),
 *   shouldStop: (state) => isTerminalStatus(state.status),
 *   getProgressMessage: (state) => state.message ?? "Processing...",
 *   stderr: process.stderr,
 *   json: false,
 *   timeoutMs: 360_000,
 *   timeoutMessage: "Operation timed out after 6 minutes.",
 * });
 * ```
 */
export async function poll<T>(options: PollOptions<T>): Promise<T> {
  const {
    fetchState,
    shouldStop,
    getProgressMessage,
    stderr,
    json = false,
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    timeoutMessage = "Operation timed out after 6 minutes. Try again or check the Sentry web UI.",
    initialMessage = "Waiting for operation to start...",
  } = options;

  const startTime = Date.now();
  let tick = 0;
  let currentMessage = initialMessage;

  // Animation timer runs independently of polling for smooth spinner
  let stopped = false;
  if (!json) {
    const scheduleFrame = () => {
      if (stopped) {
        return;
      }
      const display = truncateProgressMessage(currentMessage);
      stderr.write(`\r\x1b[K${formatProgressLine(display, tick)}`);
      tick += 1;
      setTimeout(scheduleFrame, ANIMATION_INTERVAL_MS).unref();
    };
    scheduleFrame();
  }

  try {
    while (Date.now() - startTime < timeoutMs) {
      const state = await fetchState();

      if (state) {
        // Update message for animation loop to display
        currentMessage = getProgressMessage(state);

        if (shouldStop(state)) {
          return state;
        }
      }

      await Bun.sleep(pollIntervalMs);
    }

    throw new Error(timeoutMessage);
  } finally {
    // Clean up animation timer
    if (!json) {
      stopped = true;
      stderr.write("\n");
    }
  }
}

/**
 * Options for {@link withProgress}.
 */
export type WithProgressOptions = {
  /** Output stream for progress */
  stderr: Writer;
  /** Initial spinner message */
  message: string;
};

/**
 * Run an async operation with an animated spinner on stderr.
 *
 * The spinner uses the same braille frames as the Seer polling spinner,
 * giving a consistent look across all CLI commands. Progress output goes
 * to stderr, so it never contaminates stdout (safe to use alongside JSON output).
 *
 * The callback receives a `setMessage` function to update the displayed
 * message as work progresses (e.g. to show page counts during pagination).
 * Progress is automatically cleared when the operation completes.
 *
 * @param options - Spinner configuration
 * @param fn - Async operation to run; receives `setMessage` to update the displayed text
 * @returns The value returned by `fn`
 *
 * @example
 * ```typescript
 * const result = await withProgress(
 *   { stderr, message: "Fetching issues..." },
 *   async (setMessage) => {
 *     const data = await fetchWithPages({
 *       onPage: (fetched, total) => setMessage(`Fetching issues... ${fetched}/${total}`),
 *     });
 *     return data;
 *   }
 * );
 * ```
 */
export async function withProgress<T>(
  options: WithProgressOptions,
  fn: (setMessage: (msg: string) => void) => Promise<T>
): Promise<T> {
  const { stderr } = options;
  let currentMessage = options.message;
  let tick = 0;
  let stopped = false;

  const scheduleFrame = () => {
    if (stopped) {
      return;
    }
    const display = truncateProgressMessage(currentMessage);
    stderr.write(`\r\x1b[K${formatProgressLine(display, tick)}`);
    tick += 1;
    setTimeout(scheduleFrame, ANIMATION_INTERVAL_MS).unref();
  };
  scheduleFrame();

  try {
    return await fn((msg) => {
      currentMessage = msg;
    });
  } finally {
    stopped = true;
    stderr.write("\r\x1b[K");
  }
}
