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
 * Prompt methods mount a focused Select / Input renderable into the
 * prompt area, await user input, then unmount it. Cancellation (Ctrl+C
 * or Escape) resolves with the shared `CANCELLED` sentinel.
 *
 * **Bun-only.** OpenTUI's native bindings ship as Zig — they don't run
 * on the npm/Node distribution. The factory in `factory.ts` only routes
 * here when running inside the Bun-compiled binary; on Node it falls
 * back to `ClackUI`. Importing this module on Node will fail at runtime
 * when the OpenTUI native loader can't find its binary.
 *
 * **Lazy import.** The `@opentui/core` import is dynamic — `getUI()`
 * builds an `OpenTuiUI` instance asynchronously so the npm bundle
 * (which excludes `@opentui/core` from the bundle graph) doesn't see
 * the import at module-load time.
 */

import type {
  CliRenderer,
  SelectOption as OpenTuiSelectOption,
  SelectRenderable,
  TextNodeRenderable,
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
// tempo and visual rhythm match `ClackUI` users' expectations.
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
 * OpenTUI factories used by this module. Resolved once via dynamic
 * import in `OpenTuiUI.create()` so the `@opentui/core` import never
 * runs synchronously at module-load time on the npm/Node distribution.
 *
 * The factory return types are intentionally `any` — OpenTUI's vnode
 * proxy types are deeply nested generics that don't add safety here
 * (the factories are immediately wrapped in our own helpers and the
 * resulting renderables are treated as opaque tree nodes).
 */
// biome-ignore lint/suspicious/noExplicitAny: see comment above
type RenderableNode = any;
type OpenTuiFactories = {
  createCliRenderer: (config?: unknown) => Promise<CliRenderer>;
  Box: (props?: unknown, ...children: RenderableNode[]) => RenderableNode;
  Text: (props?: unknown, ...children: RenderableNode[]) => RenderableNode;
  Select: (props?: unknown, ...children: RenderableNode[]) => RenderableNode;
};

/**
 * Async factory for `OpenTuiUI`. Imports `@opentui/core` lazily and
 * constructs the renderer + initial layout. Throws if the native
 * bindings are missing (e.g. accidentally invoked from Node).
 */
export async function createOpenTuiUI(): Promise<OpenTuiUI> {
  const mod = (await import("@opentui/core")) as unknown as OpenTuiFactories;
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
  private readonly logLines: TextNodeRenderable[] = [];
  private readonly logPane: RenderableNode;
  private readonly spinnerLine: RenderableNode;
  private readonly promptArea: RenderableNode;
  private readonly headerLine: RenderableNode;
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

  private readonly renderer: CliRenderer;
  private readonly factories: OpenTuiFactories;

  constructor(renderer: CliRenderer, factories: OpenTuiFactories) {
    this.renderer = renderer;
    this.factories = factories;
    const { Box, Text } = factories;

    // Build the four-region column layout. The log pane gets `flexGrow`
    // so it consumes any vertical space left over after the fixed-size
    // header / spinner / prompt rows.
    const root = Box({ flexDirection: "column", flexGrow: 1 });
    this.headerLine = Text({ content: "" });
    this.logPane = Text({ content: "", flexGrow: 1 });
    this.spinnerLine = Text({ content: "" });
    this.promptArea = Box({ flexDirection: "column" });

    root.add(this.headerLine);
    root.add(this.logPane);
    root.add(this.spinnerLine);
    root.add(this.promptArea);
    renderer.root.add(root);

    this.installCancelHandler();
  }

  // ── Lifecycle ─────────────────────────────────────────────────────

  intro(title: string): void {
    this.headerLine.content = renderInlineMarkdown(title);
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
    // `destroy()` is idempotent and synchronous in OpenTUI's renderer,
    // but we wrap in Promise to satisfy the AsyncDisposable contract
    // and to leave room for future async teardown work (e.g. drain the
    // render queue).
    try {
      this.renderer.destroy();
    } catch {
      // Ignore — disposal must never throw.
    }
    return Promise.resolve();
  }

  // ── Internal helpers ──────────────────────────────────────────────

  private appendLog(text: string): void {
    const { Text } = this.factories;
    const line = Text({
      content: renderInlineMarkdown(text),
    }) as unknown as TextNodeRenderable;
    this.logLines.push(line);
    this.logPane.add(line);
  }

  private renderSpinnerFrame(): void {
    const frame = SPINNER_FRAMES[this.spinnerFrame] ?? SPINNER_FRAMES[0] ?? "•";
    this.spinnerLine.content = renderInlineMarkdown(
      `${frame}  ${this.spinnerMessage}`
    );
  }

  /**
   * Mount a `Select` renderable in the prompt area, wait for the user
   * to pick an option (or cancel), then clean up.
   */
  private runSelectPrompt<T extends string>(opts: {
    message: string;
    options: SelectOption<T>[];
    initialValue?: T;
  }): Promise<T | Cancelled> {
    return new Promise((resolve) => {
      const { Box, Text, Select } = this.factories;
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

      const messageNode = Text({
        content: renderInlineMarkdown(opts.message),
      });
      const selectNode = Select({
        options: tuiOptions,
        selectedIndex: initialIndex,
        height: Math.min(opts.options.length + 1, 8),
      });

      const wrapper = Box({ flexDirection: "column" });
      wrapper.add(messageNode);
      wrapper.add(selectNode);
      this.promptArea.add(wrapper);

      // SelectRenderable extends Renderable which is an EventEmitter.
      // `itemSelected` fires when the user presses enter on an option.
      const selectRenderable = selectNode as unknown as SelectRenderable;
      selectRenderable.focus();
      selectRenderable.on(
        "itemSelected",
        (_index: number, option: OpenTuiSelectOption) => {
          this.tearDownPrompt(wrapper);
          resolve(option.value as T);
        }
      );
    });
  }

  /**
   * Mount a `Select` with augmented labels and custom keypress handling
   * to support multi-select. Space toggles the highlighted option;
   * Enter confirms the selection set.
   */
  private runMultiSelectPrompt<T extends string>(opts: {
    message: string;
    options: SelectOption<T>[];
    initial: Set<T>;
    required: boolean;
  }): Promise<T[] | Cancelled> {
    return new Promise((resolve) => {
      const { Box, Text, Select } = this.factories;
      this.activePromptResolver = resolve as (value: unknown) => void;

      const selected = new Set<T>(opts.initial);

      const buildTuiOptions = (): OpenTuiSelectOption[] =>
        opts.options.map((option) => ({
          name: `[${selected.has(option.value) ? "x" : " "}] ${option.label}`,
          description: option.hint ?? "",
          value: option.value,
        }));

      const messageNode = Text({
        content: renderInlineMarkdown(
          `${opts.message}\n(space to toggle, enter to confirm)`
        ),
      });
      const selectNode = Select({
        options: buildTuiOptions(),
        height: Math.min(opts.options.length + 2, 10),
      });
      const wrapper = Box({ flexDirection: "column" });
      wrapper.add(messageNode);
      wrapper.add(selectNode);
      this.promptArea.add(wrapper);

      const selectRenderable = selectNode as unknown as SelectRenderable & {
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
  private tearDownPrompt(wrapper: RenderableNode): void {
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
