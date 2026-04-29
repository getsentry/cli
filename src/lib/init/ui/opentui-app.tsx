/**
 * OpenTuiUI React App
 *
 * Renders the full-screen wizard layout. The component subscribes to a
 * `WizardStore` (see `opentui-store.ts`) via `useSyncExternalStore` so
 * imperative `WizardUI` method calls (`log.info`, `spinner.start`,
 * etc.) trigger React re-renders without React state being the source
 * of truth.
 *
 * Layout (left-aligned columns from outer chrome inwards):
 *
 *   ┌─ Sentry init ──────────────────────────────────────────────────┐
 *   │  ╔═══════════════════════════╗  ╔══════════════════════════╗   │
 *   │  ║  banner                   ║  ║  Did you know?           ║   │
 *   │  ║  ──────────                ║  ║  ──────────────          ║   │
 *   │  ║  ●  log line              ║  ║  <tip title>             ║   │
 *   │  ║  ▲  log line              ║  ║  <tip body, wrapped>     ║   │
 *   │  ║  ◐  Reading foo.ts (3)    ║  ║                          ║   │
 *   │  ║  ◒  spinner...            ║  ║  Tip 3 of 12             ║   │
 *   │  ║  <prompt area>            ║  ╚══════════════════════════╝   │
 *   │  ╚═══════════════════════════╝                                 │
 *   └────────────────────────────────────────────────────────────────┘
 *
 * The file-read status line is a single transient row above the
 * spinner — replaces the previous bordered "Files analyzed" panel
 * that pushed the tip card off-screen on shorter terminals.
 *
 * Why an external store rather than React state owned by the App?
 * The `WizardUI` interface is imperative (the wizard runner calls
 * `ui.log.info(...)` from a generator). Threading those calls through
 * React's state setters from outside React would require keeping a
 * mutable reference to a setter that gets bound on first render —
 * fragile, especially with concurrent mode. An external store keeps
 * the imperative side decoupled from React's lifecycle.
 */

import { basename } from "node:path";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useState, useSyncExternalStore } from "react";
import {
  buildFileTree,
  buildReadTree,
  type FileTreeRow,
  flattenTree,
} from "./file-tree.js";
import type {
  ActivePrompt,
  FileReadEntry,
  LogEntry,
  LogSeverity,
  SpinnerState,
  StepEntry,
  WizardStore,
} from "./opentui-store.js";
import { SENTRY_TIPS, type SentryTip } from "./sentry-tips.js";
import type { WizardSummary } from "./types.js";

// ──────────────────────────── Visual constants ────────────────────────

const ACCENT = "#A77DC3";
const MUTED = "#6E6C7E";
const FOREGROUND = "#E8E6F0";

const COLOR_INFO = "#7DD3FC";
const COLOR_WARN = "#FBBF24";
const COLOR_ERROR = "#F87171";
const COLOR_SUCCESS = "#86EFAC";

const SPINNER_FRAMES = process.platform.startsWith("win")
  ? ["●", "o", "O", "0"]
  : ["◒", "◐", "◓", "◑"];

const ICON_BY_SEVERITY: Record<LogSeverity, { glyph: string; color: string }> =
  {
    info: { glyph: "●", color: COLOR_INFO },
    warn: { glyph: "▲", color: COLOR_WARN },
    error: { glyph: "✖", color: COLOR_ERROR },
    success: { glyph: "✔", color: COLOR_SUCCESS },
    message: { glyph: " ", color: FOREGROUND },
  };

// ────────────────────────────── App entry ─────────────────────────────

export type AppProps = {
  store: WizardStore;
};

/**
 * Width of the sidebar's outer box, including its border + padding.
 * Used both as the renderable's `width` prop and as part of the
 * minimum-terminal-width threshold below which we hide the sidebar.
 */
const SIDEBAR_WIDTH = 36;

/**
 * Minimum terminal columns required to show the sidebar alongside the
 * main column. Below this we drop the sidebar entirely so the banner,
 * log lines, and prompts get the full row width.
 *
 * Reasoning: the banner is ~55 chars wide, the outer wizard chrome
 * eats 2 cols of border + 2 cols of padding (4 total), the inner gap
 * between columns is 2, plus the sidebar's own 36 cols → 55 + 4 + 2 +
 * 36 = 97. We round up slightly to leave room for prompts and longer
 * log lines without wrapping ugly.
 */
const SIDEBAR_BREAKPOINT = 100;

/**
 * Fixed height for the tip card. Pinned (rather than `flexGrow`) so
 * the panels below it (progress checklist, files-read tree) can never
 * push the tip out of view as more content streams in. Sized to fit:
 *
 *   1 row  – top border
 *   1 row  – top padding
 *   1 row  – tip title
 *   1 row  – gap
 *   4 rows – tip body (wrapping room)
 *   1 row  – bottom padding (filler before counter)
 *   1 row  – "Tip n of N" counter
 *   1 row  – bottom padding
 *   1 row  – bottom border
 *
 * Bumping this knob is cheap; no other layout depends on it directly.
 */
const TIP_PANEL_HEIGHT = 12;

/**
 * Root component. Subscribes to the store once at the top, then drills
 * the snapshot fields into individual presentational components.
 *
 * The sidebar auto-hides on narrow terminals (see `SIDEBAR_BREAKPOINT`)
 * — `useTerminalDimensions` re-renders on resize, so dragging a
 * window between widths flips the layout live.
 */
export function App({ store }: AppProps): React.ReactNode {
  const snapshot = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot
  );
  const { width } = useTerminalDimensions();
  const showSidebar = width >= SIDEBAR_BREAKPOINT;

  return (
    <box
      borderColor={MUTED}
      borderStyle="rounded"
      flexDirection="column"
      flexGrow={1}
      padding={1}
      title=" sentry init "
      titleAlignment="left"
    >
      <box flexDirection="row" flexGrow={1} gap={showSidebar ? 2 : 0}>
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
            tipIndex={snapshot.tipIndex}
          />
        ) : null}
      </box>
    </box>
  );
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
    <box flexDirection="column" flexGrow={1}>
      <Header bannerRows={bannerRows} />
      <Divider />
      <box flexDirection="column" flexGrow={1}>
        {logs.map((log) => (
          <LogLine entry={log} key={log.id} />
        ))}
      </box>
      {showFileStatus ? <FileReadStatus filesRead={filesRead} /> : null}
      {spinner.active ? <SpinnerRow state={spinner} /> : null}
      {summary ? <SummaryPanel summary={summary} /> : null}
      {prompt ? <PromptArea prompt={prompt} /> : null}
    </box>
  );
}

function Header({
  bannerRows,
}: {
  bannerRows: { content: string; color: string }[];
}): React.ReactNode {
  // The box already advertises "sentry init" in its top border title,
  // and the banner itself reads "SENTRY", so we don't repeat the
  // command name underneath the banner. Earlier versions had an
  // intro line here ("▸ sentry init") which felt redundant.
  return (
    <box flexDirection="column" flexShrink={0}>
      {bannerRows.map((row, i) => (
        // ASCII banner rows are positional, stable, and never re-ordered —
        // the index key is correct here.
        // biome-ignore lint/suspicious/noArrayIndexKey: positional banner rows
        <text fg={row.color} key={i}>
          {row.content}
        </text>
      ))}
    </box>
  );
}

function Divider(): React.ReactNode {
  return (
    <box
      border={["top"]}
      borderColor={MUTED}
      borderStyle="single"
      flexShrink={0}
      height={1}
      marginBottom={1}
      marginTop={1}
    />
  );
}

function LogLine({ entry }: { entry: LogEntry }): React.ReactNode {
  const { glyph, color } = ICON_BY_SEVERITY[entry.severity];
  return (
    <box flexDirection="row" flexShrink={0}>
      <text fg={color} width={3}>
        {glyph}
      </text>
      <text fg={FOREGROUND} flexGrow={1}>
        {entry.text}
      </text>
    </box>
  );
}

function SpinnerRow({ state }: { state: SpinnerState }): React.ReactNode {
  const frame =
    SPINNER_FRAMES[state.frame % SPINNER_FRAMES.length] ??
    SPINNER_FRAMES[0] ??
    "•";
  return (
    <box flexDirection="row" flexShrink={0} marginTop={1}>
      <text fg={ACCENT} width={3}>
        {frame}
      </text>
      <text fg={FOREGROUND} flexGrow={1}>
        {state.message}
      </text>
    </box>
  );
}

/**
 * Single-line file-read status, shown above the spinner. Replaces the
 * old bordered "Files analyzed" sidebar panel which had a fixed
 * `flexShrink={0}` height of ~13 rows and pushed the tip card off-
 * screen on shorter terminals.
 *
 * Rendering rules:
 *   - If any file is currently `reading`: show a yellow ● glyph plus
 *     up to two recent basenames and the running counter, e.g.
 *     `● Reading package.json, sentry.config.ts (3/12 analyzed)`.
 *   - Otherwise: collapse to a green ✔ recap, e.g.
 *     `✔ Analyzed 12 files`.
 *
 * The component never wraps to a second line — long basenames are
 * truncated by the terminal, which is fine: the goal is a glance-able
 * indicator, not a log.
 */
function FileReadStatus({
  filesRead,
}: {
  filesRead: FileReadEntry[];
}): React.ReactNode {
  const reading = filesRead.filter((entry) => entry.status === "reading");
  const analyzed = filesRead.length - reading.length;

  if (reading.length > 0) {
    // Show the most-recent 2 basenames being read; anything more turns
    // into a `+ N more` hint so the line stays single-row.
    const recent = reading.slice(-2).map((entry) => basename(entry.path));
    const overflow = reading.length - recent.length;
    const namesPart =
      overflow > 0
        ? `${recent.join(", ")} + ${overflow} more`
        : recent.join(", ");
    return (
      <box flexDirection="row" flexShrink={0} marginTop={1}>
        <text fg={COLOR_WARN} width={3}>
          ●
        </text>
        <text fg={FOREGROUND} flexGrow={1}>
          Reading {namesPart}
        </text>
        <text fg={MUTED}>
          {analyzed}/{filesRead.length} analyzed
        </text>
      </box>
    );
  }

  return (
    <box flexDirection="row" flexShrink={0} marginTop={1}>
      <text fg={COLOR_SUCCESS} width={3}>
        ✔
      </text>
      <text fg={MUTED} flexGrow={1}>
        Analyzed {analyzed} {analyzed === 1 ? "file" : "files"}
      </text>
    </box>
  );
}

// ────────────────────────────── Summary ───────────────────────────────

/**
 * Compact summary panel rendered after the workflow finishes. Replaces
 * the old approach of pushing pre-rendered markdown through
 * `ui.log.message`, which OpenTuiUI couldn't display correctly because
 * it strips ANSI and shows tag literals like `<yellow>~</yellow>`.
 *
 * Each field is a single row: small dim label cell followed by the
 * value. Changed-files get a one-line-per-file rendering with an
 * action glyph (+ ~ −).
 */
function SummaryPanel({
  summary,
}: {
  summary: WizardSummary;
}): React.ReactNode {
  return (
    <box
      border={["top"]}
      borderColor={MUTED}
      borderStyle="single"
      flexDirection="column"
      flexShrink={0}
      gap={0}
      marginTop={1}
      paddingTop={1}
    >
      {summary.fields.length > 0 ? (
        <box flexDirection="column" flexShrink={0}>
          {summary.fields.map((field) => (
            <box flexDirection="row" flexShrink={0} key={field.label}>
              <text fg={MUTED} width={12}>
                {field.label}
              </text>
              <text fg={FOREGROUND} flexGrow={1}>
                {field.value}
              </text>
            </box>
          ))}
        </box>
      ) : null}
      {summary.changedFiles !== undefined && summary.changedFiles.length > 0 ? (
        <ChangedFilesTree files={summary.changedFiles} />
      ) : null}
    </box>
  );
}

/**
 * Render the changed-files list as a nested directory tree. Files
 * sharing a parent directory collapse into a single group, and the
 * box-drawing prefix (`├─` / `└─` / `│  `) tracks ancestor pipes the
 * way `tree(1)` does. The tree shape is computed by `buildFileTree`
 * — this component is purely presentational.
 */
function ChangedFilesTree({
  files,
}: {
  files: { action: string; path: string }[];
}): React.ReactNode {
  const tree = buildFileTree(files);
  const rows = flattenTree(tree);
  return (
    <box flexDirection="column" flexShrink={0} marginTop={1}>
      <text fg={MUTED}>Changed files</text>
      {rows.map((row, i) => (
        // Tree rows are positionally stable for a given summary —
        // the tree is rebuilt fresh each render from immutable
        // `files`, so the index makes a fine key.
        // biome-ignore lint/suspicious/noArrayIndexKey: positional tree rows
        <FileTreeLine key={i} row={row} />
      ))}
    </box>
  );
}

function FileTreeLine({ row }: { row: FileTreeRow }): React.ReactNode {
  if (row.kind === "directory") {
    return (
      <box flexDirection="row" flexShrink={0}>
        <text fg={MUTED}>{`${row.prefix}${row.branch} `}</text>
        <text fg={FOREGROUND}>{row.label}</text>
      </box>
    );
  }
  const { glyph, color } = changedFileStyle(row.action ?? "modify");
  return (
    <box flexDirection="row" flexShrink={0}>
      <text fg={MUTED}>{`${row.prefix}${row.branch} `}</text>
      <text fg={color}>{`${glyph} `}</text>
      <text fg={FOREGROUND}>{row.label}</text>
    </box>
  );
}

/**
 * Map a change action to its glyph + color. Stays here next to the row
 * component because both pieces of styling are coupled to the same
 * action enum (create / delete / modify-or-other).
 */
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

function SelectPrompt({
  prompt,
}: {
  prompt: Extract<ActivePrompt, { kind: "select" }>;
}): React.ReactNode {
  // OpenTUI's SelectRenderable allocates 2 rows per option when
  // `showDescription` is on (1 for the label + 1 for the hint),
  // 1 row otherwise. Allocating the wrong height clips visible
  // rows behind the scroll. We size based on the actual line cost
  // and cap at the screen-friendly maxima the wizard expects
  // (8 fully-shown items for select, 10 for multiselect).
  const hasDescriptions = prompt.options.some((option) => option.hint);
  const linesPerItem = hasDescriptions ? 2 : 1;
  const maxVisibleItems = 8;
  const visibleItems = Math.min(prompt.options.length, maxVisibleItems);
  return (
    <box flexDirection="column" flexShrink={0} gap={1} marginTop={1}>
      <text fg={FOREGROUND}>{prompt.message}</text>
      <select
        descriptionColor={MUTED}
        focused
        focusedTextColor={FOREGROUND}
        height={visibleItems * linesPerItem}
        onSelect={(_index, option) => {
          if (option) {
            prompt.resolve(String(option.value));
          }
        }}
        options={prompt.options.map((option) => ({
          name: option.label,
          description: option.hint ?? "",
          value: option.value,
        }))}
        selectedBackgroundColor={ACCENT}
        selectedIndex={prompt.initialIndex}
        selectedTextColor="#FFFFFF"
        showDescription={hasDescriptions}
        showScrollIndicator={prompt.options.length > maxVisibleItems}
        textColor={FOREGROUND}
      />
    </box>
  );
}

/**
 * Multi-select uses local state to track the toggled values plus the
 * currently-highlighted row. On every keystroke `useKeyboard` runs:
 *   - space  → flip the highlighted option in the selection set
 *   - enter  → commit the current selection
 *
 * Tracking the highlighted index manually (rather than asking the
 * SelectRenderable for `getSelectedOption()`) avoids a race the
 * imperative version had: the renderable's `selectedIndex` was
 * internal mutable state and reading it on space-press could lag the
 * visible highlight by one frame on fast keyboards.
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

  // Checkbox-style markers — `[✔]` reads as "selected" almost
  // universally, and the bracketed shape gives the eye a clear
  // alignment column. The select renderable doesn't expose
  // per-character coloring, so the green of the check has to come
  // from the surrounding row's color — but that requires the row
  // to be selected, which conflicts with the focus-highlight color.
  // We settle for monochrome glyphs in the option label and rely
  // on the (n/N selected) counter below for the at-a-glance state.
  const decoratedOptions = prompt.options.map((option) => ({
    name: `${selected.has(option.value) ? "[✔]" : "[ ]"} ${option.label}`,
    description: option.hint ?? "",
    value: option.value,
  }));
  const selectedCount = selected.size;
  const totalCount = prompt.options.length;

  useKeyboard((event) => {
    if (event.name === "space") {
      const current = prompt.options[highlighted];
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
    } else if (event.name === "return" || event.name === "enter") {
      if (prompt.required && selected.size === 0) {
        return;
      }
      // Preserve the source option order in the returned array.
      const ordered = prompt.options
        .map((option) => option.value)
        .filter((value) => selected.has(value));
      prompt.resolve(ordered);
    }
  });

  // Same height arithmetic as SelectPrompt — see comment there. The
  // multiselect cap is slightly higher (10 vs 8 visible items)
  // because feature lists tend to be longer than disambiguation
  // selects.
  const hasDescriptions = prompt.options.some((option) => option.hint);
  const linesPerItem = hasDescriptions ? 2 : 1;
  const maxVisibleItems = 10;
  const visibleItems = Math.min(prompt.options.length, maxVisibleItems);

  return (
    <box flexDirection="column" flexShrink={0} gap={1} marginTop={1}>
      <text fg={FOREGROUND}>{prompt.message}</text>
      <box flexDirection="row" flexShrink={0} gap={2}>
        <text fg={MUTED}>space toggle · enter confirm · esc cancel</text>
        <text fg={ACCENT}>
          {selectedCount}/{totalCount} selected
        </text>
      </box>
      <select
        descriptionColor={MUTED}
        focused
        focusedTextColor={FOREGROUND}
        height={visibleItems * linesPerItem}
        onChange={(index) => setHighlighted(index)}
        options={decoratedOptions}
        selectedBackgroundColor={ACCENT}
        selectedTextColor="#FFFFFF"
        showDescription={hasDescriptions}
        showScrollIndicator={prompt.options.length > maxVisibleItems}
        textColor={FOREGROUND}
      />
    </box>
  );
}

// ────────────────────────────── Sidebar ───────────────────────────────

/**
 * The sidebar stacks three panels top-to-bottom:
 *
 *   1. {@link TipPanel} — fixed height (`TIP_PANEL_HEIGHT`). Pinned so
 *      it can never be squashed by the panels below.
 *   2. {@link ProgressPanel} — auto height (one row per visible step).
 *      Bounded by `CHECKLIST_VISIBLE_STEPS.length` (~9 rows).
 *   3. {@link FilesPanel} — `flexGrow=1`, scrollable. Consumes
 *      whatever vertical space is left over.
 *
 * On narrow terminals (`width < SIDEBAR_BREAKPOINT`) the whole
 * sidebar is hidden by the parent App; the inline `FileReadStatus`
 * line in `MainColumn` takes over the file-read indicator role.
 */
function Sidebar({
  tipIndex,
  steps,
  filesRead,
}: {
  tipIndex: number;
  steps: StepEntry[];
  filesRead: FileReadEntry[];
}): React.ReactNode {
  return (
    <box flexDirection="column" flexShrink={0} gap={1} width={SIDEBAR_WIDTH}>
      <TipPanel tipIndex={tipIndex} />
      <ProgressPanel steps={steps} />
      <FilesPanel filesRead={filesRead} />
    </box>
  );
}

function TipPanel({ tipIndex }: { tipIndex: number }): React.ReactNode {
  const tip = SENTRY_TIPS[tipIndex % SENTRY_TIPS.length] as SentryTip;
  const total = SENTRY_TIPS.length;
  const oneIndexed = (tipIndex % total) + 1;
  return (
    <box
      borderColor={MUTED}
      borderStyle="rounded"
      flexDirection="column"
      flexShrink={0}
      gap={1}
      height={TIP_PANEL_HEIGHT}
      padding={1}
      title=" Did you know? "
      titleAlignment="left"
    >
      <text fg={ACCENT}>{tip.title}</text>
      <text fg={FOREGROUND}>{tip.body}</text>
      <box flexGrow={1} />
      <text fg={MUTED}>
        Tip {oneIndexed} of {total}
      </text>
    </box>
  );
}

/**
 * Static checklist of workflow steps. Each row reflects a
 * `StepEntry.status`:
 *
 *   - `pending`     — muted ◯
 *   - `in_progress` — accent ▶
 *   - `completed`   — success ✓
 *   - `skipped`     — muted-dim ◌ (lighter than pending so the eye
 *     can tell "we walked past this" from "we haven't reached this
 *     yet")
 *   - `failed`      — error ✖
 *
 * The label cell is sized to fit the 36-col sidebar after the
 * 2-col border + 2-col padding + 2-col glyph cell.
 */
function ProgressPanel({ steps }: { steps: StepEntry[] }): React.ReactNode {
  const completedCount = steps.filter(
    (entry) => entry.status === "completed"
  ).length;
  const totalCount = steps.length;
  return (
    <box
      borderColor={MUTED}
      borderStyle="rounded"
      flexDirection="column"
      flexShrink={0}
      paddingLeft={1}
      paddingRight={1}
      title={` Progress (${completedCount}/${totalCount}) `}
      titleAlignment="left"
    >
      {steps.map((entry) => (
        <ProgressRow entry={entry} key={entry.id} />
      ))}
    </box>
  );
}

function ProgressRow({ entry }: { entry: StepEntry }): React.ReactNode {
  const { glyph, glyphColor, labelColor } = progressStyle(entry.status);
  return (
    <box flexDirection="row" flexShrink={0}>
      <text fg={glyphColor} width={2}>
        {glyph}
      </text>
      <text fg={labelColor} flexGrow={1}>
        {entry.label}
      </text>
    </box>
  );
}

function progressStyle(status: StepEntry["status"]): {
  glyph: string;
  glyphColor: string;
  labelColor: string;
} {
  if (status === "in_progress") {
    return { glyph: "▶", glyphColor: ACCENT, labelColor: FOREGROUND };
  }
  if (status === "completed") {
    return { glyph: "✓", glyphColor: COLOR_SUCCESS, labelColor: MUTED };
  }
  if (status === "failed") {
    return { glyph: "✖", glyphColor: COLOR_ERROR, labelColor: COLOR_ERROR };
  }
  if (status === "skipped") {
    return { glyph: "◌", glyphColor: MUTED, labelColor: MUTED };
  }
  // pending
  return { glyph: "◯", glyphColor: MUTED, labelColor: MUTED };
}

/**
 * Scrollable directory tree of every file the wizard has read. Uses
 * `<scrollbox>` (OpenTUI's `ScrollBoxRenderable`) with sticky-bottom
 * tracking — newly-read files always come into view, like a
 * `tail -f`.
 *
 * Visual rules:
 *   - Directories: muted gray box-drawing branches + name with `/`.
 *   - Active reads (`status === "reading"`): accent purple `◐` glyph,
 *     foreground filename. The eye picks these out instantly.
 *   - Analyzed (`status === "analyzed"`): muted-green `✓` glyph,
 *     dimmed filename. Done work recedes; in-flight work pops.
 *
 * Hidden when no files have been recorded yet — the empty box would
 * just be visual noise during the auth/discover phase.
 */
function FilesPanel({
  filesRead,
}: {
  filesRead: FileReadEntry[];
}): React.ReactNode {
  if (filesRead.length === 0) {
    return null;
  }
  const tree = buildReadTree(filesRead);
  const rows = flattenTree(tree);
  const analyzedCount = filesRead.filter(
    (entry) => entry.status === "analyzed"
  ).length;
  return (
    <box
      borderColor={MUTED}
      borderStyle="rounded"
      flexDirection="column"
      flexGrow={1}
      flexShrink={1}
      title={` Files analyzed (${analyzedCount}/${filesRead.length}) `}
      titleAlignment="left"
    >
      <scrollbox
        contentOptions={{ flexDirection: "column" }}
        flexGrow={1}
        scrollY
        stickyScroll
        stickyStart="bottom"
      >
        {rows.map((row, i) => (
          // Tree rows are positionally stable for a given filesRead
          // snapshot — `buildReadTree` walks `filesRead` in insertion
          // order and never reorders, so the index makes a fine key.
          // biome-ignore lint/suspicious/noArrayIndexKey: positional read-tree rows
          <ReadTreeLine key={i} row={row} />
        ))}
      </scrollbox>
    </box>
  );
}

/**
 * One row of the files-read tree. Mirrors {@link FileTreeLine} but
 * styled for the read-progress flavour (status icons + dim-on-done)
 * rather than the changed-files flavour (action glyphs).
 */
function ReadTreeLine({ row }: { row: FileTreeRow }): React.ReactNode {
  if (row.kind === "directory") {
    return (
      <box flexDirection="row" flexShrink={0}>
        <text fg={MUTED}>{`${row.prefix}${row.branch} `}</text>
        <text fg={FOREGROUND}>{row.label}</text>
      </box>
    );
  }
  const { glyph, glyphColor, labelColor } = readStatusStyle(row.status);
  return (
    <box flexDirection="row" flexShrink={0}>
      <text fg={MUTED}>{`${row.prefix}${row.branch} `}</text>
      <text fg={glyphColor}>{`${glyph} `}</text>
      <text fg={labelColor}>{row.label}</text>
    </box>
  );
}

function readStatusStyle(status: FileTreeRow["status"]): {
  glyph: string;
  glyphColor: string;
  labelColor: string;
} {
  if (status === "reading") {
    return { glyph: "◐", glyphColor: ACCENT, labelColor: FOREGROUND };
  }
  // "analyzed" or undefined (defensive — should never appear for
  // file rows but treat as analyzed)
  return { glyph: "✓", glyphColor: COLOR_SUCCESS, labelColor: MUTED };
}
