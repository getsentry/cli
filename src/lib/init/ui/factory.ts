/**
 * WizardUI Factory
 *
 * Picks the appropriate `WizardUI` implementation based on runtime
 * environment and CLI flags. This is the single chokepoint for UI
 * selection — every part of the init wizard goes through `getUI()`
 * rather than instantiating implementations directly.
 *
 * Selection priority (highest first):
 *
 * 1. `SENTRY_INIT_TUI=0` — force `LoggingUI` (debug escape hatch).
 * 2. `--yes` flag set, OR stdin is not a TTY, OR stdout is not a TTY —
 *    force `LoggingUI` (CI / piped input).
 * 3. Running on the npm/Node distribution (not the Bun-compiled binary)
 *    — force `LoggingUI`. OpenTUI is Bun-only and the Node `dist/bin.cjs`
 *    has no native binding for it. (Note: `OpenTuiUI` itself doesn't land
 *    until PR3 — until then this branch falls through to `ClackUI` because
 *    clack works on both runtimes.)
 * 4. `SENTRY_INIT_TUI=1` — force the new TUI (once `OpenTuiUI` exists).
 * 5. Default — `ClackUI` (today). PR4 flips this to `OpenTuiUI` once the
 *    full-screen renderer is ready.
 *
 * `--no-tui` flag handling lives in `src/commands/init.ts` and maps to
 * `SENTRY_INIT_TUI=0` before this factory runs.
 */

import { ClackUI } from "./clack-ui.js";
import { LoggingUI } from "./logging-ui.js";
import type { WizardUI } from "./types.js";

/**
 * Inputs that affect UI selection. Mirrors the relevant subset of
 * `WizardOptions` so we don't drag the full type into the factory.
 */
export type UIFactoryOptions = {
  /** True when `--yes` (or `--dry-run`, which implies non-interactive) is set. */
  yes: boolean;
  /**
   * True when the user explicitly opted out of the new TUI via
   * `--no-tui` or the wizard is otherwise unable to use it. This lets
   * the caller force `ClackUI`/`LoggingUI` without poking env vars.
   */
  forceLegacy?: boolean;
};

/**
 * Detect whether the CLI is running inside the Bun-compiled binary
 * (where OpenTUI's native bindings are present) vs. the npm/Node
 * distribution. The `Bun` global only exists in the Bun runtime.
 *
 * Exported for the test suite — production callers should go through
 * `getUI()`.
 */
export function isBunRuntime(): boolean {
  return (
    typeof globalThis.Bun !== "undefined" &&
    typeof process.versions.bun === "string"
  );
}

/**
 * Detect whether the current process can run an interactive prompt.
 * Both stdin (read keystrokes) and stdout (render the prompt) must be
 * TTYs. Piped input or output disqualifies us.
 *
 * Exported for the test suite.
 */
export function isInteractiveTerminal(): boolean {
  return Boolean(process.stdin.isTTY) && Boolean(process.stdout.isTTY);
}

/**
 * Returns `true` when the `LoggingUI` should be used regardless of any
 * other signal — i.e. we're in a non-interactive context.
 */
function shouldUseLogging(opts: UIFactoryOptions): boolean {
  if (process.env.SENTRY_INIT_TUI === "0") {
    return true;
  }
  if (opts.yes) {
    return true;
  }
  if (!isInteractiveTerminal()) {
    return true;
  }
  return false;
}

/**
 * Construct the `WizardUI` instance for this run.
 *
 * Callers should treat the return value as an `AsyncDisposable` and use
 * `await using ui = getUI(...)` to guarantee teardown on every exit
 * path. Both current implementations have a no-op disposer, but
 * `OpenTuiUI` (PR3) will rely on the dispose protocol to restore the
 * main screen buffer and stop its render loop.
 */
export function getUI(opts: UIFactoryOptions): WizardUI {
  if (shouldUseLogging(opts)) {
    return new LoggingUI();
  }
  // PR1: interactive runs use ClackUI on both Bun and Node.
  // PR3 will replace this branch with `new OpenTuiUI()` when on the
  // Bun-compiled binary, falling back to ClackUI on Node — and PR4
  // removes ClackUI altogether.
  if (opts.forceLegacy) {
    return new ClackUI();
  }
  return new ClackUI();
}
