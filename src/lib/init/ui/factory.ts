/**
 * WizardUI Factory
 *
 * Picks the appropriate `WizardUI` implementation based on runtime
 * environment and CLI flags. This is the single chokepoint for UI
 * selection — every part of the init wizard goes through `getUIAsync()`
 * rather than instantiating implementations directly.
 *
 * Selection priority (highest first):
 *
 * 1. `--yes` flag set, OR stdin/stdout is not a TTY — `LoggingUI`
 *    (CI / piped input). Prompt methods throw, so callers must
 *    pre-resolve every choice up-front.
 * 2. `SENTRY_INIT_TUI=0` or `--no-tui` — `LoggingUI`. Acts as a debug
 *    escape hatch when the OpenTUI path misbehaves. In an interactive
 *    context this means the wizard becomes effectively non-interactive
 *    (any prompt aborts), so users hitting this path will need to set
 *    every choice via flags or rely on auto-detection.
 * 3. Running outside the Bun-compiled binary (i.e. on Node) — also
 *    `LoggingUI`. OpenTUI ships native Zig bindings that the npm
 *    `dist/bin.cjs` distribution can't load. The npm package's
 *    `--help` output and onboarding docs direct users to the Bun
 *    binary for the interactive `sentry init` experience.
 * 4. Default (Bun binary, interactive, no opt-out) — `OpenTuiUI`.
 *
 * The previous `ClackUI` implementation was removed in PR 4 once the
 * OpenTUI implementation became the default. `@clack/prompts` is no
 * longer a dependency.
 */

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
   * `--no-tui`. Forces `LoggingUI`.
   */
  forceLegacy?: boolean;
};

/**
 * Detect whether the CLI is running inside the Bun-compiled binary
 * (where OpenTUI's native bindings are present) vs. the npm/Node
 * distribution. The `Bun` global only exists in the Bun runtime.
 *
 * Exported for the test suite — production callers should go through
 * `getUIAsync()`.
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
 * Returns `true` when the `LoggingUI` should be used — i.e. we're in
 * a non-interactive context, the user opted out of the TUI, the env
 * var override is set, or the runtime can't load OpenTUI.
 */
function shouldUseLogging(opts: UIFactoryOptions): boolean {
  if (process.env.SENTRY_INIT_TUI === "0") {
    return true;
  }
  if (opts.forceLegacy) {
    return true;
  }
  if (opts.yes) {
    return true;
  }
  if (!isInteractiveTerminal()) {
    return true;
  }
  if (!isBunRuntime()) {
    return true;
  }
  return false;
}

/**
 * Async factory — picks `OpenTuiUI` for interactive runs on the Bun
 * binary, otherwise `LoggingUI`. The async form exists because
 * instantiating `OpenTuiUI` requires a lazy `import("@opentui/core")`
 * (the package isn't bundled into the npm/Node distribution and would
 * crash if statically imported there).
 *
 * Callers should treat the return value as an `AsyncDisposable` and
 * use `await using ui = await getUIAsync(...)` to guarantee teardown
 * on every exit path.
 */
export async function getUIAsync(opts: UIFactoryOptions): Promise<WizardUI> {
  if (shouldUseLogging(opts)) {
    return new LoggingUI();
  }
  try {
    const { createOpenTuiUI } = await import("./opentui-ui.js");
    return await createOpenTuiUI();
  } catch {
    // Fall through to LoggingUI so a missing/broken native binding
    // doesn't take down the wizard. This branch is unreachable on a
    // correctly built Bun binary — it exists as a safety net for
    // unusual runtime environments where the import fails.
    return new LoggingUI();
  }
}
