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
 * 1. `SENTRY_INIT_TUI=0` or `forceLegacy` — force the legacy non-OpenTUI
 *    path (`LoggingUI` for non-interactive, `ClackUI` for interactive).
 *    Debug escape hatch for users who hit a TUI bug.
 * 2. `--yes` flag set, OR stdin/stdout is not a TTY — force `LoggingUI`
 *    regardless of the requested UI mode.
 * 3. Running outside the Bun-compiled binary (i.e. on Node) — fall back
 *    to `ClackUI` for interactive contexts. OpenTUI ships native Zig
 *    bindings that the npm `dist/bin.cjs` distribution can't load.
 * 4. `--tui` (or `SENTRY_INIT_TUI=1`) and on Bun binary → `OpenTuiUI`.
 * 5. Default — `ClackUI` until PR 4 flips this to `OpenTuiUI`.
 *
 * This module exposes both a sync `getUI()` (returns whatever doesn't
 * require an async load — `ClackUI`/`LoggingUI`) and an async
 * `getUIAsync()` that can return `OpenTuiUI` after the lazy
 * `@opentui/core` import resolves. Wizard call sites should use
 * `getUIAsync()` when they want the new TUI.
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
  /**
   * True when the user explicitly opted into the new TUI via `--tui`.
   * Ignored on the npm/Node distribution (where OpenTUI's native
   * bindings aren't available) and in non-interactive contexts.
   */
  preferTui?: boolean;
};

/**
 * Detect whether the CLI is running inside the Bun-compiled binary
 * (where OpenTUI's native bindings are present) vs. the npm/Node
 * distribution. The `Bun` global only exists in the Bun runtime.
 *
 * Exported for the test suite — production callers should go through
 * `getUI()` / `getUIAsync()`.
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
 * Decide whether the caller wants the OpenTUI implementation.
 *
 * This is true only when the user explicitly opted in (`--tui` flag or
 * `SENTRY_INIT_TUI=1`), the runtime is the Bun binary, and the
 * `forceLegacy` escape hatch is not set.
 */
function shouldUseOpenTui(opts: UIFactoryOptions): boolean {
  if (opts.forceLegacy) {
    return false;
  }
  if (!isBunRuntime()) {
    return false;
  }
  if (opts.preferTui === true) {
    return true;
  }
  if (process.env.SENTRY_INIT_TUI === "1") {
    return true;
  }
  return false;
}

/**
 * Synchronous factory — never returns `OpenTuiUI` because that
 * implementation requires an async `import("@opentui/core")`. Use
 * `getUIAsync()` to opt into the OpenTUI path.
 *
 * Callers should treat the return value as an `AsyncDisposable` and use
 * `await using ui = getUI(...)` to guarantee teardown on every exit
 * path.
 */
export function getUI(opts: UIFactoryOptions): WizardUI {
  if (shouldUseLogging(opts)) {
    return new LoggingUI();
  }
  return new ClackUI();
}

/**
 * Async factory — picks `OpenTuiUI` when the user opted in and the
 * runtime supports it, otherwise delegates to `getUI()`.
 *
 * The async form exists because instantiating `OpenTuiUI` requires a
 * lazy `import("@opentui/core")` (the package isn't bundled into the
 * npm/Node distribution and would crash if statically imported there).
 */
export async function getUIAsync(opts: UIFactoryOptions): Promise<WizardUI> {
  if (shouldUseLogging(opts)) {
    return new LoggingUI();
  }
  if (shouldUseOpenTui(opts)) {
    try {
      const { createOpenTuiUI } = await import("./opentui-ui.js");
      return await createOpenTuiUI();
    } catch {
      // Fall through to ClackUI so a missing/broken native binding
      // doesn't take down the wizard. The caller can opt into a
      // hard-fail by checking `--tui` themselves and calling
      // `createOpenTuiUI()` directly.
    }
  }
  return new ClackUI();
}
