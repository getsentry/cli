/**
 * Dashboard view — OpenTUI React App
 *
 * Renders a `DashboardViewData` snapshot as a React tree built from
 * OpenTUI primitives. Used by `dashboard view` on the Bun-compiled
 * binary; the npm/Node distribution can't load OpenTUI's Zig
 * bindings so it falls back to the plain-text renderer in
 * `dashboard.ts` (the same one that's been there pre-TUI).
 *
 * Layout strategy:
 *
 *   The Sentry dashboard grid is 6 columns wide with widgets at
 *   `(x, y, w, h)` positions in grid units. We approximate it with
 *   nested flex boxes:
 *
 *     - Outer column (`flexDirection="column"`)
 *       - One row group per distinct `y`
 *         - Inner row (`flexDirection="row"`)
 *           - Widgets sorted by `x`, each sized to
 *             `(w / 6) * terminal_width`
 *
 *   This handles the common case where all widgets in a row share
 *   the same `y` and `h`. Widgets with a `y` that doesn't match
 *   any other widget render at their own height in their own row
 *   group — visually they don't overlap with the next row group
 *   the way the plain-text framebuffer's true 2D composition does.
 *   The trade-off: simpler code, slightly different layout for
 *   dashboards that depend on a tall widget spanning multiple row
 *   groups. Most dashboards we've seen are uniform-height per row,
 *   so the approximation lands clean.
 *
 * Per-widget content reuses `renderContentLines()` from
 * `dashboard.ts` — the same helper the plain-text renderer uses,
 * which already handles sparklines, big-number ASCII fonts,
 * tables, and markdown text. OpenTUI's `<text>` strips ANSI from
 * its content string, so we `stripAnsi()` the helper output before
 * dropping it into the React tree and apply colors via the `fg`
 * prop at the per-row level. Colors get less granular (one per
 * row instead of per-segment) but the layout — which is what
 * OpenTUI is buying us — comes out right.
 */

import {
  type DashboardViewData,
  type DashboardViewWidget,
  renderContentLines,
} from "./dashboard.js";
import { stripAnsi } from "./plain-detect.js";

// ────────────────────────── Visual constants ─────────────────────────

/** Sentry brand purple — matches the wizard. */
const ACCENT = "#A77DC3";
/** Muted gray for borders + secondary text. */
const MUTED = "#6E6C7E";
/** Foreground/body text. */
const FOREGROUND = "#E8E6F0";
/** Cyan for series labels and badges. */
const CYAN = "#7DD3FC";
/** Green for big numbers, success states, and bar fills. */
const GREEN = "#86EFAC";
/** Yellow for environment badges. */
const YELLOW = "#FBBF24";
/** Red for errors. */
const ERROR = "#F87171";

/** Sentry dashboard grid columns — must stay in sync with the API. */
const GRID_COLS = 6;

/** Terminal lines per grid height unit (matches the Sentry web grid). */
const LINES_PER_UNIT = 6;

/** Bold attribute bit for OpenTUI's `attributes` prop. */
const BOLD = 1;

// ────────────────────────────── App entry ────────────────────────────

export type AppProps = {
  data: DashboardViewData;
  /** Total terminal width to lay out within. */
  termWidth: number;
};

/**
 * Root component. Renders the dashboard header, then the widget
 * grid stacked underneath.
 */
export function App({ data, termWidth }: AppProps): React.ReactNode {
  return (
    <box flexDirection="column" flexGrow={1}>
      <Header data={data} termWidth={termWidth} />
      <WidgetGrid termWidth={termWidth} widgets={data.widgets} />
    </box>
  );
}

// ─────────────────────────────── Header ──────────────────────────────

/**
 * Compact dashboard header: bold title, cyan period badge, optional
 * yellow environment badge, then a muted underline rule the full
 * width of the terminal.
 */
function Header({
  data,
  termWidth,
}: {
  data: DashboardViewData;
  termWidth: number;
}): React.ReactNode {
  const hasEnv = Boolean(data.environment?.length);
  const envText = hasEnv ? `env: ${data.environment?.join(", ") ?? ""}` : "";
  return (
    <box flexDirection="column" flexShrink={0} marginBottom={1}>
      <text>
        <span attributes={BOLD} fg={FOREGROUND}>
          {data.title}
        </span>
        <span fg={FOREGROUND}>{"  "}</span>
        <span fg={CYAN}>{`[${data.period}]`}</span>
        {hasEnv ? (
          <>
            <span fg={FOREGROUND}>{"  "}</span>
            <span fg={YELLOW}>{envText}</span>
          </>
        ) : null}
      </text>
      <text fg={MUTED}>{"─".repeat(termWidth)}</text>
    </box>
  );
}

// ──────────────────────────── Widget grid ────────────────────────────

/**
 * Group widgets by their grid `y` row, sort each row by `x`, and
 * render the rows top-to-bottom. Widgets without a `layout` are
 * appended at the end as full-width rows — covers older
 * dashboards that pre-date Sentry's grid layout.
 */
function WidgetGrid({
  widgets,
  termWidth,
}: {
  widgets: DashboardViewWidget[];
  termWidth: number;
}): React.ReactNode {
  // Bucket widgets by their starting y position.
  const rows = new Map<number, DashboardViewWidget[]>();
  const orphans: DashboardViewWidget[] = [];

  for (const widget of widgets) {
    if (widget.layout) {
      const key = widget.layout.y;
      const bucket = rows.get(key);
      if (bucket) {
        bucket.push(widget);
      } else {
        rows.set(key, [widget]);
      }
    } else {
      orphans.push(widget);
    }
  }

  // Sort row keys ascending; within a row, widgets sort by x.
  const sortedRowKeys = [...rows.keys()].sort((a, b) => a - b);

  return (
    <box flexDirection="column">
      {sortedRowKeys.map((y) => {
        const rowWidgets = (rows.get(y) ?? []).sort(
          (a, b) => (a.layout?.x ?? 0) - (b.layout?.x ?? 0)
        );
        return (
          <WidgetRow
            key={`row-${y}`}
            termWidth={termWidth}
            widgets={rowWidgets}
          />
        );
      })}
      {orphans.map((widget, i) => (
        <Widget
          // Orphan widgets lack a stable id — index is fine, the
          // list is built once per render from immutable input.
          // biome-ignore lint/suspicious/noArrayIndexKey: positional orphans
          key={`orphan-${i}`}
          widget={widget}
          width={termWidth}
        />
      ))}
    </box>
  );
}

/**
 * One row group (all widgets sharing a `y` start position) laid
 * out side-by-side with proportional widths. `marginBottom={1}`
 * leaves a one-row gap before the next row group so adjacent
 * widget borders don't fuse together.
 */
function WidgetRow({
  widgets,
  termWidth,
}: {
  widgets: DashboardViewWidget[];
  termWidth: number;
}): React.ReactNode {
  return (
    <box flexDirection="row" flexShrink={0} marginBottom={1}>
      {widgets.map((widget) => {
        const w = widget.layout?.w ?? GRID_COLS;
        const widgetWidth = Math.floor((w / GRID_COLS) * termWidth);
        return (
          <Widget
            key={`${widget.layout?.x ?? 0}-${widget.title}`}
            widget={widget}
            width={widgetWidth}
          />
        );
      })}
    </box>
  );
}

// ────────────────────────────── Widget ───────────────────────────────

/**
 * One widget rendered inside a rounded bordered box. The border's
 * `title` prop carries the widget title (Ink-style). Content height
 * is `layout.h * LINES_PER_UNIT` to mirror the Sentry web grid's
 * vertical units.
 */
function Widget({
  widget,
  width,
}: {
  widget: DashboardViewWidget;
  width: number;
}): React.ReactNode {
  const layoutH = widget.layout?.h ?? 1;
  const totalHeight = layoutH * LINES_PER_UNIT;
  // Border accounts for 2 rows; padding of 1 cell on each side
  // matches the visual breathing room the plain-text border
  // wrapper provides.
  const innerWidth = Math.max(0, width - 4);
  const contentHeight = Math.max(0, totalHeight - 2);

  // Get the per-widget content lines from the shared helper. ANSI
  // is stripped because OpenTUI's `<text>` doesn't honor embedded
  // escape codes. Colors come back via the `fg` prop on the row's
  // wrapper component.
  const rawLines = renderContentLines({
    widget,
    innerWidth,
    contentHeight,
  });
  const lines = rawLines.map(stripAnsi);

  return (
    <box
      borderColor={MUTED}
      borderStyle="rounded"
      flexDirection="column"
      flexShrink={0}
      height={totalHeight}
      paddingLeft={1}
      paddingRight={1}
      title={` ${widget.title} `}
      titleAlignment="left"
      width={width}
    >
      <WidgetContentRows
        lines={lines}
        type={widget.data.type}
        widget={widget}
      />
    </box>
  );
}

/**
 * Render the per-widget content lines with colors chosen based on
 * the widget's data type:
 *
 *   - `timeseries` / `table` / `text`: foreground for body, with
 *     the first row of tables drawn bold (the header) and the
 *     second row muted (the separator rule).
 *   - `scalar`: green throughout (matches the chalk-styled output
 *     of the plain-text renderer's big-number font).
 *   - `error`: every row red.
 *   - `unsupported`: every row muted.
 *
 * The plain-text renderer can color individual cells within a row
 * (e.g. cyan label + magenta sparkline + bold value on the same
 * line). OpenTUI's `<text>` is one color per text node, so we lose
 * that per-segment richness here. The trade-off is OpenTUI handles
 * border drawing + grid layout automatically — the win is bigger
 * than the loss.
 */
function WidgetContentRows({
  lines,
  type,
  widget,
}: {
  lines: string[];
  type: DashboardViewWidget["data"]["type"];
  widget: DashboardViewWidget;
}): React.ReactNode {
  const styling = rowStylingFor(type);
  return (
    <box flexDirection="column" flexShrink={0}>
      {lines.map((line, i) => {
        const { fg, attrs } = styling(i, widget);
        return (
          // Content rows are positionally stable for a given widget
          // data snapshot — `renderContentLines` is pure of a given
          // input, so the index makes a fine key.
          // biome-ignore lint/suspicious/noArrayIndexKey: positional rows
          <text attributes={attrs} fg={fg} key={i}>
            {line}
          </text>
        );
      })}
    </box>
  );
}

/**
 * Per-widget-type row styling function. Returns a callback that
 * resolves the `fg` color and `attributes` for a given row index.
 * Some types (e.g. `table`) have row-position-dependent styling
 * (header bold, separator muted, body plain).
 */
function rowStylingFor(type: DashboardViewWidget["data"]["type"]): (
  idx: number,
  widget: DashboardViewWidget
) => {
  fg: string;
  attrs: number;
} {
  if (type === "table") {
    return (idx) => {
      if (idx === 0) {
        return { fg: FOREGROUND, attrs: BOLD };
      }
      if (idx === 1) {
        return { fg: MUTED, attrs: 0 };
      }
      return { fg: FOREGROUND, attrs: 0 };
    };
  }
  if (type === "scalar") {
    return () => ({ fg: GREEN, attrs: BOLD });
  }
  if (type === "error") {
    return () => ({ fg: ERROR, attrs: 0 });
  }
  if (type === "unsupported") {
    return () => ({ fg: MUTED, attrs: 0 });
  }
  if (type === "timeseries") {
    // First row of a vertical-bar timeseries is the header
    // (`<label>  <value>`); subsequent rows are the bar columns.
    // For a sparkline timeseries every row is `<label>  <bars>
    // <value>`. We can't tell which mode `renderContentLines`
    // picked from out here, so default to ACCENT — works for both.
    return () => ({ fg: ACCENT, attrs: 0 });
  }
  // text / default — plain foreground.
  return () => ({ fg: FOREGROUND, attrs: 0 });
}
