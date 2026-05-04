/**
 * InkUI React App — Full-Screen Wizard
 *
 * Renders the wizard in alternate-screen mode using Ink. The layout
 * fills the terminal:
 *
 *   ┌─ TitleBar (accent background) ────────────────────────────────┐
 *   │                                                                │
 *   │  ┌─────────────────────────────────────────────────────────┐   │
 *   │  │  Active tab content (Status / Logs)                     │   │
 *   │  │                                                         │   │
 *   │  │  [SplitView when wide]                                  │   │
 *   │  │  Left: Tips / Progress      Right: Logs + Files         │   │
 *   │  │                                                         │   │
 *   │  └─────────────────────────────────────────────────────────┘   │
 *   │                                                                │
 *   │  ─── Status bar (collapsible) ──────────────────────────────   │
 *   │  [Status]  [Logs]                                              │
 *   │  ─ KeyboardHintsBar ─────────────────────────────────────────  │
 *   └───────────────────────────────────────────────────────────────┘
 *
 * The component subscribes to a `WizardStore` via
 * `useSyncExternalStore` so imperative `WizardUI` method calls
 * trigger React re-renders without React state being the source of
 * truth.
 */

import { Box, Text, useInput, useStdout } from "ink";
import Spinner from "ink-spinner";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
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

const ACCENT = "#DC9300";
const ACCENT_DIM = "#3D2800";
const MUTED = "gray";
const PRIMARY = "cyan";

const COLOR_INFO = "cyan";
const COLOR_WARN = "yellow";
const COLOR_ERROR = "red";
const COLOR_SUCCESS = "green";

const MIN_WIDTH = 80;
const MAX_WIDTH = 120;

/** Number of collapsed status-bar lines visible. */
const STATUS_COLLAPSED_COUNT = 2;
/** Number of expanded status-bar lines visible. */
const STATUS_EXPANDED_COUNT = 10;

const ICON_BY_SEVERITY: Record<LogSeverity, { glyph: string; color: string }> =
  {
    info: { glyph: "●", color: COLOR_INFO },
    warn: { glyph: "▲", color: COLOR_WARN },
    error: { glyph: "✖", color: COLOR_ERROR },
    success: { glyph: "✔", color: COLOR_SUCCESS },
    message: { glyph: " ", color: "white" },
  };

const ICONS = {
  diamond: "\u25C6",
  separator: "\u250A",
  squareFilled: "\u25FC",
  squareOpen: "\u25FB",
  triangleRight: "\u25B6",
} as const;

// ────────────────────────────── App entry ─────────────────────────────

export type AppProps = {
  store: WizardStore;
};

/**
 * Root component. Fills the full terminal via `alternateScreen: true`
 * in the Ink render call. Layout: TitleBar, content area (tabbed),
 * status bar, tab bar, keyboard hints.
 */
export function App({ store }: AppProps): React.ReactNode {
  const snapshot = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot
  );
  const { columns, rows } = useTerminalSize();
  const [activeTab, setActiveTab] = useState(0);

  const width = getContentWidth(columns);
  const contentHeight = Math.max(5, rows - 3);

  useInput((input, key) => {
    if (key.ctrl && input === "c" && !snapshot.prompt) {
      snapshot.requestCancel?.();
      return;
    }
    if (key.leftArrow && !snapshot.prompt) {
      setActiveTab((prev) => Math.max(0, prev - 1));
      return;
    }
    if (key.rightArrow && !snapshot.prompt) {
      setActiveTab((prev) => Math.min(1, prev + 1));
      return;
    }
    if (input === "s" && !snapshot.prompt) {
      store.toggleStatusExpanded();
    }
  });

  const statusMessages = snapshot.statusMessages;
  const visibleCount = snapshot.statusExpanded
    ? STATUS_EXPANDED_COUNT
    : STATUS_COLLAPSED_COUNT;
  const visibleMessages = statusMessages.slice(-visibleCount);

  const tabs = useMemo(
    () => [
      { id: "status", label: "Status" },
      { id: "logs", label: "Logs" },
    ],
    []
  );

  const hints: KeyHint[] = useMemo(() => {
    const h: KeyHint[] = [{ label: "\u2190\u2192", action: "switch tab" }];
    if (statusMessages.length > STATUS_COLLAPSED_COUNT) {
      h.push({ label: "s", action: "toggle status" });
    }
    if (snapshot.prompt) {
      h.push({ label: "\u2191\u2193", action: "navigate" });
      h.push({ label: "enter", action: "confirm" });
      h.push({ label: "esc", action: "cancel" });
    }
    return h;
  }, [statusMessages.length, snapshot.prompt]);

  const inner = (
    <Box flexDirection="column" height={rows} width={width}>
      <TitleBar width={width} />
      <Box height={1} />
      <Box flexDirection="column" flexGrow={1} paddingX={1}>
        <Box flexDirection="column" height={contentHeight}>
          <Box
            flexDirection="column"
            flexGrow={1}
            flexShrink={1}
            overflow="hidden"
          >
            {activeTab === 0 ? (
              <StatusScreen
                filesRead={snapshot.filesRead}
                hasActivePrompt={snapshot.prompt !== null}
                logs={snapshot.logs}
                prompt={snapshot.prompt}
                spinner={snapshot.spinner}
                steps={snapshot.steps}
                summary={snapshot.summary}
                terminalRows={rows}
                tipIndex={snapshot.tipIndex}
                width={width - 2}
              />
            ) : (
              <LogScreen logs={snapshot.logs} />
            )}
          </Box>

          {visibleMessages.length > 0 ? (
            <StatusBar messages={visibleMessages} />
          ) : null}

          <Box height={1} />
          <TabBar activeTab={activeTab} tabs={tabs} />
          <Box height={1} />
          <KeyboardHintsBar hints={hints} />
        </Box>
      </Box>
    </Box>
  );

  return (
    <Box
      alignItems="center"
      flexDirection="column"
      height={rows}
      justifyContent="flex-start"
      width={columns}
    >
      {inner}
    </Box>
  );
}

// ────────────────────────────── Layout helpers ────────────────────────

function getContentWidth(terminalColumns: number): number {
  if (terminalColumns < MIN_WIDTH) {
    return terminalColumns;
  }
  return Math.min(MAX_WIDTH, terminalColumns);
}

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

// ──────────────────────────── Title Bar ──────────────────────────────

function TitleBar({ width }: { width: number }): React.ReactNode {
  const title = " Sentry Init Wizard";
  const versionTag = " sentry.io ";
  const gap = Math.max(0, width - title.length - versionTag.length);
  const padding = " ".repeat(gap);

  return (
    <Box overflow="hidden" width={width}>
      <Text backgroundColor={ACCENT} bold color={ACCENT_DIM}>
        {title}
        {padding}
        {versionTag}
      </Text>
    </Box>
  );
}

// ──────────────────────────── Status Bar ──────────────────────────────

function StatusBar({ messages }: { messages: string[] }): React.ReactNode {
  return (
    <Box
      borderBottom={false}
      borderColor={MUTED}
      borderLeft={false}
      borderRight={false}
      borderStyle="single"
      borderTop
      flexDirection="column"
      overflow="hidden"
      paddingX={1}
    >
      {messages.map((msg, i, arr) => {
        const isCurrent = i === arr.length - 1;
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: positional status messages
          <Text color={MUTED} dimColor={!isCurrent} key={i}>
            {isCurrent ? ICONS.diamond : ICONS.separator} {msg}
          </Text>
        );
      })}
    </Box>
  );
}

// ──────────────────────────── Tab Bar ─────────────────────────────────

function TabBar({
  tabs,
  activeTab,
}: {
  tabs: { id: string; label: string }[];
  activeTab: number;
}): React.ReactNode {
  return (
    <Box gap={1} paddingX={1}>
      {tabs.map((tab, i) => {
        const isActive = i === activeTab;
        // biome-ignore lint/nursery/noLeakedRender: variable assignment, not JSX expression
        const tabColor = isActive ? ACCENT : MUTED;
        return (
          <Text
            bold={isActive}
            color={tabColor}
            inverse={isActive}
            key={tab.id}
          >
            {` ${tab.label} `}
          </Text>
        );
      })}
    </Box>
  );
}

// ────────────────────────── Keyboard Hints ────────────────────────────

type KeyHint = { label: string; action: string };

function KeyboardHintsBar({ hints }: { hints: KeyHint[] }): React.ReactNode {
  return (
    <Box height={1} paddingX={1}>
      {hints.map((hint, i) => (
        <Box
          key={`${hint.label}-${hint.action}`}
          marginRight={i < hints.length - 1 ? 2 : 0}
        >
          <Text bold color={MUTED}>
            {hint.label}
          </Text>
          <Text dimColor> {hint.action}</Text>
        </Box>
      ))}
    </Box>
  );
}

// ─────────────────────────── Status Screen ────────────────────────────

/**
 * The main "Status" tab: SplitView with progress/tips on the left
 * and logs + files on the right. On narrow terminals, collapses to
 * a single column.
 */
function StatusScreen({
  steps,
  tipIndex,
  spinner,
  logs,
  prompt,
  summary,
  filesRead,
  terminalRows,
  hasActivePrompt,
  width,
}: {
  steps: StepEntry[];
  tipIndex: number;
  spinner: SpinnerState;
  logs: LogEntry[];
  prompt: ActivePrompt | null;
  summary: WizardSummary | null;
  filesRead: FileReadEntry[];
  terminalRows: number;
  hasActivePrompt: boolean;
  width: number;
}): React.ReactNode {
  const isWide = width >= 80;

  if (!isWide) {
    return (
      <Box flexDirection="column" flexGrow={1}>
        <ProgressPanel steps={steps} />
        <Box height={1} />
        <ActivityPane
          filesRead={filesRead}
          hasActivePrompt={hasActivePrompt}
          logs={logs}
          prompt={prompt}
          spinner={spinner}
          summary={summary}
          terminalRows={terminalRows}
        />
      </Box>
    );
  }

  return (
    <SplitView
      left={
        <Box flexDirection="column">
          <TipPanel tipIndex={tipIndex} />
          <Box height={1} />
          <ProgressPanel steps={steps} />
        </Box>
      }
      right={
        <ActivityPane
          filesRead={filesRead}
          hasActivePrompt={hasActivePrompt}
          logs={logs}
          prompt={prompt}
          spinner={spinner}
          summary={summary}
          terminalRows={terminalRows}
        />
      }
    />
  );
}

// ──────────────────────────── Split View ──────────────────────────────

function SplitView({
  left,
  right,
  gap = 2,
}: {
  left: React.ReactNode;
  right: React.ReactNode;
  gap?: number;
}): React.ReactNode {
  return (
    <Box flexDirection="row" flexGrow={1} flexShrink={1} gap={gap}>
      <Box flexDirection="column" overflow="hidden" width="50%">
        {left}
      </Box>
      <Box flexDirection="column" overflow="hidden" width="50%">
        {right}
      </Box>
    </Box>
  );
}

// ─────────────────────────── Activity Pane ────────────────────────────

/**
 * Right-hand side of the status tab: log lines, spinner, file status,
 * summary, and prompts. Essentially what used to be the MainColumn.
 */
function ActivityPane({
  logs,
  spinner,
  prompt,
  summary,
  filesRead,
  terminalRows,
  hasActivePrompt,
}: {
  logs: LogEntry[];
  spinner: SpinnerState;
  prompt: ActivePrompt | null;
  summary: WizardSummary | null;
  filesRead: FileReadEntry[];
  terminalRows: number;
  hasActivePrompt: boolean;
}): React.ReactNode {
  const showFileStatus = !summary && filesRead.length > 0;
  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box flexDirection="column">
        {logs.map((log) => (
          <LogLine entry={log} key={log.id} />
        ))}
      </Box>
      {showFileStatus ? (
        <FilesPanel
          filesRead={filesRead}
          hasActivePrompt={hasActivePrompt}
          maxRows={Math.min(14, Math.max(4, terminalRows - 20))}
        />
      ) : null}
      {spinner.active ? <SpinnerRow state={spinner} /> : null}
      {summary ? <SummaryPanel summary={summary} /> : null}
      {prompt ? <PromptArea prompt={prompt} /> : null}
    </Box>
  );
}

// ─────────────────────────── Log Screen ──────────────────────────────

function LogScreen({ logs }: { logs: LogEntry[] }): React.ReactNode {
  if (logs.length === 0) {
    return (
      <Box flexDirection="column" flexGrow={1} paddingX={1}>
        <Text dimColor>No log entries yet...</Text>
      </Box>
    );
  }
  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1}>
      {logs.map((log) => (
        <LogLine entry={log} key={log.id} />
      ))}
    </Box>
  );
}

// ──────────────────────────── Components ──────────────────────────────

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
        <Text color={PRIMARY}>
          <Spinner type="dots" />
        </Text>
      </Box>
      <Text>{state.message}</Text>
    </Box>
  );
}

// ──────────────────────────── Tip Panel ──────────────────────────────

function TipPanel({ tipIndex }: { tipIndex: number }): React.ReactNode {
  const tip = SENTRY_TIPS[tipIndex % SENTRY_TIPS.length] as SentryTip;
  const total = SENTRY_TIPS.length;
  const oneIndexed = (tipIndex % total) + 1;
  return (
    <Box
      borderColor={MUTED}
      borderStyle="round"
      flexDirection="column"
      flexShrink={0}
      paddingX={1}
    >
      <Text bold color={MUTED}>
        Did you know?
      </Text>
      <Text bold color={ACCENT}>
        {tip.title}
      </Text>
      <Text>{tip.body}</Text>
      <Box justifyContent="flex-end">
        <Text color={MUTED}>
          Tip {oneIndexed} of {total}
        </Text>
      </Box>
    </Box>
  );
}

// ────────────────────────── Progress Panel ────────────────────────────

function ProgressPanel({ steps }: { steps: StepEntry[] }): React.ReactNode {
  const completedCount = steps.filter(
    (entry) => entry.status === "completed"
  ).length;
  const totalCount = steps.length;

  return (
    <Box flexDirection="column" flexShrink={0}>
      <Text bold>Tasks</Text>
      <Text> </Text>
      {steps.length === 0 ? (
        <Box gap={1}>
          <Spinner type="dots" />
          <Text dimColor>Analyzing project...</Text>
        </Box>
      ) : null}
      {steps.map((entry) => (
        <ProgressRow entry={entry} key={entry.id} />
      ))}
      {totalCount > 0 ? (
        <Box gap={1} marginTop={1}>
          <Spinner type="dots" />
          <Text dimColor>
            {completedCount < totalCount
              ? `Progress: ${completedCount}/${totalCount} completed`
              : "Cleaning up..."}
          </Text>
        </Box>
      ) : null}
    </Box>
  );
}

function ProgressRow({ entry }: { entry: StepEntry }): React.ReactNode {
  const { glyph, glyphColor, labelColor } = progressStyle(entry);
  return (
    <Box flexDirection="row" flexShrink={0}>
      <Box width={3}>
        <Text color={glyphColor}>{glyph}</Text>
      </Box>
      <Text color={labelColor}>{entry.label}</Text>
    </Box>
  );
}

function progressStyle(entry: StepEntry): {
  glyph: string;
  glyphColor: string;
  labelColor: string;
} {
  if (entry.status === "in_progress") {
    return {
      glyph: ICONS.triangleRight,
      glyphColor: PRIMARY,
      labelColor: "white",
    };
  }
  if (entry.status === "completed") {
    return {
      glyph: ICONS.squareFilled,
      glyphColor: COLOR_SUCCESS,
      labelColor: MUTED,
    };
  }
  if (entry.status === "failed") {
    return {
      glyph: "\u2716",
      glyphColor: COLOR_ERROR,
      labelColor: COLOR_ERROR,
    };
  }
  if (entry.status === "skipped") {
    return { glyph: "\u25CC", glyphColor: MUTED, labelColor: MUTED };
  }
  return { glyph: ICONS.squareOpen, glyphColor: MUTED, labelColor: MUTED };
}

// ─────────────────────────── Files Panel ──────────────────────────────

function FilesPanel({
  filesRead,
  maxRows,
  hasActivePrompt,
}: {
  filesRead: FileReadEntry[];
  maxRows: number;
  hasActivePrompt: boolean;
}): React.ReactNode {
  const [pinnedToBottom, setPinnedToBottom] = useState(true);
  const [offset, setOffset] = useState(0);

  const tree = buildReadTree(filesRead);
  const rows = flattenTree(tree);
  const totalRows = rows.length;

  const viewport = Math.max(1, maxRows - 1);
  const canScroll = totalRows > viewport;

  const maxOffset = Math.max(0, totalRows - viewport);
  const effectiveOffset = pinnedToBottom ? 0 : Math.min(offset, maxOffset);

  const sliceEnd = totalRows - effectiveOffset;
  const sliceStart = Math.max(0, sliceEnd - viewport);
  const visible = rows.slice(sliceStart, sliceEnd);

  const prevTotalRef = useRef(totalRows);
  useEffect(() => {
    const prev = prevTotalRef.current;
    prevTotalRef.current = totalRows;
    if (pinnedToBottom) {
      return;
    }
    const newMax = Math.max(0, totalRows - viewport);
    if (totalRows > prev) {
      setOffset((current) => Math.min(newMax, current + (totalRows - prev)));
    } else if (totalRows < prev) {
      setOffset((current) => Math.min(current, newMax));
    }
  }, [totalRows, viewport, pinnedToBottom]);

  useInput(
    (_input, key) => {
      if (!canScroll) {
        return;
      }
      if (key.upArrow) {
        setPinnedToBottom(false);
        setOffset((current) => Math.min(maxOffset, current + 1));
        return;
      }
      if (key.downArrow) {
        setOffset((current) => {
          const next = Math.max(0, current - 1);
          if (next === 0) {
            setPinnedToBottom(true);
          }
          return next;
        });
        return;
      }
      if (key.pageUp) {
        setPinnedToBottom(false);
        setOffset((current) => Math.min(maxOffset, current + viewport));
        return;
      }
      if (key.pageDown) {
        setOffset((current) => {
          const next = Math.max(0, current - viewport);
          if (next === 0) {
            setPinnedToBottom(true);
          }
          return next;
        });
        return;
      }
      if (key.home) {
        setPinnedToBottom(false);
        setOffset(maxOffset);
        return;
      }
      if (key.end || key.escape) {
        setPinnedToBottom(true);
        setOffset(0);
      }
    },
    { isActive: !hasActivePrompt }
  );

  if (filesRead.length === 0) {
    return null;
  }

  const analyzedCount = filesRead.filter(
    (entry) => entry.status === "analyzed"
  ).length;
  const padding = Math.max(0, viewport - visible.length);

  return (
    <Box
      borderColor={MUTED}
      borderStyle="round"
      flexDirection="column"
      flexShrink={0}
      marginTop={1}
      paddingX={1}
    >
      <Box justifyContent="space-between">
        <Text bold color={MUTED}>
          Files analyzed
        </Text>
        <Text color={MUTED}>
          {pinnedToBottom ? "" : "\u2191 "}
          {analyzedCount}/{filesRead.length}
        </Text>
      </Box>
      <Box flexDirection="row">
        <Box flexDirection="column" flexGrow={1}>
          {visible.map((row, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: positional read-tree rows
            <ReadTreeLine key={`r${i}`} row={row} />
          ))}
          {Array.from({ length: padding }, (_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: positional filler
            <Text key={`p${i}`}> </Text>
          ))}
        </Box>
        {canScroll ? (
          <Scrollbar
            offset={effectiveOffset}
            totalRows={totalRows}
            viewport={viewport}
          />
        ) : null}
      </Box>
    </Box>
  );
}

function Scrollbar({
  offset,
  totalRows,
  viewport,
}: {
  offset: number;
  totalRows: number;
  viewport: number;
}): React.ReactNode {
  const maxOff = Math.max(1, totalRows - viewport);
  const thumbSize = Math.max(1, Math.floor((viewport * viewport) / totalRows));
  const trackSpan = Math.max(1, viewport - thumbSize);
  const thumbStart = Math.round(((maxOff - offset) / maxOff) * trackSpan);
  const cells = Array.from({ length: viewport }, (_v, i) => {
    const inThumb = i >= thumbStart && i < thumbStart + thumbSize;
    return inThumb ? "\u2588" : "\u2502";
  });
  return (
    <Box flexDirection="column" flexShrink={0} marginLeft={1}>
      {cells.map((cell, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: positional scrollbar
        <Text color={MUTED} key={i}>
          {cell}
        </Text>
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
    return { glyph: "\u25D0", glyphColor: PRIMARY, labelColor: "white" };
  }
  return { glyph: "\u2713", glyphColor: COLOR_SUCCESS, labelColor: MUTED };
}

// ────────────────────────────── Summary ───────────────────────────────

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

function ChangedFilesTree({
  files,
}: {
  files: { action: string; path: string }[];
}): React.ReactNode {
  const tree = buildFileTree(files);
  const treeRows = flattenTree(tree);
  return (
    <Box flexDirection="column" flexShrink={0} marginTop={1}>
      <Text color={MUTED}>Changed files</Text>
      {treeRows.map((row, i) => (
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
    return { glyph: "\u2212", color: COLOR_ERROR };
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
          // biome-ignore lint/nursery/noLeakedRender: variable assignment, not JSX expression
          const labelColor = isCursor ? "white" : MUTED;
          return (
            <Box flexDirection="row" key={option.value}>
              <Box width={3}>
                <Text color={ACCENT}>{isCursor ? "\u25B8" : " "}</Text>
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
        <Text color={MUTED}>
          space toggle \u00B7 enter confirm \u00B7 esc cancel
        </Text>
        <Text color={ACCENT}>
          {selected.size}/{totalCount} selected
        </Text>
      </Box>
      <Box flexDirection="column">
        {prompt.options.map((option, idx) => {
          const isSelected = selected.has(option.value);
          const isCursor = idx === highlighted;
          const marker = isSelected ? ICONS.squareFilled : ICONS.squareOpen;
          // biome-ignore lint/nursery/noLeakedRender: variable assignment, not JSX expression
          const markerColor = isSelected ? COLOR_SUCCESS : MUTED;
          return (
            <Box flexDirection="row" key={option.value}>
              <Box width={3}>
                <Text color={ACCENT}>{isCursor ? "\u25B8" : " "}</Text>
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
