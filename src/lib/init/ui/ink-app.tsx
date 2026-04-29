/**
 * InkUI React App
 *
 * Renders the wizard layout using Ink (React for CLIs). The component
 * subscribes to a `WizardStore` (see `wizard-store.ts`) via
 * `useSyncExternalStore` so imperative `WizardUI` method calls
 * (`log.info`, `spinner.start`, etc.) trigger React re-renders without
 * React state being the source of truth.
 *
 * Layout (left-aligned columns from outer chrome inwards):
 *
 *   ┌─ sentry init ──────────────────────────────────────────────────┐
 *   │  banner (ASCII)                ╭ Did you know? ─────────╮       │
 *   │  ────────────                  │ <tip title>            │       │
 *   │  ●  log line                   │ <tip body>             │       │
 *   │  ▲  log line                   │ Tip 3 of 12            │       │
 *   │  ◐  spinner...                 ╰────────────────────────╯       │
 *   │                                ╭ Progress (n/m) ────────╮       │
 *   │                                │ ✓ Analyzing project    │       │
 *   │                                │ ▶ Setting up project   │       │
 *   │                                ╰────────────────────────╯       │
 *   │                                ╭ Files analyzed (n/m) ──╮       │
 *   │                                │ ◐ src/                 │       │
 *   │                                │ ✓ package.json         │       │
 *   │                                ╰────────────────────────╯       │
 *   │  <prompt area>                                                  │
 *   └─────────────────────────────────────────────────────────────────┘
 *
 * Why an external store rather than React state owned by the App?
 * The `WizardUI` interface is imperative (the wizard runner calls
 * `ui.log.info(...)` from a generator). Threading those calls through
 * React's state setters from outside React would require keeping a
 * mutable reference to a setter that gets bound on first render —
 * fragile, especially with concurrent mode. An external store keeps
 * the imperative side decoupled from React's lifecycle.
 *
 * Differences from the previous OpenTUI implementation:
 *   - Ink renders to stdout incrementally (no alternate-screen
 *     buffer), so log lines naturally accumulate and get committed to
 *     scrollback as the wizard runs. No post-dispose stderr replay
 *     needed.
 *   - No `<scrollbox>` primitive — the files-read panel windows the
 *     last N rows that fit. Tail-`f` UX comes for free since the
 *     panel re-renders to the bottom of the most-recent reads.
 *   - Multi-select uses Ink's `useInput` directly (no third-party
 *     multi-select component). Single-select uses `ink-select-input`.
 */

import { Box, Text, useInput, useStdout } from "ink";
import Spinner from "ink-spinner";
import { useEffect, useState, useSyncExternalStore } from "react";
import {
  buildFileTree,
  buildReadTree,
  type FileTreeRow,
  flattenTree,
} from "./file-tree.js";
import { SENTRY_TIPS, type SentryTip } from "./sentry-tips.js";
import type { WizardSummary } from "./types.js";
import type {
  ActivePrompt,
  FileReadEntry,
  LogEntry,
  LogSeverity,
  SpinnerState,
  StepEntry,
  WizardStore,
} from "./wizard-store.js";

// ──────────────────────────── Visual constants ────────────────────────

const ACCENT = "magenta";
const MUTED = "gray";

const COLOR_INFO = "cyan";
const COLOR_WARN = "yellow";
const COLOR_ERROR = "red";
const COLOR_SUCCESS = "green";

/** Splits a path on either Unix or Windows separators. Pre-compiled
 *  to satisfy biome's `useTopLevelRegex` lint rule.
 */
const PATH_SEPARATOR_RE = /[\\/]/;

const ICON_BY_SEVERITY: Record<LogSeverity, { glyph: string; color: string }> =
  {
    info: { glyph: "●", color: COLOR_INFO },
    warn: { glyph: "▲", color: COLOR_WARN },
    error: { glyph: "✖", color: COLOR_ERROR },
    success: { glyph: "✔", color: COLOR_SUCCESS },
    message: { glyph: " ", color: "white" },
  };

// ────────────────────────────── App entry ─────────────────────────────

export type AppProps = {
  store: WizardStore;
};

/**
 * Width of the sidebar's outer box. Used both as `width` on the box
 * and as part of the minimum-terminal-width threshold below which we
 * hide the sidebar.
 */
const SIDEBAR_WIDTH = 36;

/**
 * Minimum terminal columns required to show the sidebar alongside the
 * main column. Below this we drop the sidebar entirely so the banner,
 * log lines, and prompts get the full row width.
 *
 * Reasoning: the banner is ~55 chars, the outer chrome eats 4 cols
 * (border + padding), the inner column gap is 2, plus 36 cols for
 * the sidebar → 97. We round up to 100 for breathing room.
 */
const SIDEBAR_BREAKPOINT = 100;

/**
 * Maximum number of files-read rows shown in the sidebar at once.
 * Falls back to a windowed tail when the tree has more entries —
 * Ink doesn't have a built-in scrollbox, but the tail-f UX (last N
 * rows visible) is what the panel needs for an active read sequence.
 *
 * Sized to leave room for the tip card + progress checklist on a
 * 24-row terminal:
 *
 *   24 rows total
 *   - 7 rows  banner + divider
 *   - 12 rows tip card (fixed)
 *   - 9 rows  progress (max visible steps)
 *   - 4 rows  border + padding for the files panel itself
 *   = 8 rows available for file rows. We allow 12 on taller
 *     terminals via the dynamic resize hook below.
 */
const MIN_FILE_ROWS = 4;
const MAX_FILE_ROWS = 14;

/**
 * Root component. Subscribes to the store once at the top, then drills
 * the snapshot fields into individual presentational components.
 *
 * The sidebar auto-hides on narrow terminals (see `SIDEBAR_BREAKPOINT`)
 * — `useStdout()` exposes the live `columns` value so resizing flips
 * the layout on the next render.
 */
export function App({ store }: AppProps): React.ReactNode {
  const snapshot = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot
  );
  const { columns, rows } = useTerminalSize();
  const showSidebar = columns >= SIDEBAR_BREAKPOINT;

  // Global Ctrl+C catcher. In raw mode Node doesn't emit SIGINT for
  // `\x03` — Ink delivers it as `input === "c"` with `key.ctrl` set
  // when a `useInput` listener is mounted. Each prompt's own
  // `useInput` already handles cancellation, but during a spinner
  // (no prompt) there's no input listener at all, so Ctrl+C would
  // otherwise be silently dropped. This top-level listener fills
  // that gap by exiting the process cleanly. Active prompts also
  // see the same input event (Ink dispatches to all `useInput`
  // listeners), and their `prompt.resolve(null)` runs before this
  // exit so the wizard runner's WizardCancelledError propagates.
  useInput((input, key) => {
    if (key.ctrl && input === "c" && !snapshot.prompt) {
      process.exit(130);
    }
  });

  return (
    <Box
      borderColor={MUTED}
      borderStyle="round"
      flexDirection="column"
      paddingX={1}
    >
      <Box flexDirection="row" gap={showSidebar ? 2 : 0}>
        <MainColumn
          bannerRows={snapshot.bannerRows}
          filesRead={snapshot.filesRead}
          logs={snapshot.logs}
          prompt={snapshot.prompt}
          showFileReadInline={!showSidebar}
          spinner={snapshot.spinner}
          summary={snapshot.summary}
        />
        {showSidebar ? (
          <Sidebar
            filesRead={snapshot.filesRead}
            steps={snapshot.steps}
            terminalRows={rows}
            tipIndex={snapshot.tipIndex}
          />
        ) : null}
      </Box>
    </Box>
  );
}

/**
 * Reactive accessor for terminal dimensions. Ink exposes the current
 * stdout via `useStdout()` and emits `resize` on the wrapped stream;
 * we read `columns`/`rows` once and then update on resize.
 *
 * Defaults to 80x24 if Ink couldn't infer dimensions (e.g. when piped
 * through a non-TTY for a test) — those numbers keep the sidebar
 * hidden, which is the safer fallback.
 */
function useTerminalSize(): { columns: number; rows: number } {
  const { stdout } = useStdout();
  const [size, setSize] = useState(() => ({
    columns: stdout?.columns ?? 80,
    rows: stdout?.rows ?? 24,
  }));
  useEffect(() => {
    if (!stdout) {
      return;
    }
    const onResize = () => {
      setSize({
        columns: stdout.columns ?? 80,
        rows: stdout.rows ?? 24,
      });
    };
    stdout.on("resize", onResize);
    return () => {
      stdout.off("resize", onResize);
    };
  }, [stdout]);
  return size;
}

// ──────────────────────────── Main column ─────────────────────────────

type MainColumnProps = {
  bannerRows: { content: string; color: string }[];
  filesRead: FileReadEntry[];
  logs: LogEntry[];
  spinner: SpinnerState;
  prompt: ActivePrompt | null;
  summary: WizardSummary | null;
  /**
   * Whether to render the inline file-read status row above the
   * spinner. We only show this when the sidebar is hidden (narrow
   * terminals); otherwise the sidebar's `FilesPanel` gives a richer
   * tree view and the inline row would be a noisy duplicate.
   */
  showFileReadInline: boolean;
};

function MainColumn({
  bannerRows,
  filesRead,
  logs,
  spinner,
  prompt,
  summary,
  showFileReadInline,
}: MainColumnProps): React.ReactNode {
  // Hide the file-read status once the wizard finishes — the summary
  // panel is the canonical "what happened" surface at that point, and
  // a stale "47 files analyzed" line below it would just be noise.
  const showFileStatus = showFileReadInline && !summary && filesRead.length > 0;
  return (
    <Box flexDirection="column" flexGrow={1}>
      <Header bannerRows={bannerRows} />
      <Divider />
      <Box flexDirection="column">
        {logs.map((log) => (
          <LogLine entry={log} key={log.id} />
        ))}
      </Box>
      {showFileStatus ? <FileReadStatus filesRead={filesRead} /> : null}
      {spinner.active ? <SpinnerRow state={spinner} /> : null}
      {summary ? <SummaryPanel summary={summary} /> : null}
      {prompt ? <PromptArea prompt={prompt} /> : null}
    </Box>
  );
}

function Header({
  bannerRows,
}: {
  bannerRows: { content: string; color: string }[];
}): React.ReactNode {
  return (
    <Box flexDirection="column" flexShrink={0}>
      {bannerRows.map((row, i) => (
        // ASCII banner rows are positional, stable, and never re-ordered —
        // the index key is correct here.
        // biome-ignore lint/suspicious/noArrayIndexKey: positional banner rows
        <Text color={row.color} key={i}>
          {row.content}
        </Text>
      ))}
    </Box>
  );
}

function Divider(): React.ReactNode {
  return (
    <Box marginBottom={1} marginTop={1}>
      <Text color={MUTED}>{"─".repeat(50)}</Text>
    </Box>
  );
}

function LogLine({ entry }: { entry: LogEntry }): React.ReactNode {
  const { glyph, color } = ICON_BY_SEVERITY[entry.severity];
  return (
    <Box flexDirection="row" flexShrink={0}>
      <Box width={3}>
        <Text color={color}>{glyph}</Text>
      </Box>
      <Text>{entry.text}</Text>
    </Box>
  );
}

function SpinnerRow({ state }: { state: SpinnerState }): React.ReactNode {
  return (
    <Box flexDirection="row" flexShrink={0} marginTop={1}>
      <Box width={3}>
        <Text color={ACCENT}>
          <Spinner type="dots" />
        </Text>
      </Box>
      <Text>{state.message}</Text>
    </Box>
  );
}

/**
 * Single-line file-read status, shown above the spinner ONLY when the
 * sidebar is hidden (narrow terminals). The richer tree view in the
 * sidebar's `FilesPanel` supersedes this when there's room.
 *
 * Rendering rules:
 *   - If any file is currently `reading`: show a yellow ● glyph plus
 *     up to two recent basenames and the running counter.
 *   - Otherwise: collapse to a green ✔ recap.
 */
function FileReadStatus({
  filesRead,
}: {
  filesRead: FileReadEntry[];
}): React.ReactNode {
  const reading = filesRead.filter((entry) => entry.status === "reading");
  const analyzed = filesRead.length - reading.length;

  if (reading.length > 0) {
    const recent = reading
      .slice(-2)
      .map((entry) => entry.path.split(PATH_SEPARATOR_RE).at(-1) ?? entry.path);
    const overflow = reading.length - recent.length;
    const namesPart =
      overflow > 0
        ? `${recent.join(", ")} + ${overflow} more`
        : recent.join(", ");
    return (
      <Box flexDirection="row" flexShrink={0} marginTop={1}>
        <Box width={3}>
          <Text color={COLOR_WARN}>●</Text>
        </Box>
        <Box flexGrow={1}>
          <Text>Reading {namesPart}</Text>
        </Box>
        <Text color={MUTED}>
          {analyzed}/{filesRead.length} analyzed
        </Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="row" flexShrink={0} marginTop={1}>
      <Box width={3}>
        <Text color={COLOR_SUCCESS}>✔</Text>
      </Box>
      <Text color={MUTED}>
        Analyzed {analyzed} {analyzed === 1 ? "file" : "files"}
      </Text>
    </Box>
  );
}

// ────────────────────────────── Summary ───────────────────────────────

/**
 * Compact summary panel rendered after the workflow finishes. Each
 * field is a single row: small dim label cell followed by the value.
 * Changed-files render as a tree below the field list.
 */
function SummaryPanel({
  summary,
}: {
  summary: WizardSummary;
}): React.ReactNode {
  return (
    <Box
      borderBottom={false}
      borderColor={MUTED}
      borderLeft={false}
      borderRight={false}
      borderStyle="single"
      flexDirection="column"
      flexShrink={0}
      marginTop={1}
      paddingTop={1}
    >
      {summary.fields.length > 0 ? (
        <Box flexDirection="column" flexShrink={0}>
          {summary.fields.map((field) => (
            <Box flexDirection="row" flexShrink={0} key={field.label}>
              <Box width={12}>
                <Text color={MUTED}>{field.label}</Text>
              </Box>
              <Text>{field.value}</Text>
            </Box>
          ))}
        </Box>
      ) : null}
      {summary.changedFiles !== undefined && summary.changedFiles.length > 0 ? (
        <ChangedFilesTree files={summary.changedFiles} />
      ) : null}
    </Box>
  );
}

/**
 * Render the changed-files list as a nested directory tree.
 * Tree-shape computation lives in `file-tree.ts`; this component is
 * purely presentational.
 */
function ChangedFilesTree({
  files,
}: {
  files: { action: string; path: string }[];
}): React.ReactNode {
  const tree = buildFileTree(files);
  const rows = flattenTree(tree);
  return (
    <Box flexDirection="column" flexShrink={0} marginTop={1}>
      <Text color={MUTED}>Changed files</Text>
      {rows.map((row, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: positional tree rows
        <FileTreeLine key={i} row={row} />
      ))}
    </Box>
  );
}

function FileTreeLine({ row }: { row: FileTreeRow }): React.ReactNode {
  if (row.kind === "directory") {
    return (
      <Box flexDirection="row" flexShrink={0}>
        <Text color={MUTED}>{`${row.prefix}${row.branch} `}</Text>
        <Text>{row.label}</Text>
      </Box>
    );
  }
  const { glyph, color } = changedFileStyle(row.action ?? "modify");
  return (
    <Box flexDirection="row" flexShrink={0}>
      <Text color={MUTED}>{`${row.prefix}${row.branch} `}</Text>
      <Text color={color}>{`${glyph} `}</Text>
      <Text>{row.label}</Text>
    </Box>
  );
}

function changedFileStyle(action: string): { glyph: string; color: string } {
  if (action === "create") {
    return { glyph: "+", color: COLOR_SUCCESS };
  }
  if (action === "delete") {
    return { glyph: "−", color: COLOR_ERROR };
  }
  return { glyph: "~", color: COLOR_WARN };
}

// ─────────────────────────────── Prompts ──────────────────────────────

function PromptArea({ prompt }: { prompt: ActivePrompt }): React.ReactNode {
  if (prompt.kind === "select") {
    return <SelectPrompt prompt={prompt} />;
  }
  return <MultiSelectPrompt prompt={prompt} />;
}

/**
 * Single-select prompt rendered via Ink's `useInput` directly
 * (rather than through `ink-select-input`).
 *
 * Why hand-rolled?
 *   - `ink-select-input`'s items array is recreated on every parent
 *     render, which races with its internal `useEffect` that resets
 *     `selectedIndex` on items-change. Under our store-driven
 *     re-render cadence (tip rotation, log lines, file-read
 *     updates) the cursor would never settle and arrow keys felt
 *     unresponsive.
 *   - Sharing the rendering pattern with {@link MultiSelectPrompt}
 *     keeps the visual styling consistent: same cursor glyph,
 *     same accent color, same hint placement.
 *
 * Keyboard:
 *   - up/down  → move the cursor (wraps top↔bottom)
 *   - enter    → commit the highlighted option
 */
function SelectPrompt({
  prompt,
}: {
  prompt: Extract<ActivePrompt, { kind: "select" }>;
}): React.ReactNode {
  const totalCount = prompt.options.length;
  const [highlighted, setHighlighted] = useState<number>(() =>
    Math.min(Math.max(prompt.initialIndex, 0), Math.max(0, totalCount - 1))
  );

  useInput((input, key) => {
    if (key.upArrow) {
      setHighlighted((idx) => (idx === 0 ? totalCount - 1 : idx - 1));
      return;
    }
    if (key.downArrow) {
      setHighlighted((idx) => (idx + 1) % totalCount);
      return;
    }
    if (key.escape || (key.ctrl && input === "c")) {
      // Cooperative cancel — Esc, or Ctrl+C in raw mode where Node
      // doesn't deliver SIGINT. Resolves the prompt with `null`,
      // which the bridge translates to `CANCELLED` and the wizard
      // runner unwinds via `WizardCancelledError`.
      prompt.resolve(null);
      return;
    }
    if (key.return) {
      const current = prompt.options[highlighted];
      if (current) {
        prompt.resolve(current.value);
      }
    }
  });

  return (
    <Box flexDirection="column" flexShrink={0} gap={1} marginTop={1}>
      <Text>{prompt.message}</Text>
      <Box flexDirection="column">
        {prompt.options.map((option, idx) => {
          const isCursor = idx === highlighted;
          let cursor = " ";
          let labelColor = MUTED;
          if (isCursor) {
            cursor = "›";
            labelColor = "white";
          }
          return (
            <Box flexDirection="row" key={option.value}>
              <Box width={2}>
                <Text color={ACCENT}>{cursor}</Text>
              </Box>
              <Text color={labelColor}>{option.label}</Text>
              {option.hint !== undefined && option.hint !== "" ? (
                <Text color={MUTED}> {option.hint}</Text>
              ) : null}
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}

/**
 * Multi-select uses local state to track the toggled values plus the
 * currently-highlighted row. On every keystroke `useInput` runs:
 *   - up/down → move the cursor
 *   - space   → flip the highlighted option in the selection set
 *   - enter   → commit the current selection
 *
 * We render the list manually rather than reusing `ink-select-input`
 * because that component doesn't expose a way to draw bracketed
 * `[✔]` markers for selected items in addition to the cursor.
 */
function MultiSelectPrompt({
  prompt,
}: {
  prompt: Extract<ActivePrompt, { kind: "multiselect" }>;
}): React.ReactNode {
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(prompt.initialSelected)
  );
  const [highlighted, setHighlighted] = useState<number>(0);
  const totalCount = prompt.options.length;

  const toggleAt = (idx: number) => {
    const current = prompt.options[idx];
    if (!current) {
      return;
    }
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(current.value)) {
        next.delete(current.value);
      } else {
        next.add(current.value);
      }
      return next;
    });
  };

  const commit = () => {
    if (prompt.required && selected.size === 0) {
      return;
    }
    // Preserve source option order in the returned array.
    const ordered = prompt.options
      .map((option) => option.value)
      .filter((value) => selected.has(value));
    prompt.resolve(ordered);
  };

  useInput((input, key) => {
    if (key.upArrow) {
      setHighlighted((idx) => (idx === 0 ? totalCount - 1 : idx - 1));
      return;
    }
    if (key.downArrow) {
      setHighlighted((idx) => (idx + 1) % totalCount);
      return;
    }
    if (key.escape || (key.ctrl && input === "c")) {
      // Cooperative cancel — Esc, or Ctrl+C in raw mode where Node
      // doesn't deliver SIGINT. Resolves with `null`, which the
      // bridge translates to `CANCELLED`.
      prompt.resolve(null);
      return;
    }
    if (input === " ") {
      toggleAt(highlighted);
      return;
    }
    if (key.return) {
      commit();
    }
  });

  return (
    <Box flexDirection="column" flexShrink={0} gap={1} marginTop={1}>
      <Text>{prompt.message}</Text>
      <Box flexDirection="row" gap={2}>
        <Text color={MUTED}>space toggle · enter confirm · esc cancel</Text>
        <Text color={ACCENT}>
          {selected.size}/{totalCount} selected
        </Text>
      </Box>
      <Box flexDirection="column">
        {prompt.options.map((option, idx) => {
          const isSelected = selected.has(option.value);
          const isCursor = idx === highlighted;
          let marker = "[ ]";
          let markerColor = MUTED;
          if (isSelected) {
            marker = "[✔]";
            markerColor = COLOR_SUCCESS;
          }
          let cursor = " ";
          if (isCursor) {
            cursor = "›";
          }
          return (
            <Box flexDirection="row" key={option.value}>
              <Box width={2}>
                <Text color={ACCENT}>{cursor}</Text>
              </Box>
              <Text color={markerColor}>{marker}</Text>
              <Text> {option.label}</Text>
              {option.hint !== undefined && option.hint !== "" ? (
                <Text color={MUTED}> {option.hint}</Text>
              ) : null}
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}

// ────────────────────────────── Sidebar ───────────────────────────────

/**
 * The sidebar stacks three panels top-to-bottom:
 *
 *   1. {@link TipPanel}      — fixed height, pinned. Can never be
 *      squashed by the panels below.
 *   2. {@link ProgressPanel} — auto height, one row per visible step.
 *   3. {@link FilesPanel}    — windowed tail of the read-files tree.
 *
 * On narrow terminals (`columns < SIDEBAR_BREAKPOINT`) the parent
 * App hides the whole sidebar; the inline `FileReadStatus` line in
 * `MainColumn` takes over the file-read indicator role.
 */
function Sidebar({
  tipIndex,
  steps,
  filesRead,
  terminalRows,
}: {
  tipIndex: number;
  steps: StepEntry[];
  filesRead: FileReadEntry[];
  terminalRows: number;
}): React.ReactNode {
  // Reserve space for the tip card (~9 rows including its border)
  // and the progress checklist (steps + 3 rows of border + title).
  // Whatever remains, clamped between MIN/MAX_FILE_ROWS, goes to
  // the files panel as its viewport.
  const tipReserved = 9;
  const progressReserved = steps.length + 3;
  const fileBudget = Math.max(
    MIN_FILE_ROWS,
    Math.min(MAX_FILE_ROWS, terminalRows - tipReserved - progressReserved - 2)
  );
  // No `gap` between panels — the rounded borders touch edge-to-edge,
  // which reads as a single chrome region rather than three floating
  // cards with empty rows between them.
  return (
    <Box flexDirection="column" flexShrink={0} width={SIDEBAR_WIDTH}>
      <TipPanel tipIndex={tipIndex} />
      <ProgressPanel steps={steps} />
      <FilesPanel filesRead={filesRead} maxRows={fileBudget} />
    </Box>
  );
}

function TipPanel({ tipIndex }: { tipIndex: number }): React.ReactNode {
  const tip = SENTRY_TIPS[tipIndex % SENTRY_TIPS.length] as SentryTip;
  const total = SENTRY_TIPS.length;
  const oneIndexed = (tipIndex % total) + 1;
  // The rounded box's top border carries the title (Ink's `title`
  // prop). Body and counter follow with no inner margins — the
  // border + 1-cell padding on each side already separates the
  // content from the chrome.
  return (
    <Box
      borderColor={MUTED}
      borderStyle="round"
      flexDirection="column"
      flexShrink={0}
      paddingX={1}
    >
      <Text bold color={ACCENT}>
        {tip.title}
      </Text>
      <Text>{tip.body}</Text>
      <Text color={MUTED}>
        Tip {oneIndexed} of {total} · Did you know?
      </Text>
    </Box>
  );
}

/**
 * Static checklist of workflow steps. Each row reflects a
 * `StepEntry.status`:
 *
 *   - `pending`     — muted ◯
 *   - `in_progress` — accent ▶
 *   - `completed`   — success ✓
 *   - `skipped`     — muted ◌ (lighter than pending)
 *   - `failed`      — error ✖
 */
function ProgressPanel({ steps }: { steps: StepEntry[] }): React.ReactNode {
  const completedCount = steps.filter(
    (entry) => entry.status === "completed"
  ).length;
  const totalCount = steps.length;
  return (
    <Box
      borderColor={MUTED}
      borderStyle="round"
      flexDirection="column"
      flexShrink={0}
      paddingX={1}
    >
      <Text bold color={ACCENT}>
        Progress ({completedCount}/{totalCount})
      </Text>
      {steps.map((entry) => (
        <ProgressRow entry={entry} key={entry.id} />
      ))}
    </Box>
  );
}

function ProgressRow({ entry }: { entry: StepEntry }): React.ReactNode {
  const { glyph, glyphColor, label } = progressStyle(entry);
  return (
    <Box flexDirection="row" flexShrink={0}>
      <Box width={2}>
        <Text color={glyphColor}>{glyph}</Text>
      </Box>
      <Text color={label}>{entry.label}</Text>
    </Box>
  );
}

function progressStyle(entry: StepEntry): {
  glyph: string;
  glyphColor: string;
  label: string;
} {
  if (entry.status === "in_progress") {
    return { glyph: "▶", glyphColor: ACCENT, label: "white" };
  }
  if (entry.status === "completed") {
    return { glyph: "✓", glyphColor: COLOR_SUCCESS, label: MUTED };
  }
  if (entry.status === "failed") {
    return { glyph: "✖", glyphColor: COLOR_ERROR, label: COLOR_ERROR };
  }
  if (entry.status === "skipped") {
    return { glyph: "◌", glyphColor: MUTED, label: MUTED };
  }
  // pending
  return { glyph: "◯", glyphColor: MUTED, label: MUTED };
}

/**
 * Read-files tree. Ink doesn't have a scrollbox primitive, so when
 * the tree exceeds `maxRows` we render the **last** N rows (a
 * tail-`f`-style window). For most runs the tree fits without
 * truncation; long analyze sequences just push older entries off
 * the top while keeping the active reads visible.
 *
 * Visual rules:
 *   - Directories: muted gray box-drawing branches + name with `/`.
 *   - Active reads (`status === "reading"`): magenta `◐` glyph,
 *     normal-color filename. The eye picks these out instantly.
 *   - Analyzed (`status === "analyzed"`): green `✓` glyph, dimmed
 *     filename. Done work recedes; in-flight work pops.
 *
 * Hidden until at least one file has been recorded — the empty box
 * would just be visual noise during the auth/discover phase.
 */
/**
 * Render the read-files tree inside a fixed-height viewport that
 * acts like a tail-`f` window: the most recent rows are always
 * visible, with a `↑ N earlier` indicator at the top when older
 * rows have scrolled out of view.
 *
 * Why no real scroller? Ink doesn't ship a native scrollbox
 * primitive, and a third-party one would mean wiring focus
 * management (PgUp/PgDn while a prompt is mounted, etc.) — too
 * much complexity for what's effectively a status indicator.
 * Tail-window UX matches what the user actually wants: see what
 * the wizard is reading right now.
 */
function FilesPanel({
  filesRead,
  maxRows,
}: {
  filesRead: FileReadEntry[];
  maxRows: number;
}): React.ReactNode {
  if (filesRead.length === 0) {
    return null;
  }
  const tree = buildReadTree(filesRead);
  const rows = flattenTree(tree);
  // The header takes 1 row of the panel's vertical budget; reserve
  // it so the file rows don't get squeezed.
  const fileRowBudget = Math.max(1, maxRows - 1);
  const truncated = rows.length > fileRowBudget;
  // When truncated, the truncation indicator itself takes one row,
  // so the actual visible file count is one less.
  const visibleFileRows = truncated ? fileRowBudget - 1 : fileRowBudget;
  const visible = truncated ? rows.slice(rows.length - visibleFileRows) : rows;
  const hidden = rows.length - visible.length;
  const analyzedCount = filesRead.filter(
    (entry) => entry.status === "analyzed"
  ).length;
  return (
    <Box
      borderColor={MUTED}
      borderStyle="round"
      flexDirection="column"
      flexShrink={0}
      paddingX={1}
    >
      <Text bold color={ACCENT}>
        Files analyzed ({analyzedCount}/{filesRead.length})
      </Text>
      {truncated ? (
        <Text color={MUTED}>↑ {hidden} earlier (scrolled)</Text>
      ) : null}
      {visible.map((row, i) => (
        // Tree rows are positionally stable for a given filesRead
        // snapshot — `buildReadTree` walks `filesRead` in insertion
        // order and never reorders, so the index makes a fine key.
        // biome-ignore lint/suspicious/noArrayIndexKey: positional read-tree rows
        <ReadTreeLine key={i} row={row} />
      ))}
    </Box>
  );
}

function ReadTreeLine({ row }: { row: FileTreeRow }): React.ReactNode {
  if (row.kind === "directory") {
    return (
      <Box flexDirection="row" flexShrink={0}>
        <Text color={MUTED}>{`${row.prefix}${row.branch} `}</Text>
        <Text>{row.label}</Text>
      </Box>
    );
  }
  const { glyph, glyphColor, labelColor } = readStatusStyle(row.status);
  return (
    <Box flexDirection="row" flexShrink={0}>
      <Text color={MUTED}>{`${row.prefix}${row.branch} `}</Text>
      <Text color={glyphColor}>{`${glyph} `}</Text>
      <Text color={labelColor}>{row.label}</Text>
    </Box>
  );
}

function readStatusStyle(status: FileTreeRow["status"]): {
  glyph: string;
  glyphColor: string;
  labelColor: string;
} {
  if (status === "reading") {
    return { glyph: "◐", glyphColor: ACCENT, labelColor: "white" };
  }
  return { glyph: "✓", glyphColor: COLOR_SUCCESS, labelColor: MUTED };
}
