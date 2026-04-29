/**
 * Dashboard view — OpenTUI rendering bridge.
 *
 * Renders a {@link DashboardViewData} snapshot to a multi-line
 * string by mounting a React tree built with OpenTUI primitives
 * (see `dashboard-app.tsx`) into an off-screen test renderer, then
 * capturing the post-render character buffer.
 *
 * Why a "test" renderer for production rendering?
 *
 *   OpenTUI's normal `createCliRenderer()` mounts a long-lived
 *   render loop bound to `process.stdout`, expecting to drive a
 *   live terminal session. The `dashboard view` command is a
 *   one-shot CLI invocation that needs a string back from a
 *   synchronous-looking pipeline (HumanRenderer.render()), not a
 *   persistent UI. `createTestRenderer()` exposes the same React
 *   reconciler hooked up to a virtual stdout — `renderOnce()`
 *   commits the tree, `captureCharFrame()` returns the rendered
 *   character grid as a string. Despite the "testing" name in the
 *   import path, this is the documented way to do off-screen
 *   rendering in OpenTUI.
 *
 * Bun-binary only:
 *
 *   OpenTUI ships native Zig bindings via `bun:ffi` that don't
 *   load on Node. The npm distribution externalizes
 *   `@opentui/core` from its bundle entirely, and dynamic
 *   `import("@opentui/core/testing")` will throw "Cannot find
 *   module" at runtime there. Callers must catch that error and
 *   fall back to the plain-text formatter
 *   (`formatDashboardWithData` in `dashboard.ts`).
 *
 *   The `with { type: "file" }` indirection used by the wizard's
 *   `OpenTuiUI` isn't needed here because the dashboard React
 *   tree's only static imports are types from `dashboard.ts` —
 *   the OpenTUI runtime imports happen inside this module's
 *   async factory, and the `?bridge=1` query string trick still
 *   applies if Bun's module loader ever caches a stale resolution.
 */

import type { DashboardViewData } from "./dashboard.js";

/**
 * Embed `dashboard-app.tsx` as a Bun-compile file resource.
 *
 * Same indirection as `OpenTuiUI.ink-app.tsx` / OpenTuiUI's
 * `opentui-app.tsx`: the static `with { type: "file" }` import
 * keeps the React tree out of esbuild's and Bun.compile's bundle
 * graph (where their CJS/jsx-runtime resolution misbehaves) and
 * pushes evaluation to Bun's runtime. The `?bridge=1` query
 * string on the dynamic import bypasses Bun's module-cache
 * collision between the file-resource specifier and the dynamic
 * import.
 */
// @ts-expect-error: `with { type: "file" }` is Bun-specific and not yet typed in @types/bun
import dashboardAppPath from "./dashboard-app.tsx" with { type: "file" };

/** Default rendering width when stdout dimensions can't be detected. */
const DEFAULT_WIDTH = 100;

/** Floor for very narrow terminals — under this widgets stop fitting. */
const MIN_WIDTH = 80;

/** Default rendering height — long enough for ~5 dashboard rows. */
const DEFAULT_HEIGHT = 40;

/**
 * Resolve the rendering width. Uses the actual terminal column
 * count when stdout is a TTY, falls back to `DEFAULT_WIDTH` for
 * piped/redirected output. Clamped to `MIN_WIDTH`.
 */
function getRenderWidth(): number {
  const cols = process.stdout.columns;
  if (cols && cols > 0) {
    return Math.max(MIN_WIDTH, cols);
  }
  return DEFAULT_WIDTH;
}

/**
 * Compute a generous render height based on the widget grid's
 * vertical extent so all widgets fit in the captured frame. Each
 * grid unit is `LINES_PER_UNIT` rows, plus a few rows for the
 * header and inter-row gaps.
 */
function estimateRenderHeight(data: DashboardViewData): number {
  const LINES_PER_UNIT = 6;
  const HEADER_ROWS = 3;
  const GAP_PER_ROW = 1;

  let maxBottom = 0;
  const yPositions = new Set<number>();
  for (const widget of data.widgets) {
    if (widget.layout) {
      yPositions.add(widget.layout.y);
      const bottom = widget.layout.y + widget.layout.h;
      if (bottom > maxBottom) {
        maxBottom = bottom;
      }
    }
  }

  // Total: rows for layout-bearing widgets, plus orphans (treat
  // each as one grid unit), plus header + gaps.
  const orphanCount = data.widgets.filter((w) => !w.layout).length;
  const gridRows = Math.max(maxBottom, 1) * LINES_PER_UNIT;
  const orphanRows = orphanCount * LINES_PER_UNIT;
  const gapRows = (yPositions.size + orphanCount) * GAP_PER_ROW;

  return Math.max(
    DEFAULT_HEIGHT,
    HEADER_ROWS + gridRows + orphanRows + gapRows
  );
}

/**
 * Strip trailing whitespace lines from a captured frame.
 *
 * `captureCharFrame()` returns a string sized to the renderer's
 * full height — empty rows below the last widget are space-filled
 * blanks. Trimming them keeps the printed output compact and
 * stops scrollback from being padded with wasted whitespace.
 */
function trimTrailingBlankLines(frame: string): string {
  const lines = frame.split("\n");
  let lastIdx = lines.length - 1;
  while (lastIdx >= 0) {
    const line = lines[lastIdx];
    if (line === undefined) {
      lastIdx -= 1;
      continue;
    }
    if (line.trim().length > 0) {
      break;
    }
    lastIdx -= 1;
  }
  return lines.slice(0, lastIdx + 1).join("\n");
}

/**
 * Render a dashboard view to a string using OpenTUI's React
 * primitives.
 *
 * Throws if OpenTUI can't be loaded (npm/Node distribution).
 * Callers should catch and fall back to the plain-text formatter.
 *
 * @param data - The dashboard view data with resolved widget query
 *   results.
 * @returns The rendered ANSI-styled string ready to write to
 *   stdout.
 */
export async function renderDashboardTui(
  data: DashboardViewData
): Promise<string> {
  const testing = await import("@opentui/core/testing");
  const reactBindings = await import("@opentui/react");
  const react = await import("react");
  // The `?bridge=1` query string is load-bearing — see the
  // comment on `dashboardAppPath` above.
  const app = (await import(
    `${dashboardAppPath}?bridge=1`
  )) as typeof import("./dashboard-app.js");

  const width = getRenderWidth();
  const height = estimateRenderHeight(data);

  const { renderer, renderOnce, captureCharFrame } =
    await testing.createTestRenderer({
      width,
      height,
      // We capture once and return the string; no animation, no
      // ANSI flush to a real stdout. Disable the threaded render
      // loop so capture happens synchronously after `renderOnce`.
      useThread: false,
    });

  try {
    const root = reactBindings.createRoot(renderer);
    root.render(react.createElement(app.App, { data, termWidth: width }));
    // React's reconciler commits asynchronously and the OpenTUI
    // adapter may queue layout work on top of that. Render twice
    // with a microtask wait between calls — the first
    // `renderOnce()` flushes pending layout effects so the React
    // tree's children are added to `renderer.root`; the second
    // captures the now-fully-laid-out frame. Without this
    // double-render `captureCharFrame()` returns blank rows on
    // slower CI runners (locally a single render usually works
    // because event-loop turns are faster).
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
    await renderOnce();
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
    await renderOnce();
    const frame = captureCharFrame();
    root.unmount();
    return trimTrailingBlankLines(frame);
  } finally {
    // Tear down the renderer so its libuv handles drain even if
    // capture or unmount throw.
    try {
      renderer.destroy();
    } catch {
      // Ignore — destroy is best-effort.
    }
  }
}
