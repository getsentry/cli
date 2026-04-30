/**
 * Dashboard view — OpenTUI React App
 *
 * Renders a `DashboardViewData` snapshot as a React tree built from
 * OpenTUI primitives. Used by `dashboard view` on the Bun-compiled
 * binary; the npm/Node distribution can't load OpenTUI's Zig
 * bindings so it falls back to the plain-text renderer in
 * `dashboard.ts` (the same one that's been there pre-TUI).
 *
 * Two render modes:
 *
 *   1. **Static** — mounted via `createTestRenderer` from
 *      `dashboard-tui.ts` for one-shot capture. The keyboard
 *      hooks fire against an off-screen renderer that has no
 *      input source, so they're effectively no-ops; the App
 *      renders the initial store state and we capture it.
 *
 *   2. **Interactive** — mounted via `createCliRenderer` from
 *      `dashboard-runtime.ts` for a live, keyboard-driven session.
 *      The same App reads / mutates the store in response to
 *      user input. Tab cycles widget focus; Enter drills down
 *      on the focused widget; `?` toggles help; `q` / Ctrl+C
 *      dispatches a `quit` action; `t` / `r` / `R` / `o`
 *      dispatch period-change / refresh / auto-refresh-toggle /
 *      browser-open actions for the runtime to service.
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

import { useKeyboard } from "@opentui/react";
import { useSyncExternalStore } from "react";
import {
  type DashboardViewData,
  type DashboardViewWidget,
  renderContentLines,
} from "./dashboard.js";
import type { DashboardStore } from "./dashboard-store.js";
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
/** Yellow for environment badges + auto-refresh ON state. */
const YELLOW = "#FBBF24";
/** Red for errors. */
const ERROR = "#F87171";

/** Sentry dashboard grid columns — must stay in sync with the API. */
const GRID_COLS = 6;

/** Terminal lines per grid height unit (matches the Sentry web grid). */
const LINES_PER_UNIT = 6;

/** Bold attribute bit for OpenTUI's `attributes` prop. */
const BOLD = 1;

// Keyboard handler — extracted to a top-level function so the
// `useKeyboard` callback in `App` stays under the cognitive-
// complexity ceiling biome enforces. Split across three phase
// helpers (`handleEscape`, `handleHelpOverlay`, `handleDrilldown`,
// `handleGridKey`) so each piece owns one overlay's input.
//
// Exported for unit testing — the live `useKeyboard` flow can't
// be exercised from `bun test` without mounting a real renderer,
// so `dashboard-app.handlers.test.ts` calls these directly with
// synthetic events.

export type KeyEventLike = {
  name: string;
  ctrl?: boolean;
  shift?: boolean;
  sequence?: string;
};

export type KeyboardSnapshot = {
  drilldownActive: boolean;
  helpOverlayActive: boolean;
};

/**
 * Top-level keyboard dispatch. Routes the event to the phase
 * handler appropriate for the current overlay state, with two
 * universal short-circuits:
 *
 *   1. **Ctrl+C** — quits unconditionally, regardless of overlay.
 *   2. **Esc** — staged dismissal: close drilldown if active, else
 *      close help, else quit. Mirrors the `vim` / `less` "back
 *      out one layer at a time" convention.
 */
export function handleKey(
  event: KeyEventLike,
  snapshot: KeyboardSnapshot,
  store: DashboardStore
): void {
  if (event.ctrl && event.name === "c") {
    store.dispatch({ kind: "quit" });
    return;
  }
  if (event.name === "escape") {
    handleEscape(snapshot, store);
    return;
  }
  if (snapshot.helpOverlayActive) {
    handleHelpKey(event, store);
    return;
  }
  if (snapshot.drilldownActive) {
    handleDrilldownKey(event, store);
    return;
  }
  handleGridKey(event, store);
}

function handleEscape(snapshot: KeyboardSnapshot, store: DashboardStore): void {
  if (snapshot.drilldownActive) {
    store.exitDrilldown();
    return;
  }
  if (snapshot.helpOverlayActive) {
    store.exitHelp();
    return;
  }
  store.dispatch({ kind: "quit" });
}

function handleHelpKey(event: KeyEventLike, store: DashboardStore): void {
  if (event.name === "?" || event.sequence === "?") {
    store.toggleHelp();
    return;
  }
  if (event.name === "q") {
    store.dispatch({ kind: "quit" });
  }
}

function handleDrilldownKey(event: KeyEventLike, store: DashboardStore): void {
  if (event.name === "return" || event.name === "enter") {
    store.exitDrilldown();
    return;
  }
  if (event.name === "q") {
    store.dispatch({ kind: "quit" });
  }
}

/**
 * Grid-mode bindings. `?` toggles help, `q` quits, Tab/arrows
 * cycle widget focus, Enter drills into the focused widget, and
 * `t` / `r` / `R` / `o` dispatch period-cycle / refresh /
 * auto-refresh-toggle / browser-open actions. Capital R is
 * detected via either `shift: true` or the literal sequence "R"
 * because terminal emulators differ in how they report it.
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: keyboard dispatch is inherently a flat switch over many independent keys; splitting further would just spread one case across multiple files
function handleGridKey(event: KeyEventLike, store: DashboardStore): void {
  const name = event.name;
  if (name === "?" || event.sequence === "?") {
    store.toggleHelp();
    return;
  }
  if (name === "q") {
    store.dispatch({ kind: "quit" });
    return;
  }
  if ((name === "tab" && event.shift) || name === "backtab") {
    store.cycleFocus("backward");
    return;
  }
  if (name === "tab" || name === "right" || name === "down") {
    store.cycleFocus("forward");
    return;
  }
  if (name === "left" || name === "up") {
    store.cycleFocus("backward");
    return;
  }
  if (name === "return" || name === "enter") {
    store.toggleDrilldown();
    return;
  }
  if (name === "t") {
    store.dispatch({ kind: "cycle-period" });
    return;
  }
  if ((name === "r" && event.shift) || event.sequence === "R") {
    store.dispatch({ kind: "toggle-auto-refresh" });
    return;
  }
  if (name === "r") {
    store.dispatch({ kind: "refresh" });
    return;
  }
  if (name === "o") {
    store.dispatch({ kind: "open-in-browser" });
  }
}

// ────────────────────────────── App entry ────────────────────────────

export type AppProps = {
  store: DashboardStore;
  /** Total terminal width to lay out within. */
  termWidth: number;
};

/**
 * Root component. Subscribes once at the top, then drills snapshot
 * fields into presentational children. Holds the global keyboard
 * handler that maps user keystrokes to store mutations or action
 * dispatches.
 *
 * The keyboard handler stays at the App level (rather than per
 * widget) for two reasons:
 *
 *   1. OpenTUI's `useKeyboard` registers with the renderer's global
 *      key bus. Per-widget hooks would all fire for every keystroke
 *      regardless of focus — there's no built-in "focused element
 *      receives input" routing — so we'd need to gate each
 *      handler with `if (focusedIndex === thisIndex)` anyway.
 *   2. The same handler needs to coordinate between focus
 *      navigation, drilldown toggle, help overlay, and action
 *      dispatch, all of which depend on the current overlay state
 *      (e.g. Esc closes drilldown if active, else closes help, else
 *      quits). Centralised handler keeps the priority order
 *      legible.
 */
export function App({ store, termWidth }: AppProps): React.ReactNode {
  const snapshot = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot
  );

  useKeyboard((event) => {
    handleKey(event, snapshot, store);
  });

  // Drilldown takes over the entire screen — header still renders
  // for context but the grid is replaced by the focused widget's
  // expanded content.
  if (snapshot.drilldownActive && snapshot.focusedWidgetIndex >= 0) {
    return (
      <box flexDirection="column" flexGrow={1}>
        <Header
          data={snapshot.data}
          snapshot={snapshot}
          termWidth={termWidth}
        />
        <Drilldown
          termWidth={termWidth}
          widget={snapshot.data.widgets[snapshot.focusedWidgetIndex]}
        />
        <StatusBar snapshot={snapshot} />
      </box>
    );
  }

  return (
    <box flexDirection="column" flexGrow={1}>
      <Header data={snapshot.data} snapshot={snapshot} termWidth={termWidth} />
      <WidgetGrid
        focusedIndex={snapshot.focusedWidgetIndex}
        termWidth={termWidth}
        widgets={snapshot.data.widgets}
      />
      {snapshot.helpOverlayActive ? <HelpOverlay /> : null}
      <StatusBar snapshot={snapshot} />
    </box>
  );
}

// ─────────────────────────────── Header ──────────────────────────────

/**
 * Compact dashboard header: bold title, cyan period badge, optional
 * yellow environment badge, an auto-refresh / fetching indicator
 * when relevant, then a muted underline rule the full width of the
 * terminal.
 *
 * The period shown is `snapshot.currentPeriod` (which the runtime
 * keeps in sync with the most-recent fetch) rather than
 * `data.period` — important when the user cycles via `t` and the
 * data hasn't yet returned.
 */
function Header({
  data,
  snapshot,
  termWidth,
}: {
  data: DashboardViewData;
  snapshot: {
    currentPeriod: string;
    fetching: boolean;
    autoRefreshEnabled: boolean;
  };
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
        <span fg={CYAN}>{`[${snapshot.currentPeriod}]`}</span>
        {hasEnv ? (
          <>
            <span fg={FOREGROUND}>{"  "}</span>
            <span fg={YELLOW}>{envText}</span>
          </>
        ) : null}
        {snapshot.autoRefreshEnabled ? (
          <>
            <span fg={FOREGROUND}>{"  "}</span>
            <span fg={GREEN}>● live</span>
          </>
        ) : null}
        {snapshot.fetching ? (
          <>
            <span fg={FOREGROUND}>{"  "}</span>
            <span fg={ACCENT}>refreshing…</span>
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
 *
 * Threads `focusedIndex` (an index into the original `widgets`
 * array, before bucketing) down to each `Widget` so the focused
 * one gets the accent border treatment.
 */
function WidgetGrid({
  widgets,
  termWidth,
  focusedIndex,
}: {
  widgets: DashboardViewWidget[];
  termWidth: number;
  focusedIndex: number;
}): React.ReactNode {
  // Bucket widgets by their starting y position. Track the
  // original index alongside each entry so we can pass it to the
  // Widget component for focus comparison.
  type Indexed = { widget: DashboardViewWidget; index: number };
  const rows = new Map<number, Indexed[]>();
  const orphans: Indexed[] = [];

  for (const [i, widget] of widgets.entries()) {
    const indexed: Indexed = { widget, index: i };
    if (widget.layout) {
      const key = widget.layout.y;
      const bucket = rows.get(key);
      if (bucket) {
        bucket.push(indexed);
      } else {
        rows.set(key, [indexed]);
      }
    } else {
      orphans.push(indexed);
    }
  }

  const sortedRowKeys = [...rows.keys()].sort((a, b) => a - b);

  return (
    <box flexDirection="column">
      {sortedRowKeys.map((y) => {
        const rowWidgets = (rows.get(y) ?? []).sort(
          (a, b) => (a.widget.layout?.x ?? 0) - (b.widget.layout?.x ?? 0)
        );
        return (
          <WidgetRow
            focusedIndex={focusedIndex}
            key={`row-${y}`}
            termWidth={termWidth}
            widgets={rowWidgets}
          />
        );
      })}
      {orphans.map(({ widget, index }) => (
        <Widget
          focused={focusedIndex === index}
          key={`orphan-${index}`}
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
  focusedIndex,
}: {
  widgets: { widget: DashboardViewWidget; index: number }[];
  termWidth: number;
  focusedIndex: number;
}): React.ReactNode {
  return (
    <box flexDirection="row" flexShrink={0} marginBottom={1}>
      {widgets.map(({ widget, index }) => {
        const w = widget.layout?.w ?? GRID_COLS;
        const widgetWidth = Math.floor((w / GRID_COLS) * termWidth);
        return (
          <Widget
            focused={focusedIndex === index}
            key={`${widget.layout?.x ?? 0}-${widget.title}-${index}`}
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
 *
 * Focused widgets get the accent purple border + bold title so
 * the user can tell at a glance which widget Tab will operate on
 * next. Unfocused widgets stay muted gray — the contrast is the
 * key affordance.
 */
function Widget({
  widget,
  width,
  focused,
}: {
  widget: DashboardViewWidget;
  width: number;
  focused: boolean;
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

  const borderColor = focused ? ACCENT : MUTED;
  const titleText = focused ? `▸ ${widget.title}` : widget.title;

  return (
    <box
      borderColor={borderColor}
      borderStyle="rounded"
      flexDirection="column"
      flexShrink={0}
      height={totalHeight}
      paddingLeft={1}
      paddingRight={1}
      title={` ${titleText} `}
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

// ───────────────────────────── Drilldown ─────────────────────────────

/**
 * Full-screen detail view of a single widget. Replaces the grid
 * when active; the user gets:
 *
 *   - Full terminal width for content (vs. the proportional
 *     fraction the grid view allotted).
 *   - More vertical space for the per-widget content lines —
 *     useful for tables (more rows visible) and timeseries
 *     (taller bar charts).
 *   - The original query info from `widget.queries` rendered
 *     beneath the body so the user can see what's being shown.
 */
function Drilldown({
  widget,
  termWidth,
}: {
  widget: DashboardViewWidget | undefined;
  termWidth: number;
}): React.ReactNode {
  if (!widget) {
    return (
      <box flexDirection="column" flexGrow={1}>
        <text fg={MUTED}>No widget selected.</text>
      </box>
    );
  }

  // Drilldown gets the full main-area width minus 4 cells for the
  // outer border + padding, and a generous height (the runtime
  // sizes the renderer to fit). `renderContentLines` will return
  // as many lines as content needs up to `contentHeight`.
  const innerWidth = Math.max(0, termWidth - 4);
  const contentHeight = 24;
  const rawLines = renderContentLines({
    widget,
    innerWidth,
    contentHeight,
  });
  const lines = rawLines.map(stripAnsi);
  const queryLines = formatQueryLines(widget);

  return (
    <box flexDirection="column" flexGrow={1}>
      <box
        borderColor={ACCENT}
        borderStyle="rounded"
        flexDirection="column"
        flexShrink={0}
        paddingLeft={1}
        paddingRight={1}
        title={` ▸ ${widget.title} `}
        titleAlignment="left"
        width={termWidth}
      >
        <WidgetContentRows
          lines={lines}
          type={widget.data.type}
          widget={widget}
        />
      </box>
      {queryLines.length > 0 ? (
        <box
          borderColor={MUTED}
          borderStyle="rounded"
          flexDirection="column"
          flexShrink={0}
          marginTop={1}
          paddingLeft={1}
          paddingRight={1}
          title=" Queries "
          titleAlignment="left"
          width={termWidth}
        >
          {queryLines.map((line, i) => (
            // Query lines are positional and pure of widget input.
            // biome-ignore lint/suspicious/noArrayIndexKey: positional query rows
            <text fg={MUTED} key={i}>
              {line}
            </text>
          ))}
        </box>
      ) : null}
    </box>
  );
}

/**
 * Format the widget's queries into compact one-liners for the
 * drilldown query panel. Each entry shows the optional name, the
 * conditions, and the comma-separated aggregates / fields. Empty
 * fields are skipped so noisy "name: " prefixes don't show up
 * for unnamed queries.
 */
function formatQueryLines(widget: DashboardViewWidget): string[] {
  if (!widget.queries || widget.queries.length === 0) {
    return [];
  }
  return widget.queries.map((q, i) => {
    const parts: string[] = [];
    if (q.name) {
      parts.push(`[${q.name}]`);
    } else {
      parts.push(`[query ${i + 1}]`);
    }
    if (q.conditions) {
      parts.push(q.conditions);
    }
    const aggregates = (q.aggregates ?? []).filter(Boolean).join(", ");
    if (aggregates) {
      parts.push(`aggregates: ${aggregates}`);
    }
    const columns = (q.columns ?? []).filter(Boolean).join(", ");
    if (columns) {
      parts.push(`columns: ${columns}`);
    }
    return parts.join("  ");
  });
}

// ──────────────────────────── Help overlay ───────────────────────────

/**
 * Help overlay listing the keybindings. Rendered in-flow at the
 * bottom of the App (rather than absolutely positioned) because
 * OpenTUI's flex layout doesn't have a portal primitive. Visually
 * acts as a status panel that pops up when `?` is pressed.
 */
function HelpOverlay(): React.ReactNode {
  const bindings: { key: string; action: string }[] = [
    { key: "Tab / →", action: "Next widget" },
    { key: "Shift+Tab / ←", action: "Previous widget" },
    { key: "Enter", action: "Drill into focused widget" },
    { key: "Esc", action: "Back / quit" },
    { key: "t", action: "Cycle time period" },
    { key: "r", action: "Refresh now" },
    { key: "R", action: "Toggle auto-refresh" },
    { key: "o", action: "Open in browser" },
    { key: "?", action: "Toggle this help" },
    { key: "q / Ctrl+C", action: "Quit" },
  ];
  // The longest key column drives the alignment; +2 cells of
  // padding so the action text breathes.
  const keyWidth = Math.max(...bindings.map((b) => b.key.length)) + 2;
  return (
    <box
      borderColor={ACCENT}
      borderStyle="rounded"
      flexDirection="column"
      flexShrink={0}
      marginTop={1}
      paddingLeft={1}
      paddingRight={1}
      title=" Keybindings "
      titleAlignment="left"
    >
      {bindings.map((b) => (
        <text key={b.key}>
          <span fg={ACCENT}>{b.key.padEnd(keyWidth)}</span>
          <span fg={FOREGROUND}>{b.action}</span>
        </text>
      ))}
    </box>
  );
}

// ───────────────────────────── Status bar ────────────────────────────

/**
 * Compact one-line status bar at the bottom of the screen showing
 * the most useful keybindings. Appears in both grid and drilldown
 * modes (the bindings list adapts).
 *
 * Why pin it to the bottom? Discoverability. Without a visible
 * cue, first-time users won't know they can press `?` to learn
 * about the rest of the keys, and the dashboard would feel like
 * a static page that just happens to take stdin.
 */
function StatusBar({
  snapshot,
}: {
  snapshot: {
    drilldownActive: boolean;
    helpOverlayActive: boolean;
    autoRefreshEnabled: boolean;
    fetchError: string | null;
  };
}): React.ReactNode {
  let hint: string;
  if (snapshot.helpOverlayActive) {
    hint = "Esc / ? to close";
  } else if (snapshot.drilldownActive) {
    hint = "Esc to return  ·  q to quit";
  } else {
    hint =
      "Tab focus  ·  Enter drill  ·  t period  ·  r refresh  ·  R auto  ·  o browser  ·  ? help  ·  q quit";
  }
  return (
    <box
      border={["top"]}
      borderColor={MUTED}
      borderStyle="single"
      flexDirection="row"
      flexShrink={0}
      marginTop={1}
      paddingTop={0}
    >
      <text fg={MUTED}>{hint}</text>
      {snapshot.fetchError ? (
        <text fg={ERROR}>{`  ✖ ${snapshot.fetchError}`}</text>
      ) : null}
    </box>
  );
}
