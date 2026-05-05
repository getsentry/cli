/**
 * InkUI — Ink-based `WizardUI` implementation.
 *
 * The class is a thin bridge between the imperative `WizardUI`
 * surface (which the wizard runner calls into) and a React tree
 * mounted via Ink's `render()`. State lives in a `WizardStore`
 * (see `wizard-store.ts`) that React subscribes to via
 * `useSyncExternalStore`. Each method on this class translates a
 * single imperative call into one or more store mutations; React
 * re-renders.
 *
 * Why Ink rather than OpenTUI?
 *
 *   - **No native binary cost.** The OpenTUI implementation added
 *     ~10.7 MB to the compiled Bun binary (the `libopentui.so`
 *     plus the ~12k-line generated FFI bindings). Ink is pure JS,
 *     so it bundles cleanly with no platform-specific peer
 *     packages.
 *   - **Inline rendering.** Ink writes incrementally to stdout, so
 *     log lines naturally end up in the user's scrollback. OpenTUI
 *     needed an alternate-screen buffer + a post-dispose stderr
 *     replay to leave any trace of the run behind.
 *
 * **Stdin workaround for Bun.** Ink listens for `readable` events
 * on its `stdin` option (default `process.stdin`) and calls
 * `stdin.read()` to consume bytes. Bun's compiled binaries have a
 * long-standing bug — `process.stdin` accepts `setRawMode(true)` but
 * never delivers `readable` events for terminal input
 * (oven-sh/bun#6862, vadimdemedes/ink#636, both still open). The
 * symptom: the wizard renders fine but arrow keys, Enter, and
 * Ctrl+C all do nothing.
 *
 * Workaround: open a fresh `/dev/tty` `ReadStream` ourselves and
 * pass it to Ink as the `stdin` option. The fresh stream's
 * `readable` events fire correctly because the file-descriptor
 * inheritance bug only affects fd 0, not fds we open inside the
 * process. We close the stream on dispose to release the libuv
 * handle.
 *
 * **Lazy import.** `ink`, `ink-spinner`, and `react` are all
 * dynamically imported by `createInkUI()` so the npm bundle (which
 * excludes them from the bundle graph) never sees the imports at
 * module-load time. This keeps the `LoggingUI` path cheap to
 * instantiate when interactive UI is not needed.
 */

import { openSync } from "node:fs";
import { ReadStream } from "node:tty";
import chalk from "chalk";
import { stripAnsi } from "../../formatters/plain-detect.js";
import { buildFileTree, flattenTree } from "./file-tree.js";
import { LEARN_SEQUENCE } from "./learn-content.js";
import { SENTRY_TIPS } from "./sentry-tips.js";
import { detectColorScheme } from "./theme.js";
import {
  CANCELLED,
  type Cancelled,
  type ConfirmOptions,
  type MultiSelectOptions,
  type SelectOptions,
  type SpinnerExitCode,
  type SpinnerHandle,
  type WizardLog,
  type WizardSummary,
  type WizardUI,
} from "./types.js";
import { WizardStore } from "./wizard-store.js";

// Brand palette mirrored from `ink-app.tsx` so the post-dispose
// success/failure echo (rendered via chalk after Ink unmounts) feels
// like a continuation of the live screen.
const REPORT_MUTED = "#898294";
const REPORT_SUCCESS = "#83da90";
const REPORT_ERROR = "#fe4144";
const REPORT_WARN = "#FDB81B";

/** Splits on `: ` to separate error label from detail. */
const ERROR_SPLIT_RE = /:\s+/;

/**
 * Build the chalk-formatted failure report shown after alternate
 * screen exit. Includes up to 5 recent error log entries with
 * structured formatting for readability.
 */
function formatFailureReport(
  message: string,
  logs: readonly { severity: string; text: string }[]
): string {
  const icon = chalk.hex(REPORT_ERROR)("\u2716");
  const lines: string[] = [
    `\n${icon}  ${chalk.hex(REPORT_ERROR).bold(message)}`,
  ];
  const errorLogs = logs.filter(
    (entry) =>
      entry.severity === "error" &&
      entry.text !== message &&
      entry.text !== "Failed"
  );
  if (errorLogs.length > 0) {
    lines.push("");
  }
  for (const entry of errorLogs.slice(-5)) {
    formatErrorEntry(entry.text, lines);
  }
  return lines.join("\n");
}

/**
 * Format a single error log entry into indented report lines.
 * Splits on newlines first, then separates the first segment
 * (bold red) from subsequent detail (muted) on each line.
 */
function formatErrorEntry(text: string, out: string[]): void {
  const rawLines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (rawLines.length === 0) {
    return;
  }
  const first = rawLines[0] ?? "";
  const parts = first.split(ERROR_SPLIT_RE);
  out.push(`   ${chalk.hex(REPORT_ERROR).bold(parts[0] ?? "")}`);
  for (const part of parts.slice(1)) {
    out.push(`   ${chalk.hex(REPORT_MUTED)(part)}`);
  }
  for (const line of rawLines.slice(1)) {
    out.push(`   ${chalk.hex(REPORT_MUTED)(line)}`);
  }
}

/** Tip rotation cadence in the sidebar — slow enough to read each tip. */
const TIP_ROTATE_INTERVAL_MS = 8000;

/** Sentry brand purple — matches `src/lib/banner.ts`. */
const BANNER_GRADIENT = [
  "#B4A4DE",
  "#9C84D4",
  "#8468C8",
  "#6C4EBA",
  "#5538A8",
  "#432B8A",
];

const BANNER_ROWS = [
  "  ███████╗███████╗███╗   ██╗████████╗██████╗ ██╗   ██╗",
  "  ██╔════╝██╔════╝████╗  ██║╚══██╔══╝██╔══██╗╚██╗ ██╔╝",
  "  ███████╗█████╗  ██╔██╗ ██║   ██║   ██████╔╝ ╚████╔╝ ",
  "  ╚════██║██╔══╝  ██║╚██╗██║   ██║   ██╔══██╗  ╚██╔╝  ",
  "  ███████║███████╗██║ ╚████║   ██║   ██║  ██║   ██║   ",
  "  ╚══════╝╚══════╝╚═╝  ╚═══╝   ╚═╝   ╚═╝  ╚═╝   ╚═╝   ",
];

/**
 * Log severities recognised by InkUI. Mirrors the keys of
 * `ICON_BY_SEVERITY` in `ink-app.tsx`.
 */
type LogSeverity = "info" | "warn" | "error" | "success" | "message";

/**
 * Severity returned for a spinner stop given its exit code.
 *   0 → success, 1 → error, 2 → warn.
 */
function severityForStopCode(code: SpinnerExitCode): LogSeverity {
  if (code === 1) {
    return "error";
  }
  if (code === 2) {
    return "warn";
  }
  return "success";
}

/**
 * Embed `ink-app.tsx` as a Bun-compile file resource.
 *
 * `with { type: "file" }` tells Bun.compile to copy the raw .tsx
 * bytes into the binary's virtual filesystem and replace the import
 * specifier with the embedded path string at runtime. The
 * `text-import-plugin.ts` polyfill in `script/build.ts` mirrors this
 * for the esbuild step (copies the file alongside the bundle and
 * leaves the import external).
 *
 * Why this indirection? `ink-app.tsx` statically imports `ink`,
 * `ink-spinner`, and `react`. When Bun.compile bundles those
 * packages through its CJS-wrapping path the output mangles their
 * dev-build IIFEs (it injects `__promiseAll` runtime
 * helpers in positions the wrappers don't tolerate, producing a
 * `SyntaxError: Unexpected identifier '__promiseAll'` at startup
 * inside e.g. `react/cjs/react-jsx-runtime.development.js` or
 * `ink/build/parse-keypress.js`). Embedding the .tsx as raw bytes
 * pushes resolution to Bun's runtime — which doesn't have the bug
 * — at the cost of a small first-invocation parse overhead.
 *
 * The npm/Node distribution never reaches `createInkUI()` (the
 * factory routes there only on the Bun binary because Ink uses
 * top-level await that esbuild can't emit in our CJS bundle), so
 * the embedded file is unused on Node. We still produce it because
 * the static import is unconditional; the bundle.ts cleanup step
 * `unlink`s the unused sidecar after bundling.
 */
// @ts-expect-error: `with { type: "file" }` is Bun-specific and not yet typed in @types/bun
import inkAppPath from "./ink-app.tsx" with { type: "file" };

/**
 * Open a fresh `/dev/tty` `ReadStream` for Ink to consume. Returns
 * `null` when `/dev/tty` isn't available (non-TTY environment, or
 * platforms that don't expose it — Windows). The caller falls back
 * to `process.stdin` in that case, which works on Node but is
 * broken in Bun-compiled binaries (see module docstring).
 */
function openFreshTtyForInk(): ReadStream | null {
  try {
    const fd = openSync("/dev/tty", "r");
    return new ReadStream(fd);
  } catch {
    return null;
  }
}

/**
 * Async factory for `InkUI`. Imports `ink`, `react`, and the local
 * `App` component lazily, mounts the React tree, and returns the
 * bridge instance. Throws if Ink can't be loaded (e.g. missing peer
 * deps).
 */
export async function createInkUI(): Promise<InkUI> {
  const ink = await import("ink");
  const react = await import("react");
  // The `?bridge=1` query string is load-bearing. Without it Bun's
  // module loader hits a cache entry created by the static
  // `with { type: "file" }` import above (same absolute path) and
  // returns a synthetic `{ __esModule, default: undefined }` shape
  // instead of evaluating the .tsx as a module — `app.App`
  // becomes `undefined` and React throws "Element type is invalid".
  // The query string forces a distinct cache key while resolving to
  // the same on-disk file, so the .tsx is parsed and exports
  // populate normally. Confirmed on Bun 1.3.13 (dev) and inside
  // Bun-compiled binaries (the `/$bunfs/…` runtime path).
  const app = (await import(
    `${inkAppPath}?bridge=1`
  )) as typeof import("./ink-app.js");

  const store = new WizardStore({
    bannerRows: BANNER_ROWS.map((content, i) => ({
      content,
      color: BANNER_GRADIENT[i] ?? BANNER_GRADIENT[0] ?? "#FFFFFF",
    })),
  });

  store.setTheme(detectColorScheme());

  // Open a fresh /dev/tty so Ink's `readable` event listener
  // actually fires — see the module docstring for the Bun bug
  // details. We hold onto the stream so we can close it on dispose
  // (libuv otherwise keeps the handle alive and the process can't
  // exit cleanly).
  const freshStdin = openFreshTtyForInk();

  // Ink's render returns a handle with `unmount()` and
  // `waitUntilExit()`. We don't await `waitUntilExit` here because
  // the wizard drives lifecycle imperatively from the runner; the
  // dispose path calls `unmount()` directly when the workflow
  // finishes (success or failure).
  //
  // `exitOnCtrlC: false` lets us route Ctrl+C through the prompt
  // cancellation path (the SelectPrompt / MultiSelectPrompt
  // `useInput` handlers detect `\x03` and resolve with `null`)
  // instead of yanking the process down mid-spinner.
  //
  // `patchConsole: false` keeps `console.*` calls flowing to the
  // real stdout — Sentry SDK breadcrumbs, debug logs, etc. would
  // otherwise be swallowed by Ink's render loop.
  const renderOptions: {
    exitOnCtrlC: boolean;
    patchConsole: boolean;
    stdin?: ReadStream;
  } = {
    exitOnCtrlC: false,
    patchConsole: false,
  };
  if (freshStdin) {
    renderOptions.stdin = freshStdin;
  }
  // Enter the alternate screen buffer so the wizard occupies the full
  // terminal. On exit, Ink restores the original scrollback.
  process.stdout.write("\x1b[?1049h");
  try {
    const instance = ink.render(
      react.createElement(app.App, { store }),
      renderOptions
    );

    return new InkUI(instance, store, freshStdin);
  } catch (error) {
    // Restore the terminal if Ink rendering or UI init fails,
    // otherwise the user is stuck in the alternate screen buffer.
    process.stdout.write("\x1b[?1049l");
    throw error;
  }
}

/**
 * Subset of the Ink `Instance` type we actually use.
 *
 * Defined structurally rather than imported from `ink` so the
 * dynamic-import boundary in `createInkUI` doesn't leak Ink types
 * into the rest of the bridge module. `rerender` takes
 * `react.ReactNode` upstream; we widen it to a generic function
 * type and only ever call `unmount`/`waitUntilExit`/`clear` from
 * the bridge anyway.
 */
type InkInstance = {
  unmount: () => void;
  waitUntilExit: () => Promise<unknown>;
  // biome-ignore lint/suspicious/noExplicitAny: dynamic-import boundary
  rerender: (node: any) => void;
  /**
   * Clears Ink's last rendered output from the terminal. We call
   * this on dispose so the final post-dispose chalk summary is
   * the only thing left on screen — without it the bordered
   * wizard box stays above the summary, which looked redundant.
   */
  clear: () => void;
};

// ──────────────────────────── Implementation ──────────────────────────

/**
 * Bridge between the imperative `WizardUI` surface and the Ink
 * `App` component. Mutations land in the `WizardStore`; React
 * re-renders.
 */
export class InkUI implements WizardUI {
  private readonly instance: InkInstance;
  private readonly store: WizardStore;
  /**
   * Fresh `/dev/tty` stream Ink reads from. We own this — closing
   * it on dispose lets the libuv handle drain so `process.exit` (or
   * a natural exit) actually fires. `null` when `/dev/tty` couldn't
   * be opened (Windows, sandboxed environments) — Ink falls back to
   * `process.stdin` in that case.
   */
  private readonly freshStdin: ReadStream | null;
  private tipTimer: ReturnType<typeof setInterval> | undefined;
  private learnTimer: ReturnType<typeof setInterval> | undefined;

  private tipIndex = 0;
  private activePromptCancel: (() => void) | undefined;
  private cancelHandler: (() => void) | undefined;
  /**
   * Guard so `tearDown()` runs at most once even when called from
   * multiple paths (Ctrl+C in a spinner, then SIGINT, then
   * `[Symbol.asyncDispose]` on the wizard-runner exit). Calling
   * `unmount()` on an already-unmounted Ink instance throws on some
   * Ink versions; running raw-mode restoration on a destroyed stream
   * also throws. The flag short-circuits before either can happen.
   */
  private torndown = false;
  /**
   * Guard so `requestCancel()` runs its no-active-prompt branch at
   * most once. With this flag set, a subsequent Ctrl+C / SIGINT
   * becomes a no-op rather than re-entering teardown — the user is
   * already on the way out.
   */
  private cancelRequested = false;
  /**
   * Final wizard outcome captured by the bridge.
   *
   * Ink renders inline so the log lines naturally land in scrollback
   * — we don't need to replay a transcript on dispose. We do echo
   * a final success/failure summary line after `unmount()` so the
   * user has a clear "what happened" signal at the bottom of the
   * scrollback.
   */
  private outroMessage: string | undefined;
  private failureMessage: string | undefined;
  /**
   * Resolved when the user presses any key on the outro screen.
   * `[Symbol.asyncDispose]` awaits this so the `using` block keeps the
   * UI alive until the user has seen and acknowledged the final screen.
   */

  constructor(
    instance: InkInstance,
    store: WizardStore,
    freshStdin: ReadStream | null
  ) {
    this.instance = instance;
    this.store = store;
    this.freshStdin = freshStdin;
    this.startLearnSequence();
    this.installCancelHandler();
    // Hand the App a reference to `requestCancel` via the store so
    // the top-level `useInput` Ctrl+C catcher in `ink-app.tsx` can
    // route through the same teardown path as SIGINT and prompt
    // cancellation. Without this the App would have to call
    // `process.exit(130)` directly — bypassing termios restoration
    // and leaking the `/dev/tty` handle.
    this.store.setRequestCancel(() => this.requestCancel());
  }

  // ── Lifecycle ─────────────────────────────────────────────────────

  banner(_art: string): void {
    // No-op — the App paints the banner inside its header from the
    // gradient rows pre-loaded into the store. The runner-supplied
    // ANSI string is discarded.
  }

  intro(_title: string): void {
    // No-op. The outer box already has a title-bar feel via the
    // banner; an extra "▸ sentry init" line felt redundant.
  }

  outro(message: string): void {
    const clean = stripAnsi(message);
    this.appendLog("success", clean);
    this.outroMessage = clean;
  }

  cancel(message: string): void {
    const clean = stripAnsi(message);
    this.appendLog("error", clean);
    this.failureMessage = clean;
  }

  summary(summary: WizardSummary): void {
    this.store.setSummary(summary);
  }

  recordFilesReading(paths: string[]): void {
    this.store.recordFilesReading(paths);
  }

  markFilesAnalyzed(paths: string[]): void {
    this.store.markFilesAnalyzed(paths);
  }

  setStep(
    stepId: string,
    status: "in_progress" | "completed" | "failed" | "skipped"
  ): void {
    this.store.setStepStatus(stepId, status);
  }

  setOverlay(overlay: {
    kind: string;
    message: string;
    retryCount: number;
  }): void {
    this.store.setOverlay({
      kind: "health",
      message: overlay.message,
      retryCount: overlay.retryCount,
    });
  }

  clearOverlay(): void {
    this.store.clearOverlay();
  }

  // ── Logging ───────────────────────────────────────────────────────

  log: WizardLog = {
    info: (message) => this.appendLog("info", message),
    warn: (message) => this.appendLog("warn", message),
    error: (message) => this.appendLog("error", message),
    success: (message) => this.appendLog("success", message),
    message: (message) => this.appendLog("message", message),
  };

  // ── Spinner ───────────────────────────────────────────────────────

  spinner(): SpinnerHandle {
    return {
      start: (message?: string) => {
        const clean = stripAnsi(message ?? "");
        this.store.startSpinner(clean);
        if (clean) {
          this.store.appendStatus(clean);
        }
      },
      message: (message?: string) => {
        if (message !== undefined) {
          const clean = stripAnsi(message);
          this.store.setSpinnerMessage(clean);
          if (clean) {
            this.store.appendStatus(clean);
          }
        }
      },
      stop: (message?: string, code: SpinnerExitCode = 0) => {
        const finalMessage = message
          ? stripAnsi(message)
          : this.store.getSnapshot().spinner.message;
        this.store.stopSpinner();
        if (finalMessage) {
          this.appendLog(severityForStopCode(code), finalMessage);
        }
      },
    };
  }

  // ── Prompts ───────────────────────────────────────────────────────

  select<T extends string>(opts: SelectOptions<T>): Promise<T | Cancelled> {
    return new Promise((resolve) => {
      const initialIndex =
        opts.initialValue !== undefined
          ? Math.max(
              0,
              opts.options.findIndex(
                (option) => option.value === opts.initialValue
              )
            )
          : 0;
      this.activePromptCancel = () => {
        this.store.setPrompt(null);
        this.activePromptCancel = undefined;
        resolve(CANCELLED);
      };
      this.store.setPrompt({
        kind: "select",
        message: stripAnsi(opts.message),
        options: opts.options.map((option) => ({
          value: option.value,
          label: option.label,
          ...(option.hint ? { hint: option.hint } : {}),
        })),
        initialIndex,
        resolve: (value) => {
          this.store.setPrompt(null);
          this.activePromptCancel = undefined;
          if (value === null) {
            resolve(CANCELLED);
          } else {
            resolve(value as T);
          }
        },
      });
    });
  }

  multiselect<T extends string>(
    opts: MultiSelectOptions<T>
  ): Promise<T[] | Cancelled> {
    return new Promise((resolve) => {
      this.activePromptCancel = () => {
        this.store.setPrompt(null);
        this.activePromptCancel = undefined;
        resolve(CANCELLED);
      };
      this.store.setPrompt({
        kind: "multiselect",
        message: stripAnsi(opts.message),
        options: opts.options.map((option) => ({
          value: option.value,
          label: option.label,
          ...(option.hint ? { hint: option.hint } : {}),
        })),
        initialSelected: opts.initialValues ?? [],
        required: opts.required ?? false,
        resolve: (values) => {
          this.store.setPrompt(null);
          this.activePromptCancel = undefined;
          if (values === null) {
            resolve(CANCELLED);
          } else {
            resolve(values as T[]);
          }
        },
      });
    });
  }

  confirm(opts: ConfirmOptions): Promise<boolean | Cancelled> {
    return new Promise<boolean | Cancelled>((resolve) => {
      this.activePromptCancel = () => {
        this.store.setPrompt(null);
        this.activePromptCancel = undefined;
        resolve(CANCELLED);
      };
      this.store.setPrompt({
        kind: "confirm",
        message: stripAnsi(opts.message),
        initialValue: opts.initialValue ?? true,
        resolve: (value) => {
          this.store.setPrompt(null);
          this.activePromptCancel = undefined;
          if (value === null) {
            resolve(CANCELLED);
          } else {
            resolve(value);
          }
        },
      });
    });
  }

  // ── Disposal ──────────────────────────────────────────────────────

  [Symbol.asyncDispose](): Promise<void> {
    this.tearDown();
    return Promise.resolve();
  }

  /**
   * Idempotent teardown. Safe to call from `[Symbol.asyncDispose]`,
   * from `requestCancel()`, or from a SIGINT handler racing both. The
   * `torndown` guard short-circuits second (and later) entries so we
   * never call `unmount()` on an already-unmounted Ink instance or
   * `setRawMode(false)` on an already-destroyed stream — both throw
   * on some platforms.
   *
   * Order matters:
   *   1. Stop the tip-rotation interval (libuv timer ref).
   *   2. Detach SIGINT listener (we don't want a second Ctrl+C
   *      re-entering this path while we're in the middle of it).
   *   3. `instance.clear()` — rewinds Ink's render region so the
   *      post-dispose chalk summary lands in place of the live
   *      wizard chrome rather than below it.
   *   4. `instance.unmount()` — releases React reconciler resources.
   *   5. Restore termios on the fresh `/dev/tty` stream, then
   *      `pause()` + `destroy()` so libuv can drain the handle and
   *      the process can exit naturally.
   *   6. Emit the post-dispose summary to stdout (success outro or
   *      failure cancel line, matching the live screen's palette).
   *
   * Every step is wrapped in try/catch — disposal must never throw.
   */
  private tearDown(): void {
    if (this.torndown) {
      return;
    }
    this.torndown = true;
    if (this.tipTimer) {
      clearInterval(this.tipTimer);
      this.tipTimer = undefined;
    }
    this.stopLearnSequence();
    if (this.cancelHandler) {
      process.removeListener("SIGINT", this.cancelHandler);
      this.cancelHandler = undefined;
    }
    // Detach the cancel callback from the store so a stale Ctrl+C
    // routed through the App after teardown can't re-enter.
    this.store.setRequestCancel(undefined);
    try {
      this.instance.clear();
    } catch {
      // best-effort
    }
    try {
      this.instance.unmount();
    } catch {
      // best-effort
    }
    // Leave the alternate screen buffer so the user's original
    // scrollback is restored.
    try {
      process.stdout.write("\x1b[?1049l");
    } catch {
      // best-effort — stdout may already be destroyed
    }
    if (this.freshStdin) {
      try {
        this.freshStdin.setRawMode(false);
      } catch {
        // stream already torn down
      }
      try {
        this.freshStdin.pause();
        this.freshStdin.destroy();
      } catch {
        // stream already destroyed
      }
    }
    const report = this.buildPostDisposeReport();
    if (report) {
      // Write to stdout (not stderr) so the summary lands in the
      // same stream as the cleared Ink output. Mixing stderr in
      // would risk an extra line break or out-of-order interleave
      // depending on shell pipe handling.
      process.stdout.write(`${report}\n`);
    }
  }

  /**
   * Cooperative cancellation entry point. Called from three places:
   *
   *   1. The App's top-level `useInput` Ctrl+C catcher (when no
   *      prompt is mounted — typically during a spinner / network
   *      call). Routed via `store.requestCancel()`.
   *   2. The SIGINT process listener (covers raw-mode-off windows
   *      where Node delivers SIGINT instead of `\x03`).
   *   3. (Indirectly) prompt cancellation, when an active prompt's
   *      own `useInput` resolves with `null`. That path doesn't go
   *      through `requestCancel` directly because the prompt's
   *      promise resolution drives the wizard runner's
   *      `WizardCancelledError` flow, which then runs
   *      `[Symbol.asyncDispose]` → `tearDown()` naturally.
   *
   * If a prompt IS active, we delegate to its cancel callback and
   * return without exiting — the wizard runner will catch the
   * resulting `WizardCancelledError` and exit cleanly via the
   * `await using` path.
   *
   * If no prompt is active (spinner case), we tear down immediately
   * and `process.exit(130)`. We can't route through the runner
   * because it's blocked on `await executeTool(...)` or
   * `await run.resumeAsync(...)` — there's nothing waiting to throw
   * into. Exit code 130 is the SIGINT convention; the terminal is
   * fully restored before exit so the user's shell prompt comes
   * back cleanly.
   *
   * A second Ctrl+C while teardown is in progress force-exits via
   * `process.exit(130)` so the user is never trapped by a stuck
   * teardown.
   */
  requestCancel(): void {
    const promptCancel = this.activePromptCancel;
    if (promptCancel) {
      // Prompt path — let the runner unwind via WizardCancelledError.
      // Don't tear down here; the `await using` in the runner will
      // call us back through `[Symbol.asyncDispose]`.
      promptCancel();
      return;
    }
    if (this.cancelRequested) {
      // Safety valve: teardown already started but hasn't finished
      // (or something is stuck). Force-exit so the user isn't trapped.
      process.exit(130);
    }
    this.cancelRequested = true;
    this.failureMessage = "Setup cancelled.";
    this.tearDown();
    // Match the SIGINT convention so shells (and CI) see a
    // distinguishable exit. The runner's `await using` won't get a
    // chance to run after this, but tearDown above already did all
    // the cleanup that path would have performed.
    // Defer exit by one tick so the event loop can flush the
    // stdout writes from tearDown (alternate-screen escape +
    // cancellation report) before the process terminates.
    setImmediate(() => process.exit(130));
  }

  /**
   * Build a compact final summary echoed to stderr after Ink
   * unmounts. Ink's inline rendering means the run's log lines are
   * already in the user's scrollback; this report just emphasises
   * the outcome so it's the last thing on screen.
   *
   * Three shapes:
   *   - Success: outro line + summary fields + changed files.
   *   - Failure: cancel/error line on its own.
   *   - Empty:   no useful state captured (early abort, etc.) —
   *              return `undefined` and the caller skips the
   *              stderr write.
   *
   * Failure wins over success if both are set.
   */
  private buildPostDisposeReport(): string | undefined {
    if (this.failureMessage) {
      return formatFailureReport(
        this.failureMessage,
        this.store.getSnapshot().logs
      );
    }
    if (!this.outroMessage) {
      return;
    }
    const successIcon = chalk.hex(REPORT_SUCCESS)("✔");
    const lines: string[] = [
      "",
      `${successIcon}  ${chalk.bold(this.outroMessage)}`,
    ];
    const summary = this.store.getSnapshot().summary;
    if (summary && summary.fields.length > 0) {
      lines.push("");
      const labelWidth = Math.max(
        ...summary.fields.map((field) => field.label.length)
      );
      for (const field of summary.fields) {
        const label = chalk.hex(REPORT_MUTED)(field.label.padEnd(labelWidth));
        lines.push(`   ${label}  ${field.value}`);
      }
    }
    if (summary?.changedFiles && summary.changedFiles.length > 0) {
      lines.push("");
      lines.push(`   ${chalk.hex(REPORT_MUTED).bold("Changed files")}`);
      const tree = buildFileTree(summary.changedFiles);
      for (const row of flattenTree(tree)) {
        lines.push(formatTreeRowChalk(row));
      }
    }
    return lines.join("\n");
  }

  // ── Internal helpers ──────────────────────────────────────────────

  private appendLog(severity: LogSeverity, message: string): void {
    this.store.appendLog(severity, stripAnsi(message));
  }

  private startTipRotation(): void {
    if (this.tipTimer) {
      return;
    }
    this.tipTimer = setInterval(() => {
      this.tipIndex = (this.tipIndex + 1) % SENTRY_TIPS.length;
      this.store.setTipIndex(this.tipIndex);
    }, TIP_ROTATE_INTERVAL_MS);
  }

  private startLearnSequence(): void {
    const store = this.store;
    this.learnTimer = setInterval(() => {
      const { learnState } = store.getSnapshot();
      if (learnState.complete) {
        this.stopLearnSequence();
        this.startTipRotation();
        return;
      }
      const next = learnState.blockIndex + 1;
      if (next >= LEARN_SEQUENCE.length) {
        store.setLearnComplete();
        this.stopLearnSequence();
        this.startTipRotation();
      } else {
        store.advanceLearnBlock();
      }
    }, TIP_ROTATE_INTERVAL_MS);
  }

  private stopLearnSequence(): void {
    if (this.learnTimer) {
      clearInterval(this.learnTimer);
      this.learnTimer = undefined;
    }
  }

  /**
   * Fallback SIGINT handler for the (rare) windows where raw mode
   * is OFF and Node's terminal layer DOES deliver SIGINT for
   * Ctrl+C. The primary Ctrl+C handling lives inside Ink's
   * `useInput` (see `ink-app.tsx`'s top-level App component): in
   * raw mode, Node sends `\x03` as a byte instead of SIGINT.
   *
   * This handler covers the brief window between InkUI
   * construction and the first `useInput` listener being mounted,
   * plus any time raw mode flickers off (Ink toggles it in a
   * useEffect when the listener count drops to zero).
   *
   * Both this handler and the App's `useInput` Ctrl+C path funnel
   * into `requestCancel()` so the cancellation flow has a single
   * implementation. Uses `process.on` so the handler survives a
   * prompt-delegation Ctrl+C (where `requestCancel` returns early
   * without setting `cancelRequested`). If teardown is already in
   * progress, `requestCancel` force-exits — protects against a
   * stuck teardown holding the user hostage.
   */
  private installCancelHandler(): void {
    const handler = () => {
      this.requestCancel();
    };
    this.cancelHandler = handler;
    process.on("SIGINT", handler);
  }
}

/**
 * Colored glyph for a changed-files row in the post-dispose report.
 * The plain ASCII variant lives in `logging-ui.ts` for the
 * non-interactive CI path.
 */
function changedFileGlyphColored(action: string): string {
  if (action === "create") {
    return chalk.hex(REPORT_SUCCESS)("+");
  }
  if (action === "delete") {
    return chalk.hex(REPORT_ERROR)("−");
  }
  return chalk.hex(REPORT_WARN)("~");
}

/**
 * Render a single `FileTreeRow` for the post-dispose stderr report.
 * Directories show only the box-drawing branch + label; files add
 * the action glyph (colored).
 */
function formatTreeRowChalk(row: {
  prefix: string;
  branch: string;
  kind: "file" | "directory";
  label: string;
  action?: string;
}): string {
  const branch = chalk.hex(REPORT_MUTED)(`${row.prefix}${row.branch}`);
  if (row.kind === "directory") {
    return `     ${branch} ${row.label}`;
  }
  const glyph = changedFileGlyphColored(row.action ?? "modify");
  return `     ${branch} ${glyph} ${row.label}`;
}
