/**
 * OpenTuiUI — full-screen `WizardUI` implementation built on
 * `@opentui/core`.
 *
 * The renderer takes over the terminal in alternate-screen mode for the
 * duration of the run, restoring the main screen on dispose.
 *
 * Visual layout:
 *
 *   ╔══════════════════════════════════════════════════════════════╗
 *   ║  ███████╗███████╗███╗   ██╗████████╗██████╗ ██╗   ██╗        ║  banner
 *   ║  ██╔════╝██╔════╝████╗  ██║╚══██╔══╝██╔══██╗╚██╗ ██╔╝        ║  (gradient,
 *   ║  ███████╗█████╗  ██╔██╗ ██║   ██║   ██████╔╝ ╚████╔╝         ║   one Text
 *   ║  ╚════██║██╔══╝  ██║╚██╗██║   ██║   ██╔══██╗  ╚██╔╝          ║   per row)
 *   ║  ███████║███████╗██║ ╚████║   ██║   ██║  ██║   ██║           ║
 *   ║  ╚══════╝╚══════╝╚═╝  ╚═══╝   ╚═╝   ╚═╝  ╚═╝   ╚═╝           ║
 *   ║                                                              ║
 *   ║  ▸ sentry init                                               ║  intro
 *   ╠══════════════════════════════════════════════════════════════╣
 *   ║                                                              ║
 *   ║  ●  Auto-confirmed: continuing                               ║  log pane
 *   ║  ●  Detected platform: javascript-react                      ║  (icon-prefixed,
 *   ║  ▲  Source maps not configured                               ║   colored)
 *   ║                                                              ║
 *   ║  ◒  Installing dependencies…                                 ║  spinner
 *   ║                                                              ║
 *   ║  Which organization should the project be created in?        ║  prompt area
 *   ║   ▸ acme                                                     ║  (transient)
 *   ║     beta                                                     ║
 *   ╚══════════════════════════════════════════════════════════════╝
 *
 * ## Implementation notes
 *
 * **Renderable classes, not VNode factories.** `Box()`/`Text()`/`Select()`
 * factories return `ProxiedVNode`s that queue mutations into a
 * `__pendingCalls` array; those calls only flush at instantiation time.
 * Mutating a stored VNode reference after first render is a no-op. We
 * use `BoxRenderable` / `TextRenderable` / `SelectRenderable`
 * constructors directly so we have live instances we can mutate in
 * place for spinner ticks, log appends, prompt mount/unmount.
 *
 * **No ANSI in `content`.** OpenTUI's `TextRenderable` treats its
 * `content` string as opaque text — embedded ANSI escape sequences are
 * drawn as literal characters, producing the "jagged" look. We strip
 * ANSI from incoming messages and apply colors via the `fg` prop on
 * separate `TextRenderable`s (one per styled span when needed).
 *
 * **Bun-only.** OpenTUI's native bindings ship as Zig — they don't run
 * on the npm/Node distribution. The factory in `factory.ts` only routes
 * here when running inside the Bun-compiled binary.
 *
 * **Lazy import.** The `@opentui/core` import is dynamic so the npm
 * bundle (which excludes `@opentui/core` from the bundle graph)
 * doesn't see the import at module-load time.
 */

import type {
  BoxRenderable as BoxRenderableType,
  CliRenderer,
  SelectOption as OpenTuiSelectOption,
  SelectRenderable as SelectRenderableType,
  TextRenderable as TextRenderableType,
} from "@opentui/core";
import { stripAnsi } from "../../formatters/plain-detect.js";
import {
  CANCELLED,
  type Cancelled,
  type ConfirmOptions,
  type MultiSelectOptions,
  type SelectOption,
  type SelectOptions,
  type SpinnerExitCode,
  type SpinnerHandle,
  type WizardLog,
  type WizardUI,
} from "./types.js";

// ──────────────────────────── Visual constants ────────────────────────

/** Sentry brand purple (used for spinner and accent text). */
const ACCENT = "#A77DC3";
/** Muted gray for the chrome border and dim secondary text. */
const MUTED = "#6E6C7E";
/** Bright text on dark background. */
const FOREGROUND = "#E8E6F0";

const COLOR_INFO = "#7DD3FC"; // light blue
const COLOR_WARN = "#FBBF24"; // amber
const COLOR_ERROR = "#F87171"; // soft red
const COLOR_SUCCESS = "#86EFAC"; // mint green
const COLOR_DIM = MUTED;

/** Sentry banner ASCII rows (kept in sync with `src/lib/banner.ts`). */
const BANNER_ROWS = [
  "  ███████╗███████╗███╗   ██╗████████╗██████╗ ██╗   ██╗",
  "  ██╔════╝██╔════╝████╗  ██║╚══██╔══╝██╔══██╗╚██╗ ██╔╝",
  "  ███████╗█████╗  ██╔██╗ ██║   ██║   ██████╔╝ ╚████╔╝ ",
  "  ╚════██║██╔══╝  ██║╚██╗██║   ██║   ██╔══██╗  ╚██╔╝  ",
  "  ███████║███████╗██║ ╚████║   ██║   ██║  ██║   ██║   ",
  "  ╚══════╝╚══════╝╚═╝  ╚═══╝   ╚═╝   ╚═╝  ╚═╝   ╚═╝   ",
];

/** Vertical purple gradient applied row-by-row to the banner. */
const BANNER_GRADIENT = [
  "#B4A4DE",
  "#9C84D4",
  "#8468C8",
  "#6C4EBA",
  "#5538A8",
  "#432B8A",
];

/** Spinner frames; matches `src/lib/init/spinner.ts` cadence. */
const SPINNER_FRAMES = process.platform.startsWith("win")
  ? ["●", "o", "O", "0"]
  : ["◒", "◐", "◓", "◑"];
const SPINNER_INTERVAL_MS = process.platform.startsWith("win") ? 80 : 120;

/** Glyph + color for each log severity. */
const LOG_STYLES: Record<keyof WizardLog, { icon: string; color: string }> = {
  info: { icon: "●", color: COLOR_INFO },
  warn: { icon: "▲", color: COLOR_WARN },
  error: { icon: "✖", color: COLOR_ERROR },
  success: { icon: "✔", color: COLOR_SUCCESS },
  message: { icon: " ", color: FOREGROUND },
};

/** Spinner stop icons + colors. Stays consistent with the live frames. */
const STOP_STYLES: Record<SpinnerExitCode, { icon: string; color: string }> = {
  0: { icon: "✔", color: COLOR_SUCCESS },
  1: { icon: "✖", color: COLOR_ERROR },
  2: { icon: "▲", color: COLOR_WARN },
};

// ───────────────────────────── Type plumbing ──────────────────────────

/**
 * OpenTUI Renderable classes used by this module. Resolved once via
 * dynamic import in `createOpenTuiUI()` so the `@opentui/core` import
 * never runs synchronously at module-load time on the npm/Node
 * distribution.
 */
type OpenTuiClasses = {
  createCliRenderer: (config?: unknown) => Promise<CliRenderer>;
  BoxRenderable: new (
    ctx: unknown,
    options: Record<string, unknown>
  ) => BoxRenderableType;
  TextRenderable: new (
    ctx: unknown,
    options: Record<string, unknown>
  ) => TextRenderableType;
  SelectRenderable: new (
    ctx: unknown,
    options: Record<string, unknown>
  ) => SelectRenderableType;
};

/**
 * Async factory for `OpenTuiUI`. Imports `@opentui/core` lazily and
 * constructs the renderer + initial layout. Throws if the native
 * bindings are missing (e.g. accidentally invoked from Node).
 */
export async function createOpenTuiUI(): Promise<OpenTuiUI> {
  const mod = (await import("@opentui/core")) as unknown as OpenTuiClasses;
  const renderer = await mod.createCliRenderer({
    exitOnCtrlC: false,
    screenMode: "alternate-screen",
  });
  return new OpenTuiUI(renderer, mod);
}

// ──────────────────────────── Implementation ──────────────────────────

/**
 * Full-screen WizardUI. See module doc for layout and lifecycle.
 *
 * Construction is via `createOpenTuiUI()` — the constructor is
 * intentionally public to keep the type surface small but should not
 * be called directly by feature code.
 */
export class OpenTuiUI implements WizardUI {
  private readonly renderer: CliRenderer;
  private readonly classes: OpenTuiClasses;
  private readonly headerBox: BoxRenderableType;
  private readonly headerIntro: TextRenderableType;
  private readonly logPane: BoxRenderableType;
  private readonly spinnerWrap: BoxRenderableType;
  private readonly spinnerIcon: TextRenderableType;
  private readonly spinnerText: TextRenderableType;
  private readonly promptArea: BoxRenderableType;
  private spinnerActive = false;
  private spinnerTimer: ReturnType<typeof setInterval> | undefined;
  private spinnerFrame = 0;
  private spinnerMessage = "";
  /**
   * Resolver for the currently-active prompt (if any). Set when a
   * prompt mounts; cleared when it resolves or is cancelled. We track
   * a single "active prompt" because the wizard never nests prompts.
   */
  private activePromptResolver: ((value: unknown) => void) | undefined;
  private cancelHandlerInstalled = false;
  /**
   * Append-only transcript of every log/intro/outro/cancel line. On
   * dispose we write these to stderr after destroying the renderer
   * (which restores the main screen) so the user actually sees the
   * wizard's output in their scrollback.
   */
  private readonly transcript: string[] = [];

  constructor(renderer: CliRenderer, classes: OpenTuiClasses) {
    this.renderer = renderer;
    this.classes = classes;
    const ctx = renderer.root.ctx;
    const { BoxRenderable, TextRenderable } = classes;

    // Outer chrome — single rounded border around the whole wizard area
    // so the alternate-screen takeover feels intentional rather than
    // raw text floating on a void.
    const root = new BoxRenderable(ctx, {
      flexDirection: "column",
      flexGrow: 1,
      borderStyle: "rounded",
      border: true,
      borderColor: MUTED,
      padding: 1,
    });

    // Header: banner (one Text per row, gradient-colored) + an intro line
    // that the runner fills in via `intro()`.
    this.headerBox = new BoxRenderable(ctx, {
      flexDirection: "column",
      flexShrink: 0,
    });
    for (const [i, row] of BANNER_ROWS.entries()) {
      const bannerLine = new TextRenderable(ctx, {
        content: row,
        fg: BANNER_GRADIENT[i] ?? BANNER_GRADIENT[0],
      });
      this.headerBox.add(bannerLine);
    }
    this.headerIntro = new TextRenderable(ctx, {
      content: "",
      fg: ACCENT,
      marginTop: 1,
    });
    this.headerBox.add(this.headerIntro);

    // A muted divider line between the header and the live area below.
    // OpenTUI doesn't ship a horizontal-rule renderable, so we settle
    // for a thin Box with a top border.
    const divider = new BoxRenderable(ctx, {
      borderStyle: "single",
      border: ["top"],
      borderColor: MUTED,
      height: 1,
      flexShrink: 0,
      marginTop: 1,
      marginBottom: 1,
    });

    // Log pane: scrolling-feeling area where every appended line lands.
    // `flexGrow: 1` lets it absorb leftover vertical space.
    this.logPane = new BoxRenderable(ctx, {
      flexDirection: "column",
      flexGrow: 1,
      gap: 0,
    });

    // Spinner row: icon (gets recolored on stop) and message side-by-side
    // so the message can word-wrap independently of the icon.
    this.spinnerWrap = new BoxRenderable(ctx, {
      flexDirection: "row",
      flexShrink: 0,
      marginTop: 1,
    });
    this.spinnerIcon = new TextRenderable(ctx, {
      content: "",
      fg: ACCENT,
      width: 3,
    });
    this.spinnerText = new TextRenderable(ctx, {
      content: "",
      fg: FOREGROUND,
      flexGrow: 1,
    });
    this.spinnerWrap.add(this.spinnerIcon);
    this.spinnerWrap.add(this.spinnerText);

    // Prompt area: prompts mount their own message + Select in here and
    // tear it down on resolution.
    this.promptArea = new BoxRenderable(ctx, {
      flexDirection: "column",
      flexShrink: 0,
      marginTop: 1,
    });

    root.add(this.headerBox);
    root.add(divider);
    root.add(this.logPane);
    root.add(this.spinnerWrap);
    root.add(this.promptArea);
    renderer.root.add(root);

    this.installCancelHandler();
  }

  // ── Lifecycle ─────────────────────────────────────────────────────

  banner(_art: string): void {
    // No-op — the alternate-screen header already paints the banner
    // with the proper gradient. The runner-supplied ANSI string is
    // discarded because OpenTUI can't render embedded escape codes.
  }

  intro(title: string): void {
    const clean = stripAnsi(title);
    this.headerIntro.content = `▸ ${clean}`;
    this.transcript.push(`▸ ${clean}`);
  }

  outro(message: string): void {
    this.appendLine("success", message);
  }

  cancel(message: string): void {
    this.appendLine("error", message);
  }

  // ── Logging ───────────────────────────────────────────────────────

  log: WizardLog = {
    info: (message) => this.appendLine("info", message),
    warn: (message) => this.appendLine("warn", message),
    error: (message) => this.appendLine("error", message),
    success: (message) => this.appendLine("success", message),
    message: (message) => this.appendLine("message", message),
  };

  // ── Spinner ───────────────────────────────────────────────────────

  spinner(): SpinnerHandle {
    return {
      start: (message?: string) => {
        this.spinnerActive = true;
        this.spinnerFrame = 0;
        this.spinnerMessage = stripAnsi(message ?? "");
        this.spinnerIcon.fg = ACCENT;
        this.renderSpinnerFrame();
        if (!this.spinnerTimer) {
          this.spinnerTimer = setInterval(() => {
            this.spinnerFrame = (this.spinnerFrame + 1) % SPINNER_FRAMES.length;
            this.renderSpinnerFrame();
          }, SPINNER_INTERVAL_MS);
        }
      },
      message: (message?: string) => {
        if (this.spinnerActive && message !== undefined) {
          this.spinnerMessage = stripAnsi(message);
          this.renderSpinnerFrame();
        }
      },
      stop: (message?: string, code: SpinnerExitCode = 0) => {
        if (!this.spinnerActive) {
          return;
        }
        this.spinnerActive = false;
        if (this.spinnerTimer) {
          clearInterval(this.spinnerTimer);
          this.spinnerTimer = undefined;
        }
        const finalMessage = message ? stripAnsi(message) : this.spinnerMessage;
        // Promote the spinner's final state into the scrollable log so
        // it survives the next `start()` call, then clear the live row.
        if (finalMessage) {
          const style = STOP_STYLES[code];
          this.appendStyledLine(style.icon, style.color, finalMessage);
        }
        this.spinnerIcon.content = "";
        this.spinnerText.content = "";
        this.spinnerMessage = "";
      },
    };
  }

  // ── Prompts ───────────────────────────────────────────────────────

  select<T extends string>(opts: SelectOptions<T>): Promise<T | Cancelled> {
    return this.runSelectPrompt({
      message: opts.message,
      options: opts.options,
      initialValue: opts.initialValue,
    });
  }

  multiselect<T extends string>(
    opts: MultiSelectOptions<T>
  ): Promise<T[] | Cancelled> {
    // Multi-select is built on top of `Select` with augmented labels
    // ("[x] foo" vs "[ ] foo") and custom keypress handling: space
    // toggles, enter confirms. OpenTUI doesn't ship a multi-select
    // renderable so we do this in userland.
    return this.runMultiSelectPrompt({
      message: opts.message,
      options: opts.options,
      initial: new Set(opts.initialValues ?? []),
      required: opts.required ?? false,
    });
  }

  async confirm(opts: ConfirmOptions): Promise<boolean | Cancelled> {
    const result = await this.runSelectPrompt<"yes" | "no">({
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
    // `destroy()` switches the terminal back from the alternate screen
    // to the main screen, which wipes everything OpenTUI rendered.
    // Replay the transcript to stderr so the wizard's intro/log lines
    // appear in the user's scrollback after exit.
    try {
      this.renderer.destroy();
    } catch {
      // Ignore — disposal must never throw.
    }
    if (this.transcript.length > 0) {
      process.stderr.write(`${this.transcript.join("\n")}\n`);
    }
    return Promise.resolve();
  }

  // ── Internal helpers ──────────────────────────────────────────────

  /**
   * Append a single styled log line — a row Box with a colored icon
   * cell on the left and the message text on the right. Each line
   * also gets pushed onto the transcript (sans color codes — they
   * wouldn't survive the scrollback handoff anyway).
   */
  private appendLine(severity: keyof WizardLog, message: string): void {
    const { icon, color } = LOG_STYLES[severity];
    const clean = stripAnsi(message);
    this.appendStyledLine(icon, color, clean);
  }

  private appendStyledLine(icon: string, color: string, text: string): void {
    const { BoxRenderable, TextRenderable } = this.classes;
    const ctx = this.renderer.root.ctx;
    const row = new BoxRenderable(ctx, {
      flexDirection: "row",
      flexShrink: 0,
    });
    const iconCell = new TextRenderable(ctx, {
      content: icon,
      fg: color,
      width: 3,
    });
    const textCell = new TextRenderable(ctx, {
      content: text,
      fg: FOREGROUND,
      flexGrow: 1,
    });
    row.add(iconCell);
    row.add(textCell);
    this.logPane.add(row);
    this.transcript.push(`${icon} ${text}`);
  }

  private renderSpinnerFrame(): void {
    const frame = SPINNER_FRAMES[this.spinnerFrame] ?? SPINNER_FRAMES[0] ?? "•";
    this.spinnerIcon.content = frame;
    this.spinnerText.content = this.spinnerMessage;
  }

  /**
   * Mount a `SelectRenderable` in the prompt area, wait for the user
   * to pick an option (or cancel), then clean up.
   */
  private runSelectPrompt<T extends string>(opts: {
    message: string;
    options: SelectOption<T>[];
    initialValue?: T;
  }): Promise<T | Cancelled> {
    return new Promise((resolve) => {
      const { BoxRenderable, TextRenderable, SelectRenderable } = this.classes;
      const ctx = this.renderer.root.ctx;
      this.activePromptResolver = resolve as (value: unknown) => void;

      const tuiOptions: OpenTuiSelectOption[] = opts.options.map((option) => ({
        name: option.label,
        description: option.hint ?? "",
        value: option.value,
      }));
      const initialIndex =
        opts.initialValue !== undefined
          ? Math.max(
              0,
              opts.options.findIndex(
                (option) => option.value === opts.initialValue
              )
            )
          : 0;

      const wrapper = new BoxRenderable(ctx, {
        flexDirection: "column",
        gap: 1,
      });
      const messageNode = new TextRenderable(ctx, {
        content: stripAnsi(opts.message),
        fg: FOREGROUND,
      });
      const selectNode = new SelectRenderable(ctx, {
        options: tuiOptions,
        selectedIndex: initialIndex,
        height: Math.min(opts.options.length + 1, 8),
        textColor: FOREGROUND,
        focusedTextColor: FOREGROUND,
        selectedBackgroundColor: ACCENT,
        selectedTextColor: "#FFFFFF",
        descriptionColor: COLOR_DIM,
        showScrollIndicator: opts.options.length > 8,
        showDescription: true,
      });
      wrapper.add(messageNode);
      wrapper.add(selectNode);
      this.promptArea.add(wrapper);

      // SelectRenderable extends Renderable (an EventEmitter). The
      // `itemSelected` event fires when the user presses enter on an
      // option.
      selectNode.focus();
      selectNode.on(
        "itemSelected",
        (_index: number, option: OpenTuiSelectOption) => {
          this.tearDownPrompt(wrapper);
          resolve(option.value as T);
        }
      );
    });
  }

  /**
   * Mount a `SelectRenderable` with augmented labels and custom
   * keypress handling to support multi-select. Space toggles the
   * highlighted option; Enter confirms the selection set.
   */
  private runMultiSelectPrompt<T extends string>(opts: {
    message: string;
    options: SelectOption<T>[];
    initial: Set<T>;
    required: boolean;
  }): Promise<T[] | Cancelled> {
    return new Promise((resolve) => {
      const { BoxRenderable, TextRenderable, SelectRenderable } = this.classes;
      const ctx = this.renderer.root.ctx;
      this.activePromptResolver = resolve as (value: unknown) => void;

      const selected = new Set<T>(opts.initial);

      const buildTuiOptions = (): OpenTuiSelectOption[] =>
        opts.options.map((option) => ({
          name: `${selected.has(option.value) ? "◉" : "◯"} ${option.label}`,
          description: option.hint ?? "",
          value: option.value,
        }));

      const wrapper = new BoxRenderable(ctx, {
        flexDirection: "column",
        gap: 1,
      });
      const messageNode = new TextRenderable(ctx, {
        content: stripAnsi(opts.message),
        fg: FOREGROUND,
      });
      const hintNode = new TextRenderable(ctx, {
        content: "space toggle · enter confirm · esc cancel",
        fg: COLOR_DIM,
      });
      const selectNode = new SelectRenderable(ctx, {
        options: buildTuiOptions(),
        height: Math.min(opts.options.length + 2, 10),
        textColor: FOREGROUND,
        focusedTextColor: FOREGROUND,
        selectedBackgroundColor: ACCENT,
        selectedTextColor: "#FFFFFF",
        descriptionColor: COLOR_DIM,
        showScrollIndicator: opts.options.length > 10,
        showDescription: true,
      });
      wrapper.add(messageNode);
      wrapper.add(hintNode);
      wrapper.add(selectNode);
      this.promptArea.add(wrapper);

      const selectRenderable = selectNode as SelectRenderableType & {
        getSelectedOption: () => OpenTuiSelectOption | null;
        // `setOptions` is how SelectRenderable updates its visible options
        // — used here to redraw the marker glyph when the user toggles.
        setOptions?: (options: OpenTuiSelectOption[]) => void;
      };
      selectRenderable.focus();

      // Listen on the renderer's global key input — a focused Select
      // already consumes arrow keys and Enter, but space and our cancel
      // shortcuts need a global handler so they fire regardless of
      // which child is focused.
      const toggleHighlighted = () => {
        const current = selectRenderable.getSelectedOption();
        if (!current) {
          return;
        }
        const value = current.value as T;
        if (selected.has(value)) {
          selected.delete(value);
        } else {
          selected.add(value);
        }
        selectRenderable.setOptions?.(buildTuiOptions());
      };
      const confirmSelection = () => {
        if (opts.required && selected.size === 0) {
          return;
        }
        this.renderer.keyInput.off("keypress", onKey);
        this.tearDownPrompt(wrapper);
        // Preserve the source option order in the returned array.
        const ordered = opts.options
          .map((option) => option.value)
          .filter((value) => selected.has(value));
        resolve(ordered);
      };
      const onKey = (event: { name: string }) => {
        if (event.name === "space") {
          toggleHighlighted();
        } else if (event.name === "return" || event.name === "enter") {
          confirmSelection();
        }
      };
      this.renderer.keyInput.on("keypress", onKey);
    });
  }

  /**
   * Remove a mounted prompt wrapper from the prompt area.
   *
   * The `activePromptResolver` is cleared so that a follow-up Ctrl+C
   * doesn't fire the resolver a second time.
   */
  private tearDownPrompt(wrapper: BoxRenderableType): void {
    try {
      this.promptArea.remove(wrapper.id);
    } catch {
      // Renderable may have been unmounted already (e.g. by dispose).
    }
    this.activePromptResolver = undefined;
  }

  /**
   * Wire the global Ctrl+C / Escape handler. We bypass OpenTUI's
   * built-in `exitOnCtrlC` because the wizard needs cooperative
   * cancellation: resolve any pending prompt with `CANCELLED`, then
   * let `wizard-runner.ts` bubble the resulting `WizardCancelledError`
   * through its catch chain (which captures telemetry, exits cleanly,
   * etc.).
   */
  private installCancelHandler(): void {
    if (this.cancelHandlerInstalled) {
      return;
    }
    this.cancelHandlerInstalled = true;
    this.renderer.keyInput.on(
      "keypress",
      (event: { name: string; ctrl?: boolean }) => {
        const isCancel =
          (event.ctrl && event.name === "c") || event.name === "escape";
        if (!isCancel) {
          return;
        }
        const resolver = this.activePromptResolver;
        if (resolver) {
          this.activePromptResolver = undefined;
          resolver(CANCELLED);
        }
      }
    );
  }
}
