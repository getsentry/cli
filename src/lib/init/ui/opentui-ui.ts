/**
 * OpenTuiUI — React-based full-screen `WizardUI` implementation.
 *
 * The class itself is a thin bridge between the imperative `WizardUI`
 * surface (which the wizard runner calls into) and a React tree
 * mounted via `@opentui/react`'s `createRoot`. State lives in a
 * `WizardStore` (see `opentui-store.ts`) that React subscribes to via
 * `useSyncExternalStore`. Each method on this class translates a
 * single imperative call into one or more store mutations; React
 * re-renders.
 *
 * Why React rather than imperative Renderable mutation?
 *
 *   - Multi-select with toggle state was racy under direct
 *     `SelectRenderable.setOptions()` calls — keystrokes could land
 *     between the toggle and the redraw, leaving the visible markers
 *     out of sync with the internal set.
 *   - The Sentry-tips sidebar rotates on a timer; React's prop diff
 *     handles the swap with no manual `text.content =` plumbing.
 *   - The completion summary uses structured data (key/value rows,
 *     changed-files list) rather than pre-rendered markdown, which
 *     OpenTUI's TextRenderable can't display correctly. React's
 *     declarative composition is the natural way to lay it out.
 *
 * **Bun-only.** OpenTUI's native bindings ship as Zig — they don't run
 * on the npm/Node distribution. The factory in `factory.ts` only
 * routes here when running inside the Bun-compiled binary.
 *
 * **Lazy import.** `@opentui/core`, `@opentui/react`, and `react` are
 * all dynamically imported by `createOpenTuiUI()` so the npm bundle
 * (which excludes them from the bundle graph) never sees the imports
 * at module-load time.
 */

import chalk from "chalk";
import { stripAnsi } from "../../formatters/plain-detect.js";
import { buildFileTree, flattenTree } from "./file-tree.js";
import { WizardStore } from "./opentui-store.js";
import { SENTRY_TIPS } from "./sentry-tips.js";

// Brand palette mirrored from `opentui-app.tsx` — kept in sync so the
// post-dispose stderr report (rendered via chalk, not OpenTUI) feels
// like a continuation of the wizard's live screen rather than a
// separate, plainer surface.
const REPORT_MUTED = "#6E6C7E";
const REPORT_SUCCESS = "#86EFAC";
const REPORT_ERROR = "#F87171";
const REPORT_WARN = "#FBBF24";

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

/** Spinner cadence — matches `LoggingUI`/legacy spinner cadence. */
const SPINNER_INTERVAL_MS = process.platform.startsWith("win") ? 80 : 120;

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
 * Log severities recognised by the OpenTUI UI. Kept narrowly typed so
 * callers can't pass arbitrary strings into `appendLog`. Mirrors the
 * keys of `ICON_BY_SEVERITY` in `opentui-app.tsx`.
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
 * Async factory for `OpenTuiUI`. Imports `@opentui/core`,
 * `@opentui/react`, `react`, and the local `App` component lazily,
 * mounts the React tree, and returns the bridge instance. Throws if
 * any of the native bindings are missing (e.g. accidentally invoked
 * from Node).
 */
export async function createOpenTuiUI(): Promise<OpenTuiUI> {
  // Serialize the imports — `@opentui/react` re-exports core
  // primitives via its own bundle and the parallel-import path
  // tripped a TDZ error inside their `chunk-*.js` because the
  // re-export landed before core's class declarations.
  const core = await import("@opentui/core");
  const reactBindings = await import("@opentui/react");
  const react = await import("react");
  const app = await import("./opentui-app.js");

  const renderer = await core.createCliRenderer({
    exitOnCtrlC: false,
    screenMode: "alternate-screen",
  });

  const store = new WizardStore({
    bannerRows: BANNER_ROWS.map((content, i) => ({
      content,
      color: BANNER_GRADIENT[i] ?? BANNER_GRADIENT[0] ?? "#FFFFFF",
    })),
  });

  const root = reactBindings.createRoot(renderer);
  // `react.createElement` is the typed JSX factory; we cast the App
  // component reference so TypeScript accepts the `{ store }` props
  // bag without dragging the React types into the bridge module.
  root.render(react.createElement(app.App, { store }));

  // Cast the root to our local `RenderRoot` shape. The shape matches
  // structurally (`render(node)` + `unmount()`); the cast just opts
  // out of React's stricter `ReactNode` parameter to keep the
  // imperative bridge free of React types.
  return new OpenTuiUI(renderer, root as unknown as RenderRoot, store);
}

// Locally-scoped type aliases for the bridge — these all come from
// dynamic imports so we keep them as `unknown`-ish constraints rather
// than depending on the upstream packages' types directly.
type RenderRoot = {
  render: (node: unknown) => void;
  unmount: () => void;
};

// ──────────────────────────── Implementation ──────────────────────────

/**
 * Bridge between the imperative `WizardUI` surface and the React
 * `App` component. Mutations land in the `WizardStore`; React
 * re-renders.
 */
export class OpenTuiUI implements WizardUI {
  // biome-ignore lint/suspicious/noExplicitAny: dynamic-import boundary
  private readonly renderer: any;
  private readonly root: RenderRoot;
  private readonly store: WizardStore;
  private spinnerTimer: ReturnType<typeof setInterval> | undefined;
  private tipTimer: ReturnType<typeof setInterval> | undefined;
  private tipIndex = 0;
  private activePromptCancel: (() => void) | undefined;
  /**
   * Final wizard outcome captured by the bridge.
   *
   * The OpenTUI alternate-screen buffer is wiped the moment
   * `renderer.destroy()` runs, so anything we want the user to see in
   * their scrollback has to be re-emitted to stderr after destroy.
   * Earlier versions replayed every log/intro/outro line — that
   * produced a noisy wall of `▸ sentry init`, `● This wizard uses
   * AI…`, and intermediate spinner stops. We now keep just enough
   * state to print a focused completion report:
   *
   *   - `outroMessage` — the success line (set by `outro()`).
   *   - `failureMessage` — the error/cancel line (set by `cancel()`
   *     or by `log.error()` for a fatal abort).
   *   - The store's `summary` snapshot — already structured.
   *
   * Whichever pair is populated wins on dispose. If neither is set
   * (e.g. early abort before any outcome was recorded) we print
   * nothing, matching the previous "no transcript" behavior.
   */
  private outroMessage: string | undefined;
  private failureMessage: string | undefined;

  constructor(
    // biome-ignore lint/suspicious/noExplicitAny: dynamic-import boundary
    renderer: any,
    root: RenderRoot,
    store: WizardStore
  ) {
    this.renderer = renderer;
    this.root = root;
    this.store = store;
    this.startTipRotation();
    this.installCancelHandler();
  }

  // ── Lifecycle ─────────────────────────────────────────────────────

  banner(_art: string): void {
    // No-op — `App` paints the banner inside its alternate-screen
    // header from the gradient rows pre-loaded into the store. The
    // runner-supplied ANSI string is discarded (OpenTUI can't render
    // embedded escape codes).
  }

  intro(_title: string): void {
    // No-op. The box's top-border title and the gradient banner
    // already announce the wizard; an extra "▸ sentry init" line
    // underneath felt redundant in user feedback. We keep the method
    // on the interface for parity with `LoggingUI`, where the
    // command-line shell makes a separate intro line useful.
  }

  outro(message: string): void {
    // Show the success line live in the log pane, and remember it for
    // the post-dispose scrollback report.
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
        if (!this.spinnerTimer) {
          this.spinnerTimer = setInterval(() => {
            this.store.tickSpinner();
          }, SPINNER_INTERVAL_MS);
        }
      },
      message: (message?: string) => {
        if (message !== undefined) {
          this.store.setSpinnerMessage(stripAnsi(message));
        }
      },
      stop: (message?: string, code: SpinnerExitCode = 0) => {
        if (this.spinnerTimer) {
          clearInterval(this.spinnerTimer);
          this.spinnerTimer = undefined;
        }
        const finalMessage = message
          ? stripAnsi(message)
          : this.store.getSnapshot().spinner.message;
        this.store.stopSpinner();
        // Promote the spinner's final state into the log pane so it
        // survives subsequent `start()` calls.
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
    if (this.spinnerTimer) {
      clearInterval(this.spinnerTimer);
      this.spinnerTimer = undefined;
    }
    if (this.tipTimer) {
      clearInterval(this.tipTimer);
      this.tipTimer = undefined;
    }
    try {
      this.root.unmount();
    } catch {
      // Ignore — disposal must never throw.
    }
    try {
      this.renderer.destroy();
    } catch {
      // Ignore.
    }
    const report = this.buildPostDisposeReport();
    if (report) {
      process.stderr.write(`${report}\n`);
    }
    return Promise.resolve();
  }

  /**
   * Build the compact scrollback report shown after `destroy()` wipes
   * the alternate screen. Three shapes:
   *
   *   - Success: outro line + summary fields + changed files.
   *   - Failure: cancel/error line on its own.
   *   - Empty:   no useful state captured (early abort, etc.) — return
   *              `undefined` and the caller skips the stderr write.
   *
   * Failure wins over success if both are set (e.g. error mid-run
   * after a partial summary was emitted).
   *
   * The report is colored via chalk (not OpenTUI) — by the time it
   * runs, `renderer.destroy()` has already restored the main screen
   * and chalk's TTY detection picks up where it left off. Keeping
   * the palette aligned with the live UI's brand colors makes the
   * scrollback handoff feel intentional.
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
   * Wire the global Ctrl+C / Escape handler. Cooperative cancellation
   * — resolve the active prompt with `CANCELLED` rather than yanking
   * the process down, so `wizard-runner.ts` can drive its normal
   * cleanup path (telemetry, exit code, etc.).
   */
  private installCancelHandler(): void {
    this.renderer.keyInput.on(
      "keypress",
      (event: { name: string; ctrl?: boolean }) => {
        const isCancel =
          (event.ctrl && event.name === "c") || event.name === "escape";
        if (!isCancel) {
          return;
        }
        const cancelFn = this.activePromptCancel;
        if (cancelFn) {
          cancelFn();
        }
      }
    );
  }
}

/**
 * Colored glyph for a changed-files row in the post-dispose report.
 * The plain ASCII variant lives in `logging-ui.ts` for the
 * non-interactive CI path. We keep both copies (vs. extracting a
 * shared module) because each impl wants different rendering — chalk
 * here, raw text there — and the helpers are tiny.
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
