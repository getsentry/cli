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

import { stripAnsi } from "../../formatters/plain-detect.js";
import { WizardStore } from "./opentui-store.js";
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
 * Glyph map for transcript replay (post-dispose stderr write). Kept in
 * sync with the icons rendered in `opentui-app.tsx`.
 */
const TRANSCRIPT_GLYPHS = {
  info: "●",
  warn: "▲",
  error: "✖",
  success: "✔",
  message: " ",
} as const;

const TRANSCRIPT_STOP_GLYPHS: Record<SpinnerExitCode, string> = {
  0: "✔",
  1: "✖",
  2: "▲",
};

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
   * Append-only transcript of every log/intro/outro/cancel line and
   * the final summary. On dispose we replay it to stderr after the
   * renderer destroys the alternate screen, so users see the wizard's
   * output in their scrollback.
   */
  private readonly transcript: string[] = [];

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

  intro(title: string): void {
    const clean = stripAnsi(title);
    this.store.setIntro(clean);
    this.transcript.push(`▸ ${clean}`);
  }

  outro(message: string): void {
    this.appendLog("success", message);
  }

  cancel(message: string): void {
    this.appendLog("error", message);
  }

  summary(summary: WizardSummary): void {
    this.store.setSummary(summary);
    // Push a compact textual version onto the transcript so the
    // post-dispose stderr replay has something to show.
    this.transcript.push("");
    for (const field of summary.fields) {
      this.transcript.push(`  ${field.label}: ${field.value}`);
    }
    if (summary.changedFiles && summary.changedFiles.length > 0) {
      this.transcript.push("");
      this.transcript.push("  Changed files:");
      for (const file of summary.changedFiles) {
        const glyph = changedFileGlyph(file.action);
        this.transcript.push(`    ${glyph} ${file.path}`);
      }
    }
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
          const glyph = TRANSCRIPT_STOP_GLYPHS[code];
          // Map the spinner stop code back to a log severity for the
          // visible row. 0 = success, 1 = error, 2 = warn.
          const severity = severityForStopCode(code);
          this.appendLog(severity, finalMessage);
          // Override the transcript line with the stop glyph (which
          // visually matches the live spinner code (`appendLog` would
          // have used the severity-based glyph, which is the same in
          // practice but keeping the mapping explicit avoids a future
          // drift bug).
          this.transcript[this.transcript.length - 1] =
            `${glyph} ${finalMessage}`;
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
    if (this.transcript.length > 0) {
      process.stderr.write(`${this.transcript.join("\n")}\n`);
    }
    return Promise.resolve();
  }

  // ── Internal helpers ──────────────────────────────────────────────

  private appendLog(
    severity: keyof typeof TRANSCRIPT_GLYPHS,
    message: string
  ): void {
    const clean = stripAnsi(message);
    this.store.appendLog(severity, clean);
    const glyph = TRANSCRIPT_GLYPHS[severity];
    this.transcript.push(`${glyph} ${clean}`);
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
 * Map a spinner stop code back to the matching log severity.
 * Stop code 0 → success, 1 → error, 2 → warn.
 */
function severityForStopCode(
  code: SpinnerExitCode
): keyof typeof TRANSCRIPT_GLYPHS {
  if (code === 1) {
    return "error";
  }
  if (code === 2) {
    return "warn";
  }
  return "success";
}

function changedFileGlyph(action: string): string {
  if (action === "create") {
    return "+";
  }
  if (action === "delete") {
    return "−";
  }
  return "~";
}
