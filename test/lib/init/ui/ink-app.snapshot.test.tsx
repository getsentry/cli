/**
 * Smoke-test the Ink App by mounting it with mocked stdin/stdout
 * inside `bun test`. Verifies the full-screen layout (TitleBar,
 * tabbed content, status bar, keyboard hints) without needing a
 * real TTY.
 *
 * What this test cannot exercise:
 *   - The real Ctrl+C path through `useInput` (no raw-mode TTY).
 *     Covered indirectly by `WizardStore.setRequestCancel` tests
 *     in `wizard-store.test.ts` plus the `requestCancel` smoke
 *     test below.
 *   - Tab switching via arrow keys (requires `useInput` delivery).
 *   - Alternate screen buffer enter/exit (handled by ink-ui.ts).
 */
import { describe, expect, test } from "bun:test";
import { Readable, Writable } from "node:stream";
import { render } from "ink";
import { createElement } from "react";
import { App } from "../../../../src/lib/init/ui/ink-app.js";
import { WizardStore } from "../../../../src/lib/init/ui/wizard-store.js";

// Top-level regex literals (biome `useTopLevelRegex`).
const LEARN_HEADER_RE = /How Sentry Works/;
const TASKS_HEADER_RE = /Tasks\b/;
const STATUS_TAB_RE = /Status/;
const FILES_TAB_RE = /Files/;
const FILES_HEADER_PINNED_RE = /Files analyzed\s+\d+\/\d+/;
const FILES_HEADER_UNPINNED_RE = /Files analyzed\s+↑\s+\d+\/\d+/;
const KEYBOARD_HINT_RE = /switch tab/;

const FRAME_SETTLE_MS = 80;

/**
 * Writable that captures every chunk Ink emits. Ink splits a render
 * across several writes (cursor moves → sync flag → content → sync
 * unflag) so `lastFrame()` alone is usually a control sequence —
 * `allOutput()` joins them so assertions can match against the
 * full visible rendering.
 */
class CaptureStream extends Writable {
  frames: string[] = [];
  columns: number;
  rows: number;
  isTTY = true;
  constructor(columns = 120, rows = 40) {
    super();
    this.columns = columns;
    this.rows = rows;
  }
  _write(chunk: Buffer, _enc: string, cb: () => void): void {
    this.frames.push(chunk.toString());
    cb();
  }
  allOutput(): string {
    return this.frames.join("");
  }
}

/** Minimal `Readable` that satisfies Ink's stdin-shape expectations. */
function makeStdin(): Readable {
  const s = new Readable({
    read() {
      // No-op — tests don't drive keystrokes, they assert on
      // initial frames after mount.
    },
  });
  const shim = s as Readable & {
    isTTY: boolean;
    setRawMode: (v: boolean) => Readable;
    resume: () => Readable;
    pause: () => Readable;
    ref: () => Readable;
    unref: () => Readable;
  };
  shim.isTTY = true;
  shim.setRawMode = () => s;
  shim.resume = () => s;
  shim.pause = () => s;
  shim.ref = () => s;
  shim.unref = () => s;
  return s;
}

/** Render the App with mocked I/O and return the captured stream. */
async function renderApp(
  store: WizardStore,
  columns: number
): Promise<CaptureStream> {
  const out = new CaptureStream(columns, 40);
  const instance = render(createElement(App, { store }), {
    stdout: out as unknown as NodeJS.WriteStream,
    stderr: out as unknown as NodeJS.WriteStream,
    stdin: makeStdin() as unknown as NodeJS.ReadStream,
    patchConsole: false,
    exitOnCtrlC: false,
  });
  // Settle: let Ink render one frame. Use unref so this timer
  // doesn't keep the event loop alive on its own.
  await new Promise<void>((r) => {
    const t = setTimeout(r, FRAME_SETTLE_MS);
    if (typeof t === "object" && "unref" in t) {
      t.unref();
    }
  });
  instance.unmount();
  // waitUntilExit() hangs in CI — Ink keeps internal timers alive
  // in non-TTY. Race against an unref'd timeout so bun test can
  // exit the worker even if Ink's promise never resolves.
  const exitRace = new Promise<void>((r) => {
    const t = setTimeout(r, 500);
    if (typeof t === "object" && "unref" in t) {
      t.unref();
    }
  });
  await Promise.race([
    instance.waitUntilExit().catch(() => {
      // Ink may reject on unmount — ignore.
    }),
    exitRace,
  ]);
  return out;
}

describe("Ink App snapshot", () => {
  test("renders single-column layout at narrow width", async () => {
    const store = new WizardStore();
    store.appendLog("info", "Narrow terminal");

    const frame = (await renderApp(store, 60)).allOutput();
    expect(frame).toContain("Narrow terminal");
    // At < 80 cols the sidebar is hidden — only the main content
    // area renders in single-column mode.
    expect(frame).toMatch(STATUS_TAB_RE);
  });

  test("renders full-screen layout at 120 cols", async () => {
    const store = new WizardStore();
    store.appendLog("info", "Hello world");
    store.appendLog("success", "Working…");

    const frame = (await renderApp(store, 120)).allOutput();
    // Status tab is the default — sidebar shows the learn panel
    // (progressive reveal sequence) before falling back to tips.
    expect(frame).toMatch(LEARN_HEADER_RE);
    expect(frame).toMatch(TASKS_HEADER_RE);
    // Log lines visible in the activity pane.
    expect(frame).toContain("Hello world");
    expect(frame).toContain("Working…");
    // Tab bar visible.
    expect(frame).toMatch(STATUS_TAB_RE);
    expect(frame).toMatch(FILES_TAB_RE);
    // Keyboard hints visible.
    expect(frame).toMatch(KEYBOARD_HINT_RE);
  });

  test("status bar shows messages", async () => {
    const store = new WizardStore();
    store.appendStatus("Analyzing project...");
    store.appendStatus("Reading package.json");

    const frame = (await renderApp(store, 120)).allOutput();
    // The most recent status message should be visible.
    expect(frame).toContain("Reading package.json");
  });

  test("Status screen shows logs and banner, not file tree", async () => {
    const store = new WizardStore();
    store.appendLog("info", "Checking project...");
    store.recordFilesReading(["package.json", "src/index.ts"]);
    store.markFilesAnalyzed(["package.json"]);

    const frame = (await renderApp(store, 120)).allOutput();
    // Status tab (default) shows logs but NOT the file tree —
    // files are on the Files tab.
    expect(frame).toContain("Checking project...");
    expect(frame).not.toMatch(FILES_HEADER_PINNED_RE);
    expect(frame).not.toMatch(FILES_HEADER_UNPINNED_RE);
  });

  test("Ctrl+C path uses requestCancel via store, never bare process.exit", () => {
    let cancels = 0;
    const store = new WizardStore();
    store.setRequestCancel(() => {
      cancels += 1;
    });
    expect(store.getSnapshot().requestCancel).toBeDefined();
    store.getSnapshot().requestCancel?.();
    expect(cancels).toBe(1);
    store.setRequestCancel(undefined);
    expect(store.getSnapshot().requestCancel).toBeUndefined();
  });
});
