/**
 * OpenTuiUI — full-screen `WizardUI` implementation built on
 * `@opentui/core`.
 *
 * The renderer takes over the terminal in alternate-screen mode for the
 * duration of the run, restoring the main screen on dispose. The layout
 * is a vertical flex column:
 *
 *   ┌──────────────────────────────────────────┐
 *   │ Header (intro title)                     │
 *   ├──────────────────────────────────────────┤
 *   │ Log pane (scrollable, append-only)       │
 *   │   info: ...                              │
 *   │   warn: ...                              │
 *   │   ...                                    │
 *   ├──────────────────────────────────────────┤
 *   │ Spinner block (single line, animated)    │
 *   ├──────────────────────────────────────────┤
 *   │ Prompt area (transient — Select/Input)   │
 *   └──────────────────────────────────────────┘
 *
 * Prompt methods mount a focused Select renderable into the prompt
 * area, await user input, then unmount it. Cancellation (Ctrl+C or
 * Escape) resolves with the shared `CANCELLED` sentinel.
 *
 * **Bun-only.** OpenTUI's native bindings ship as Zig — they don't run
 * on the npm/Node distribution. The factory in `factory.ts` only routes
 * here when running inside the Bun-compiled binary; on Node it falls
 * back to `LoggingUI`. Importing this module on Node will fail at
 * runtime when the OpenTUI native loader can't find its binary.
 *
 * **Lazy import.** The `@opentui/core` import is dynamic — `getUIAsync()`
 * builds an `OpenTuiUI` instance asynchronously so the npm bundle
 * (which excludes `@opentui/core` from the bundle graph) doesn't see
 * the import at module-load time.
 *
 * **Why Renderable classes, not the `Box()`/`Text()` factories.** The
 * factory functions return `VNode` proxies that queue mutations into a
 * `__pendingCalls` array. Those queued calls only flush at instantiation
 * time (when the VNode gets added to a parent). Subsequent mutations on
 * the stored VNode reference never reach the live Renderable instance,
 * so `vnode.content = "x"` is a no-op after first render. Instantiating
 * `BoxRenderable` / `TextRenderable` / `SelectRenderable` directly
 * bypasses the proxy and gives us live instances we can mutate in place
 * for the spinner tick, log appends, and prompt mount/unmount cycles.
 */

import type {
  BoxRenderable as BoxRenderableType,
  CliRenderer,
  SelectOption as OpenTuiSelectOption,
  SelectRenderable as SelectRenderableType,
  TextRenderable as TextRenderableType,
} from "@opentui/core";
import { renderInlineMarkdown } from "../../formatters/markdown.js";
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

// Spinner frames are kept identical to `src/lib/init/spinner.ts` so the
// tempo and visual rhythm match the legacy LoggingUI users' expectations.
const SPINNER_FRAMES = process.platform.startsWith("win")
  ? ["●", "o", "O", "0"]
  : ["◒", "◐", "◓", "◑"];
const SPINNER_INTERVAL_MS = process.platform.startsWith("win") ? 80 : 120;

const STOP_ICONS: Record<SpinnerExitCode, string> = {
  0: "◆",
  1: "■",
  2: "▲",
};

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
  private readonly headerLine: TextRenderableType;
  private readonly logPane: BoxRenderableType;
  private readonly spinnerLine: TextRenderableType;
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
   * wizard's output in their scrollback. Without this the alternate-
   * screen takeover hides everything the moment `destroy()` returns.
   */
  private readonly transcript: string[] = [];

  constructor(renderer: CliRenderer, classes: OpenTuiClasses) {
    this.renderer = renderer;
    this.classes = classes;
    const ctx = renderer.root.ctx;
    const { BoxRenderable, TextRenderable } = classes;

    // Build the four-region column layout. The log pane gets `flexGrow`
    // so it consumes any vertical space left over after the fixed-size
    // header / spinner / prompt rows.
    const root = new BoxRenderable(ctx, {
      flexDirection: "column",
      flexGrow: 1,
    });
    this.headerLine = new TextRenderable(ctx, { content: "" });
    this.logPane = new BoxRenderable(ctx, {
      flexDirection: "column",
      flexGrow: 1,
    });
    this.spinnerLine = new TextRenderable(ctx, { content: "" });
    this.promptArea = new BoxRenderable(ctx, { flexDirection: "column" });

    root.add(this.headerLine);
    root.add(this.logPane);
    root.add(this.spinnerLine);
    root.add(this.promptArea);
    renderer.root.add(root);

    this.installCancelHandler();
  }

  // ── Lifecycle ─────────────────────────────────────────────────────

  intro(title: string): void {
    const rendered = renderInlineMarkdown(title);
    this.headerLine.content = rendered;
    this.transcript.push(rendered);
  }

  outro(message: string): void {
    this.appendLog(`✓ ${message}`);
  }

  cancel(message: string): void {
    this.appendLog(`✗ ${message}`);
  }

  // ── Logging ───────────────────────────────────────────────────────

  log: WizardLog = {
    info: (message) => this.appendLog(`info: ${message}`),
    warn: (message) => this.appendLog(`warn: ${message}`),
    error: (message) => this.appendLog(`error: ${message}`),
    success: (message) => this.appendLog(`✓ ${message}`),
    message: (message) => this.appendLog(message),
  };

  // ── Spinner ───────────────────────────────────────────────────────

  spinner(): SpinnerHandle {
    return {
      start: (message?: string) => {
        this.spinnerActive = true;
        this.spinnerFrame = 0;
        this.spinnerMessage = message ?? "";
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
          this.spinnerMessage = message;
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
        const finalMessage = message ?? this.spinnerMessage;
        if (finalMessage) {
          // Emit the final state into the scrollable log so it survives
          // subsequent spinner re-uses, then clear the live spinner row.
          this.appendLog(`${STOP_ICONS[code]} ${finalMessage}`);
        }
        this.spinnerLine.content = "";
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
    // toggles, enter confirms. This avoids needing a separate
    // multi-select renderable, which OpenTUI doesn't ship.
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
    // appear in the user's scrollback after exit. Stderr (rather than
    // stdout) keeps human-readable progress out of pipeable wizard
    // output for any downstream consumers.
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

  private appendLog(text: string): void {
    const { TextRenderable } = this.classes;
    const rendered = renderInlineMarkdown(text);
    const line = new TextRenderable(this.renderer.root.ctx, {
      content: rendered,
    });
    this.logPane.add(line);
    this.transcript.push(rendered);
  }

  private renderSpinnerFrame(): void {
    const frame = SPINNER_FRAMES[this.spinnerFrame] ?? SPINNER_FRAMES[0] ?? "•";
    this.spinnerLine.content = renderInlineMarkdown(
      `${frame}  ${this.spinnerMessage}`
    );
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

      const wrapper = new BoxRenderable(ctx, { flexDirection: "column" });
      const messageNode = new TextRenderable(ctx, {
        content: renderInlineMarkdown(opts.message),
      });
      const selectNode = new SelectRenderable(ctx, {
        options: tuiOptions,
        selectedIndex: initialIndex,
        height: Math.min(opts.options.length + 1, 8),
      });
      wrapper.add(messageNode);
      wrapper.add(selectNode);
      this.promptArea.add(wrapper);

      // SelectRenderable extends Renderable which is an EventEmitter.
      // `itemSelected` fires when the user presses enter on an option.
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
          name: `[${selected.has(option.value) ? "x" : " "}] ${option.label}`,
          description: option.hint ?? "",
          value: option.value,
        }));

      const wrapper = new BoxRenderable(ctx, { flexDirection: "column" });
      const messageNode = new TextRenderable(ctx, {
        content: renderInlineMarkdown(
          `${opts.message}\n(space to toggle, enter to confirm)`
        ),
      });
      const selectNode = new SelectRenderable(ctx, {
        options: buildTuiOptions(),
        height: Math.min(opts.options.length + 2, 10),
      });
      wrapper.add(messageNode);
      wrapper.add(selectNode);
      this.promptArea.add(wrapper);

      const selectRenderable = selectNode as SelectRenderableType & {
        getSelectedOption: () => OpenTuiSelectOption | null;
        // `setOptions` is how SelectRenderable updates its visible options
        // — used here to redraw the [x]/[ ] markers when the user toggles.
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
