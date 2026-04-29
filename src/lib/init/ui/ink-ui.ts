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
 *   - **Runs on Node.** OpenTUI's renderer is Zig-compiled and only
 *     loadable from Bun's `bun:ffi`. The npm/Node distribution of
 *     the CLI couldn't use it, so half the user base got a
 *     plain-text fallback. Ink is pure JS + React, so this same
 *     UI runs everywhere the CLI does.
 *   - **No native binary cost.** The OpenTUI implementation added
 *     ~10.7 MB to the compiled Bun binary (the `libopentui.so`
 *     plus the ~12k-line generated FFI bindings). Ink + companions
 *     add ~1–2 MB and are pure JS, so they bundle cleanly.
 *   - **Inline rendering.** Ink writes incrementally to stdout, so
 *     log lines naturally end up in the user's scrollback. OpenTUI
 *     needed an alternate-screen buffer + a post-dispose stderr
 *     replay to leave any trace of the run behind.
 *
 * **Lazy import.** `ink`, `ink-spinner`, `ink-select-input`, and
 * `react` are all dynamically imported by `createInkUI()` so the
 * npm bundle (which excludes them from the bundle graph) never sees
 * the imports at module-load time. This keeps the `LoggingUI` path
 * cheap to instantiate when interactive UI is not needed.
 */

import chalk from "chalk";
import { stripAnsi } from "../../formatters/plain-detect.js";
import { buildFileTree, flattenTree } from "./file-tree.js";
import { SENTRY_TIPS } from "./sentry-tips.js";
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
const REPORT_MUTED = "#6E6C7E";
const REPORT_SUCCESS = "#86EFAC";
const REPORT_ERROR = "#F87171";
const REPORT_WARN = "#FBBF24";

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

  // Ink's render returns a handle with `unmount()` and
  // `waitUntilExit()`. We don't await `waitUntilExit` here because
  // the wizard drives lifecycle imperatively from the runner; the
  // dispose path calls `unmount()` directly when the workflow
  // finishes (success or failure).
  //
  // `exitOnCtrlC: false` lets us route Ctrl+C through the prompt
  // cancellation path (`installCancelHandler`) instead of yanking
  // the process down mid-spinner.
  //
  // `patchConsole: false` keeps `console.*` calls flowing to the
  // real stdout — Sentry SDK breadcrumbs, debug logs, etc. would
  // otherwise be swallowed by Ink's render loop.
  const instance = ink.render(react.createElement(app.App, { store }), {
    exitOnCtrlC: false,
    patchConsole: false,
  });

  return new InkUI(instance, store);
}

/**
 * Subset of the Ink `Instance` type we actually use.
 *
 * Defined structurally rather than imported from `ink` so the
 * dynamic-import boundary in `createInkUI` doesn't leak Ink types
 * into the rest of the bridge module. `rerender` takes
 * `react.ReactNode` upstream; we widen it to a generic function
 * type and only ever call `unmount`/`waitUntilExit` from the bridge
 * anyway.
 */
type InkInstance = {
  unmount: () => void;
  waitUntilExit: () => Promise<unknown>;
  // biome-ignore lint/suspicious/noExplicitAny: dynamic-import boundary
  rerender: (node: any) => void;
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
  private tipTimer: ReturnType<typeof setInterval> | undefined;
  private tipIndex = 0;
  private activePromptCancel: (() => void) | undefined;
  private cancelHandler: (() => void) | undefined;
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

  constructor(instance: InkInstance, store: WizardStore) {
    this.instance = instance;
    this.store = store;
    this.startTipRotation();
    this.installCancelHandler();
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
      },
      message: (message?: string) => {
        if (message !== undefined) {
          this.store.setSpinnerMessage(stripAnsi(message));
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

  async confirm(opts: ConfirmOptions): Promise<boolean | Cancelled> {
    const result = await this.select<"yes" | "no">({
      message: opts.message,
      options: [
        { value: "yes", label: "Yes" },
        { value: "no", label: "No" },
      ],
      initialValue: (opts.initialValue ?? true) ? "yes" : "no",
    });
    if (result === CANCELLED) {
      return CANCELLED;
    }
    return result === "yes";
  }

  // ── Disposal ──────────────────────────────────────────────────────

  [Symbol.asyncDispose](): Promise<void> {
    if (this.tipTimer) {
      clearInterval(this.tipTimer);
      this.tipTimer = undefined;
    }
    if (this.cancelHandler) {
      process.removeListener("SIGINT", this.cancelHandler);
      this.cancelHandler = undefined;
    }
    try {
      this.instance.unmount();
    } catch {
      // Ignore — disposal must never throw.
    }
    const report = this.buildPostDisposeReport();
    if (report) {
      process.stderr.write(`${report}\n`);
    }
    return Promise.resolve();
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
      const icon = chalk.hex(REPORT_ERROR)("✖");
      return `\n${icon}  ${chalk.hex(REPORT_ERROR).bold(this.failureMessage)}`;
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

  /**
   * Wire the global Ctrl+C / Escape handler. Cooperative
   * cancellation — resolve the active prompt with `CANCELLED`
   * rather than yanking the process down, so `wizard-runner.ts`
   * can drive its normal cleanup path (telemetry, exit code, etc.).
   *
   * Ink's `useInput` only fires inside a focused component; we want
   * cancellation to work even when no prompt is mounted (e.g.
   * during a spinner). Hook into the process-level SIGINT instead
   * — `exitOnCtrlC: false` on the render call ensures Ink doesn't
   * intercept first.
   */
  private installCancelHandler(): void {
    const handler = () => {
      const cancelFn = this.activePromptCancel;
      if (cancelFn) {
        cancelFn();
        return;
      }
      // No active prompt — surface a clean cancel message so the
      // wizard runner's catch-WizardCancelledError path triggers.
      // We don't `process.exit` here; the caller decides.
      this.failureMessage = "Setup cancelled.";
      this.instance.unmount();
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
