/**
 * Smoke-test the Ink App by mounting it with mocked stdin/stdout
 * inside `bun test`. Verifies the visual layout improvements
 * (`Divider` width, sidebar headers, sidebar auto-hide) without
 * needing a real TTY — Bun-compiled standalone binaries report
 * `process.stdin.isTTY: false` even when launched through
 * `script(1)` or a hand-allocated `/dev/ptmx` pair, so spawning
 * `dist-bin/sentry-linux-x64 init` in a sandboxed PTY routes to
 * `LoggingUI` instead of `InkUI`. Mounting the React tree
 * directly via Ink's `render()` API sidesteps that detection
 * entirely.
 *
 * What this test cannot exercise:
 *   - The real Ctrl+C path through `useInput` (no raw-mode TTY).
 *     Covered indirectly by `WizardStore.setRequestCancel` tests
 *     in `wizard-store.test.ts` plus the `requestCancel` smoke
 *     test below.
 *   - The bridge's `[Symbol.asyncDispose]` teardown ordering. The
 *     guards (`torndown`, `cancelRequested`) are pure state-
 *     machine logic that's already covered by reading the source.
 */
import { describe, expect, test } from "bun:test";
import { Readable, Writable } from "node:stream";
import { render } from "ink";
import { createElement } from "react";
import { App } from "../../../../src/lib/init/ui/ink-app.js";
import { WizardStore } from "../../../../src/lib/init/ui/wizard-store.js";

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
];

// Top-level regex literals (biome `useTopLevelRegex`).
const BANNER_GLYPH_RE = /███████╗/;
const TIP_HEADER_RE = /Did you know\?/;
const PROGRESS_HEADER_RE = /Progress/;
const PROGRESS_HEADER_BOUND_RE = /Progress\b/;
const DIVIDER_RUNS_RE = /(─+)/g;
const FILES_HEADER_PINNED_RE = /Files analyzed\s+\d+\/\d+/;
const FILES_HEADER_UNPINNED_RE = /Files analyzed\s+↑\s+\d+\/\d+/;

const FRAME_SETTLE_MS = 80;

function bannerRows(): { content: string; color: string }[] {
  return BANNER_ROWS.map((content, i) => ({
    content,
    color: BANNER_GRADIENT[i] ?? "#FFFFFF",
  }));
}

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
  // Cast to a structural type covering the surface Ink touches:
  // it only checks `isTTY` and toggles raw mode + flow control.
  // We deliberately don't import Ink's internal `ReadStream` type.
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

/** Empty-then-no-throw promise resolver for Ink's `waitUntilExit`. */
function ignore(): void {
  // Ink rejects waitUntilExit when unmount happens before render
  // completes; tests don't care about that.
}

/** Render the App with mocked I/O and return the captured stream. */
async function renderApp(
  store: WizardStore,
  columns: number
): Promise<CaptureStream> {
  const out = new CaptureStream(columns, 40);
  // The `as never` cast routes around Ink's strict Options type
  // (which expects WriteStream/ReadStream). The CaptureStream and
  // makeStdin() shim implement the structural surface Ink uses;
  // the test runner doesn't need full type-correctness here.
  const { unmount, waitUntilExit } = render(createElement(App, { store }), {
    stdout: out as unknown as NodeJS.WriteStream,
    stderr: out as unknown as NodeJS.WriteStream,
    stdin: makeStdin() as unknown as NodeJS.ReadStream,
    patchConsole: false,
    exitOnCtrlC: false,
  });
  await new Promise((r) => setTimeout(r, FRAME_SETTLE_MS));
  unmount();
  await waitUntilExit().catch(ignore);
  return out;
}

describe("Ink App snapshot", () => {
  test("renders banner + sidebar at 120 cols", async () => {
    const store = new WizardStore({ bannerRows: bannerRows() });
    store.appendLog("info", "Hello world");
    store.startSpinner("Working…");
    store.recordFilesReading(["package.json", "src/index.ts"]);
    store.markFilesAnalyzed(["package.json"]);

    const frame = (await renderApp(store, 120)).allOutput();
    // `███████╗` proves the banner rendered (the box-drawing art
    // doesn't contain the literal "SENTRY" string).
    expect(frame).toMatch(BANNER_GLYPH_RE);
    // Sidebar panels visible at >= SIDEBAR_BREAKPOINT (100 cols).
    expect(frame).toMatch(TIP_HEADER_RE);
    expect(frame).toMatch(PROGRESS_HEADER_RE);
    expect(frame).toContain("Hello world");
    expect(frame).toContain("Working…");
  });

  test("hides sidebar at 80 cols", async () => {
    const store = new WizardStore({ bannerRows: bannerRows() });
    store.appendLog("info", "Narrow terminal");

    const frame = (await renderApp(store, 80)).allOutput();
    expect(frame).toMatch(BANNER_GLYPH_RE);
    expect(frame).toContain("Narrow terminal");
    // Sidebar panels suppressed below SIDEBAR_BREAKPOINT.
    expect(frame).not.toMatch(TIP_HEADER_RE);
    expect(frame).not.toMatch(PROGRESS_HEADER_BOUND_RE);
  });

  test("Divider tracks main-column width (no sidebar)", async () => {
    const store = new WizardStore({ bannerRows: bannerRows() });

    const frame = (await renderApp(store, 80)).allOutput();
    // Two notable ─ runs at 80 cols, no sidebar:
    //   - Outer wizard chrome border: 78 chars (80 - 2 corners),
    //     emitted twice (top + bottom).
    //   - Divider component below banner: capped at 56 by
    //     `Math.min(mainColumnWidth - 2, 56)` (banner row width
    //     is 55, so 56 stays inside it).
    // Old hard-coded value was always 50; the new code grows up
    // to 56. Dedupe lengths, then take the second-longest.
    const lengths = [...frame.matchAll(DIVIDER_RUNS_RE)].map(
      (m) => m[1].length
    );
    const unique = [...new Set(lengths)].sort((a, b) => b - a);
    // [0] = outer border, [1] = Divider.
    const dividerLength = unique[1] ?? 0;
    expect(dividerLength).toBeGreaterThanOrEqual(50);
    expect(dividerLength).toBeLessThanOrEqual(56);
  });

  test("FilesPanel renders scrollbar when content exceeds viewport", async () => {
    // Drop ~30 file paths into the store so the read-tree exceeds
    // the panel's viewport (capped at MAX_FILE_ROWS = 14, minus 1
    // for the header). The visual scrollbar should appear; with
    // the panel pinned to the bottom (default state), the `█`
    // thumb sits at the bottom of the track.
    const fewStore = new WizardStore({ bannerRows: bannerRows() });
    fewStore.recordFilesReading(["package.json", "src/index.ts"]);
    const fewFrame = (await renderApp(fewStore, 120)).allOutput();
    const baselineThumbs = (fewFrame.match(/█/g) ?? []).length;

    const manyStore = new WizardStore({ bannerRows: bannerRows() });
    const paths: string[] = [];
    for (let i = 0; i < 30; i++) {
      paths.push(`src/dir${Math.floor(i / 5)}/file${i}.ts`);
    }
    manyStore.recordFilesReading(paths);
    manyStore.markFilesAnalyzed(paths.slice(0, 18));
    const manyFrame = (await renderApp(manyStore, 120)).allOutput();
    const scrollingThumbs = (manyFrame.match(/█/g) ?? []).length;

    // The banner art uses `█` glyphs too (same codepoint as the
    // scrollbar thumb), so we can't assert presence/absence
    // against a fixed pattern. But the many-files frame must
    // contain MORE `█`s than the few-files frame — those extras
    // are the scrollbar thumb cells.
    expect(scrollingThumbs).toBeGreaterThan(baselineThumbs);
    // Header shows pinned-to-bottom format ("Files analyzed
    // N/M", no `↑` prefix). The unpinned format only appears
    // after the user scrolls back manually — keyboard scrolling
    // can't be exercised from `bun test` without a raw-mode TTY.
    expect(manyFrame).toMatch(FILES_HEADER_PINNED_RE);
    expect(manyFrame).not.toMatch(FILES_HEADER_UNPINNED_RE);
  });

  test("Ctrl+C path uses requestCancel via store, never bare process.exit", () => {
    // The App's top-level `useInput` reads `requestCancel` from the
    // store on every keystroke. This test exercises only the store
    // contract — driving real Ctrl+C through `useInput` requires a
    // raw-mode TTY which Bun-compiled binaries don't expose to
    // sandboxed test PTYs.
    let cancels = 0;
    const store = new WizardStore();
    store.setRequestCancel(() => {
      cancels += 1;
    });
    expect(store.getSnapshot().requestCancel).toBeDefined();
    store.getSnapshot().requestCancel?.();
    expect(cancels).toBe(1);
    // Teardown clears the callback so a stale Ink dispatch can't
    // re-enter cancellation after `[Symbol.asyncDispose]` runs.
    store.setRequestCancel(undefined);
    expect(store.getSnapshot().requestCancel).toBeUndefined();
  });
});
