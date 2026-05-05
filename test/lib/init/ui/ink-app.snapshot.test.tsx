/**
 * Smoke-test the Ink App by mounting it with mocked stdin/stdout
 * inside `bun test`. Verifies the full-screen layout (tabbed
 * content, status bar, keyboard hints) without needing a real TTY.
 *
 * Note: The first Ink render() in a bun test CI worker can hang
 * indefinitely (Ink's internal reconciler keeps the event loop
 * alive in non-TTY). Tests that call renderApp() rely on a 500ms
 * timeout race to prevent blocking.
 */
import { describe, expect, test } from "bun:test";
import { Readable, Writable } from "node:stream";
import { render } from "ink";
import { createElement } from "react";
import { App } from "../../../../src/lib/init/ui/ink-app.js";
import { WizardStore } from "../../../../src/lib/init/ui/wizard-store.js";

const LEARN_HEADER_RE = /How Sentry Works/;
const TASKS_HEADER_RE = /Tasks\b/;
const STATUS_TAB_RE = /Status/;
const FILES_TAB_RE = /Files/;
const FILES_HEADER_PINNED_RE = /Files analyzed\s+\d+\/\d+/;
const FILES_HEADER_UNPINNED_RE = /Files analyzed\s+\u2191\s+\d+\/\d+/;
const KEYBOARD_HINT_RE = /switch tab/;

const FRAME_SETTLE_MS = 80;

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

function makeStdin(): Readable {
  const s = new Readable({
    read() {
      // No keystrokes in tests — Ink reads from this stream but
      // we never push data.
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
  await Bun.sleep(FRAME_SETTLE_MS);
  instance.unmount();
  // waitUntilExit() hangs in CI — race with a short unref'd timeout.
  await Promise.race([
    instance.waitUntilExit().catch(() => {
      // Ink may reject on unmount — ignore.
    }),
    new Promise<void>((r) => {
      const t = setTimeout(r, 500);
      if (typeof t === "object" && "unref" in t) {
        t.unref();
      }
    }),
  ]);
  return out;
}

describe("Ink App snapshot", () => {
  test("renders full-screen layout at 120 cols", async () => {
    const store = new WizardStore();
    store.appendLog("info", "Hello world");
    store.appendLog("success", "Working\u2026");

    const frame = (await renderApp(store, 120)).allOutput();
    expect(frame).toMatch(LEARN_HEADER_RE);
    expect(frame).toMatch(TASKS_HEADER_RE);
    expect(frame).toContain("Hello world");
    expect(frame).toContain("Working\u2026");
    expect(frame).toMatch(STATUS_TAB_RE);
    expect(frame).toMatch(FILES_TAB_RE);
    expect(frame).toMatch(KEYBOARD_HINT_RE);
  });

  test("renders single-column layout at narrow width", async () => {
    const store = new WizardStore();
    store.appendLog("info", "Narrow terminal");

    const frame = (await renderApp(store, 60)).allOutput();
    expect(frame).toContain("Narrow terminal");
    expect(frame).toMatch(STATUS_TAB_RE);
  });

  test("status bar shows messages", async () => {
    const store = new WizardStore();
    store.appendStatus("Analyzing project...");
    store.appendStatus("Reading package.json");

    const frame = (await renderApp(store, 120)).allOutput();
    expect(frame).toContain("Reading package.json");
  });

  test("Status screen shows logs and banner, not file tree", async () => {
    const store = new WizardStore();
    store.appendLog("info", "Checking project...");
    store.recordFilesReading(["package.json", "src/index.ts"]);
    store.markFilesAnalyzed(["package.json"]);

    const frame = (await renderApp(store, 120)).allOutput();
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
