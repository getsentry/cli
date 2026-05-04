/**
 * InkUI React App — Full-Screen Wizard
 *
 * Renders the wizard in alternate-screen mode using Ink. The layout
 * fills the terminal:
 *
 *   ┌─ ◆ Sentry Init Wizard ──────────────────── sentry.io ─┐
 *   │                                                         │
 *   │  ╔═══╗                    │  ╭ Did you know? ─────────╮ │
 *   │  ║ S ║  Sentry banner     │  │ <tip>                  │ │
 *   │  ╚═══╝                    │  ╰────────────────────────╯ │
 *   │  ● log line               │                             │
 *   │  ▲ log line               │  ╭ Tasks ────── 2/9 ──────╮ │
 *   │  ◐ spinner...             │  │ ◼ Discover ctx         │ │
 *   │  [PromptArea]             │  │ ▶ Install deps         │ │
 *   │                           │  │ ◻ Apply codemods       │ │
 *   │                           │  ╰────────────────────────╯ │
 *   │  ──────────────────────────────────────────────────────  │
 *   │  ◆ Reading package.json                                 │
 *   │  ● Status   Files                                       │
 *   │  ←→ switch tab  s toggle status                         │
 *   └─────────────────────────────────────────────────────────┘
 *
 * Tab 1 (Status): Banner + logs + spinner + prompts + summary
 * Tab 2 (Files): Scrollable file read tree
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
import { BLOCK_LINE_COUNT, LEARN_SEQUENCE } from "./learn-content.js";
import { SENTRY_TIPS, type SentryTip } from "./sentry-tips.js";
import type { WizardSummary } from "./types.js";
import type {
  ActivePrompt,
  FileReadEntry,
  LearnState,
  LogEntry,
  LogSeverity,
  SpinnerState,
  StepEntry,
  WizardStore,
} from "./wizard-store.js";

// ──────────────────────────── Visual constants ────────────────────────

/** Sentry blurple — primary brand accent. */
const ACCENT = "#7553FF";
const MUTED = "gray";
const MUTED_DIM = "#555555";
/** Sentry purple — spinners, in-progress states. */
const PRIMARY = "#8B6AC8";

const COLOR_INFO = "#9C84D4";
const COLOR_WARN = "#FDB81B";
const COLOR_ERROR = "#fe4144";
const COLOR_SUCCESS = "#83da90";

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
  diamondOpen: "\u25C7",
  separator: "\u250A",
  verticalLine: "\u2502",
  squareFilled: "\u25FC",
  squareOpen: "\u25FB",
  triangleRight: "\u25B6",
  triangleSmallRight: "\u25B8",
  bullet: "\u2022",
} as const;

// ────────────────────────────── App entry ─────────────────────────────

export type AppProps = {
  store: WizardStore;
};

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
  const isWide = width >= 80;

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
      { id: "files", label: "Files" },
    ],
    []
  );

  const hints: KeyHint[] = useMemo(() => {
    const h: KeyHint[] = [{ label: "\u2190\u2192", action: "switch tab" }];
    if (statusMessages.length > STATUS_COLLAPSED_COUNT) {
      h.push({ label: "s", action: "toggle status" });
    }
    if (activeTab === 1 && snapshot.filesRead.length > 0) {
      h.push({ label: "\u2191\u2193", action: "scroll" });
    }
    if (snapshot.prompt) {
      if (snapshot.prompt.kind === "confirm") {
        h.push({ label: "y/n", action: "answer" });
      } else {
        h.push({ label: "\u2191\u2193", action: "navigate" });
        h.push({ label: "enter", action: "confirm" });
        h.push({ label: "esc", action: "cancel" });
      }
    }
    return h;
  }, [
    statusMessages.length,
    snapshot.prompt,
    activeTab,
    snapshot.filesRead.length,
  ]);

  const marginLeft = Math.max(0, Math.floor((columns - width) / 2));

  const inner = (
    <Box
      flexDirection="column"
      height={rows}
      marginLeft={marginLeft}
      width={width}
    >
      <Box flexDirection="column" flexGrow={1} paddingTop={1}>
        <Box flexDirection="column" height={contentHeight}>
          <Box
            flexDirection="row"
            flexGrow={1}
            flexShrink={1}
            gap={isWide ? 1 : 0}
            overflow="hidden"
          >
            <Box flexDirection="column" flexGrow={1} overflow="hidden">
              {activeTab === 0 ? (
                <ActivityPane
                  bannerRows={snapshot.bannerRows}
                  logs={snapshot.logs}
                  prompt={snapshot.prompt}
                  spinner={snapshot.spinner}
                  summary={snapshot.summary}
                />
              ) : (
                <FilesScreen
                  filesRead={snapshot.filesRead}
                  hasActivePrompt={snapshot.prompt !== null}
                  terminalRows={rows}
                />
              )}
            </Box>
            {isWide ? (
              <Sidebar
                learnState={snapshot.learnState}
                steps={snapshot.steps}
                terminalRows={rows}
                tipIndex={snapshot.tipIndex}
              />
            ) : null}
          </Box>

          {snapshot.overlay ? (
            <OverlayPanel overlay={snapshot.overlay} />
          ) : null}

          {visibleMessages.length > 0 ? (
            <StatusBar messages={visibleMessages} />
          ) : null}

          <TabBar activeTab={activeTab} tabs={tabs} />
          <KeyboardHintsBar hints={hints} />
        </Box>
      </Box>
    </Box>
  );

  return inner;
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

// ──────────────────────────── Status Bar ──────────────────────────────

function StatusBar({ messages }: { messages: string[] }): React.ReactNode {
  return (
    <Box
      borderBottom={false}
      borderColor={MUTED_DIM}
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
        // biome-ignore lint/nursery/noLeakedRender: variable assignment, not JSX expression
        const msgColor = isCurrent ? MUTED : MUTED_DIM;
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: positional status messages
          <Text color={msgColor} key={i}>
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
    <Box gap={1} height={1} paddingX={1}>
      {tabs.map((tab, i) => {
        const isActive = i === activeTab;
        // biome-ignore lint/nursery/noLeakedRender: variable assignment, not JSX expression
        const tabColor = isActive ? ACCENT : MUTED_DIM;
        return (
          <Box key={tab.id}>
            <Text bold={isActive} color={tabColor}>
              {isActive ? ICONS.bullet : " "} {tab.label}
            </Text>
          </Box>
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
          <Text bold color={MUTED_DIM}>
            {hint.label}
          </Text>
          <Text color={MUTED_DIM}> {hint.action}</Text>
        </Box>
      ))}
    </Box>
  );
}

// ────────────────────────────── Sidebar ───────────────────────────────

function Sidebar({
  learnState,
  steps,
  terminalRows,
  tipIndex,
}: {
  learnState: LearnState;
  steps: StepEntry[];
  terminalRows: number;
  tipIndex: number;
}): React.ReactNode {
  const showTips = terminalRows >= 24;
  return (
    <Box flexDirection="column" overflow="hidden" width="40%">
      {showTips ? (
        <>
          {learnState.complete ? (
            <TipPanel tipIndex={tipIndex} />
          ) : (
            <LearnPanel learnState={learnState} />
          )}
          <Box height={1} />
        </>
      ) : null}
      <ProgressPanel steps={steps} />
    </Box>
  );
}

// ─────────────────────────── Activity Pane ────────────────────────────

function ActivityPane({
  bannerRows,
  logs,
  spinner,
  prompt,
  summary,
}: {
  bannerRows: { content: string; color: string }[];
  logs: LogEntry[];
  spinner: SpinnerState;
  prompt: ActivePrompt | null;
  summary: WizardSummary | null;
}): React.ReactNode {
  const hasContent =
    logs.length > 0 || spinner.active || prompt !== null || summary !== null;

  return (
    <Box flexDirection="column" flexGrow={1}>
      {bannerRows.length > 0 ? (
        <Box flexDirection="column" flexShrink={0} marginBottom={1}>
          {bannerRows.map((row, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: positional banner rows
            <Text color={row.color} key={i}>
              {row.content}
            </Text>
          ))}
        </Box>
      ) : null}
      {!hasContent && bannerRows.length === 0 ? (
        <Box flexDirection="column" paddingTop={1}>
          <Box gap={1}>
            <Text color={PRIMARY}>
              <Spinner type="dots" />
            </Text>
            <Text dimColor>Initializing wizard...</Text>
          </Box>
        </Box>
      ) : null}
      {logs.length > 0 ? (
        <Box flexDirection="column">
          {logs.map((log) => (
            <LogLine entry={log} key={log.id} />
          ))}
        </Box>
      ) : null}
      {spinner.active ? <SpinnerRow state={spinner} /> : null}
      {summary ? <SummaryPanel summary={summary} /> : null}
      {prompt ? <PromptArea prompt={prompt} /> : null}
    </Box>
  );
}

// ─────────────────────────── Files Screen ─────────────────────────────

function FilesScreen({
  filesRead,
  hasActivePrompt,
  terminalRows,
}: {
  filesRead: FileReadEntry[];
  hasActivePrompt: boolean;
  terminalRows: number;
}): React.ReactNode {
  if (filesRead.length === 0) {
    return (
      <Box flexDirection="column" flexGrow={1} paddingTop={1} paddingX={1}>
        <Text dimColor>No files read yet...</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1}>
      <FilesPanel
        filesRead={filesRead}
        hasActivePrompt={hasActivePrompt}
        maxRows={Math.max(4, terminalRows - 10)}
      />
    </Box>
  );
}

// ──────────────────────────── Outro Screen ────────────────────────────

// ──────────────────────────── Overlay ─────────────────────────────────

function OverlayPanel({
  overlay,
}: {
  overlay: NonNullable<import("./wizard-store.js").Overlay>;
}): React.ReactNode {
  return (
    <Box
      borderColor={COLOR_WARN}
      borderStyle="round"
      flexDirection="column"
      paddingX={2}
      paddingY={1}
    >
      <Box gap={1}>
        <Text color={COLOR_WARN}>▲</Text>
        <Text bold>{overlay.message}</Text>
      </Box>
      {overlay.retryCount > 0 ? (
        <Box paddingLeft={3}>
          <Text dimColor>Retry {overlay.retryCount}...</Text>
        </Box>
      ) : null}
    </Box>
  );
}

// ──────────────────────────── Components ──────────────────────────────

function LogLine({ entry }: { entry: LogEntry }): React.ReactNode {
  const { glyph, color } = ICON_BY_SEVERITY[entry.severity];
  return (
    <Box flexDirection="row" flexShrink={0}>
      <Box flexShrink={0} width={3}>
        <Text color={color}>{glyph}</Text>
      </Box>
      <Text wrap="truncate">{entry.text}</Text>
    </Box>
  );
}

function SpinnerRow({ state }: { state: SpinnerState }): React.ReactNode {
  return (
    <Box flexDirection="row" flexShrink={0} marginTop={1}>
      <Box flexShrink={0} width={3}>
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
      borderColor={MUTED_DIM}
      borderStyle="round"
      flexDirection="column"
      flexShrink={0}
      paddingX={1}
    >
      <Text bold color={MUTED}>
        {ICONS.diamondOpen} Did you know?
      </Text>
      <Box height={1} />
      <Text bold color={ACCENT}>
        {tip.title}
      </Text>
      <Text wrap="wrap">{tip.body}</Text>
      <Box height={1} />
      <Box justifyContent="flex-end">
        <Text color={MUTED_DIM}>
          {oneIndexed}/{total}
        </Text>
      </Box>
    </Box>
  );
}

// ─────────────────────────── Learn Panel ──────────────────────────────

function LearnPanel({
  learnState,
}: {
  learnState: LearnState;
}): React.ReactNode {
  const block = LEARN_SEQUENCE[learnState.blockIndex];
  if (!block) {
    return null;
  }
  // Pad short blocks to BLOCK_LINE_COUNT so height stays fixed.
  const lines = block.lines.slice(0, BLOCK_LINE_COUNT);
  const padding = Math.max(0, BLOCK_LINE_COUNT - lines.length);
  return (
    <Box
      borderColor={MUTED_DIM}
      borderStyle="round"
      flexDirection="column"
      flexShrink={0}
      paddingX={1}
    >
      <Box justifyContent="space-between">
        <Text bold color={ACCENT}>
          {block.title}
        </Text>
        <Text color={MUTED_DIM}>
          {learnState.blockIndex + 1}/{LEARN_SEQUENCE.length}
        </Text>
      </Box>
      <Box height={1} />
      {lines.map((line, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: positional content lines
        <Text key={i}>{line || " "}</Text>
      ))}
      {Array.from({ length: padding }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: positional filler
        <Text key={`p${i}`}> </Text>
      ))}
    </Box>
  );
}

// ────────────────────────── Progress Panel ────────────────────────────

function ProgressPanel({ steps }: { steps: StepEntry[] }): React.ReactNode {
  const completedCount = steps.filter(
    (entry) => entry.status === "completed"
  ).length;
  const totalCount = steps.length;

  const headerRight = totalCount > 0 ? `${completedCount}/${totalCount}` : "";
  const badgeColor = completedCount === totalCount ? COLOR_SUCCESS : MUTED_DIM;

  return (
    <Box
      borderColor={MUTED_DIM}
      borderStyle="round"
      flexDirection="column"
      flexShrink={0}
      paddingX={1}
    >
      <Box justifyContent="space-between">
        <Text bold color={MUTED}>
          {ICONS.diamondOpen} Tasks
        </Text>
        {headerRight ? <Text color={badgeColor}>{headerRight}</Text> : null}
      </Box>
      <Box height={1} />
      {steps.length === 0 ? (
        <Box gap={1}>
          <Text color={PRIMARY}>
            <Spinner type="dots" />
          </Text>
          <Text dimColor>Analyzing project...</Text>
        </Box>
      ) : null}
      {steps.map((entry) => (
        <ProgressRow entry={entry} key={entry.id} />
      ))}
    </Box>
  );
}

function ProgressRow({ entry }: { entry: StepEntry }): React.ReactNode {
  const { glyph, glyphColor, labelColor, dimLabel } = progressStyle(entry);
  return (
    <Box flexDirection="row" flexShrink={0}>
      <Box flexShrink={0} width={3}>
        <Text color={glyphColor}>{glyph}</Text>
      </Box>
      <Text color={labelColor} dimColor={dimLabel}>
        {entry.label}
      </Text>
    </Box>
  );
}

function progressStyle(entry: StepEntry): {
  glyph: string;
  glyphColor: string;
  labelColor: string;
  dimLabel: boolean;
} {
  if (entry.status === "in_progress") {
    return {
      glyph: ICONS.triangleRight,
      glyphColor: PRIMARY,
      labelColor: "white",
      dimLabel: false,
    };
  }
  if (entry.status === "completed") {
    return {
      glyph: ICONS.squareFilled,
      glyphColor: COLOR_SUCCESS,
      labelColor: MUTED,
      dimLabel: false,
    };
  }
  if (entry.status === "failed") {
    return {
      glyph: "\u2716",
      glyphColor: COLOR_ERROR,
      labelColor: COLOR_ERROR,
      dimLabel: false,
    };
  }
  if (entry.status === "skipped") {
    return {
      glyph: "\u25CC",
      glyphColor: MUTED_DIM,
      labelColor: MUTED_DIM,
      dimLabel: true,
    };
  }
  return {
    glyph: ICONS.squareOpen,
    glyphColor: MUTED_DIM,
    labelColor: MUTED,
    dimLabel: true,
  };
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
      if (key.end) {
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
    <Box flexDirection="column" flexShrink={0}>
      <Box justifyContent="space-between">
        <Text bold color={MUTED}>
          Files analyzed
        </Text>
        <Text color={MUTED_DIM}>
          {pinnedToBottom ? "" : "\u2191 "}
          {analyzedCount}/{filesRead.length}
        </Text>
      </Box>
      <Box height={1} />
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
    return inThumb ? "\u2588" : ICONS.verticalLine;
  });
  return (
    <Box flexDirection="column" flexShrink={0} marginLeft={1}>
      {cells.map((cell, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: positional scrollbar
        <Text color={MUTED_DIM} key={i}>
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
        <Text color={MUTED_DIM}>{`${row.prefix}${row.branch} `}</Text>
        <Text>{row.label}</Text>
      </Box>
    );
  }
  const { glyph, glyphColor, labelColor } = readStatusStyle(row.status);
  return (
    <Box flexDirection="row" flexShrink={0}>
      <Text color={MUTED_DIM}>{`${row.prefix}${row.branch} `}</Text>
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
      borderColor={MUTED_DIM}
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
              <Box flexShrink={0} width={14}>
                <Text color={MUTED}>{field.label}</Text>
              </Box>
              <Text bold>{field.value}</Text>
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
      <Text bold color={MUTED}>
        Changed files
      </Text>
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
        <Text color={MUTED_DIM}>{`${row.prefix}${row.branch} `}</Text>
        <Text>{row.label}</Text>
      </Box>
    );
  }
  const { glyph, color } = changedFileStyle(row.action ?? "modify");
  return (
    <Box flexDirection="row" flexShrink={0}>
      <Text color={MUTED_DIM}>{`${row.prefix}${row.branch} `}</Text>
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
  if (prompt.kind === "confirm") {
    return <ConfirmPrompt prompt={prompt} />;
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
    <Box flexDirection="column" flexShrink={0} marginTop={1}>
      <Box gap={1} marginBottom={1}>
        <Text bold color={ACCENT}>
          {ICONS.diamondOpen}
        </Text>
        <Text bold>{prompt.message}</Text>
      </Box>
      <Box flexDirection="column">
        {prompt.options.map((option, idx) => {
          const isCursor = idx === highlighted;
          // biome-ignore lint/nursery/noLeakedRender: variable assignment, not JSX expression
          const labelColor = isCursor ? "white" : MUTED;
          return (
            <Box flexDirection="row" key={option.value}>
              <Box flexShrink={0} width={3}>
                <Text color={ACCENT}>
                  {isCursor ? ICONS.triangleSmallRight : " "}
                </Text>
              </Box>
              <Text bold={isCursor} color={labelColor}>
                {option.label}
              </Text>
              {option.hint !== undefined && option.hint !== "" ? (
                <Text color={MUTED_DIM}> {option.hint}</Text>
              ) : null}
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}

function ConfirmPrompt({
  prompt,
}: {
  prompt: Extract<ActivePrompt, { kind: "confirm" }>;
}): React.ReactNode {
  useInput((input, key) => {
    if (input === "y" || input === "Y") {
      prompt.resolve(true);
      return;
    }
    if (input === "n" || input === "N") {
      prompt.resolve(false);
      return;
    }
    if (key.return) {
      prompt.resolve(prompt.initialValue);
      return;
    }
    if (key.escape || (key.ctrl && input === "c")) {
      prompt.resolve(null);
    }
  });

  const yLabel = prompt.initialValue ? "Y" : "y";
  const nLabel = prompt.initialValue ? "n" : "N";

  return (
    <Box flexDirection="column" flexShrink={0} marginTop={1}>
      <Box gap={1}>
        <Text bold color={ACCENT}>
          {ICONS.diamondOpen}
        </Text>
        <Text bold>{prompt.message}</Text>
        <Text color={MUTED_DIM}>
          ({yLabel}/{nLabel})
        </Text>
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
    if (input === "a") {
      setSelected((prev) => {
        if (prev.size === totalCount) {
          return new Set<string>();
        }
        return new Set(prompt.options.map((o) => o.value));
      });
      return;
    }
    if (key.return) {
      commit();
    }
  });

  return (
    <Box flexDirection="column" flexShrink={0} marginTop={1}>
      <Box gap={1} marginBottom={1}>
        <Text bold color={ACCENT}>
          {ICONS.diamondOpen}
        </Text>
        <Text bold>{prompt.message}</Text>
      </Box>
      <Box marginBottom={1} paddingLeft={3}>
        <Text color={MUTED_DIM}>
          space toggle {ICONS.bullet} a all {ICONS.bullet} enter confirm{" "}
          {ICONS.bullet} esc cancel
        </Text>
        <Text color={ACCENT}>
          {"  "}
          {selected.size}/{totalCount}
        </Text>
      </Box>
      <Box flexDirection="column">
        {prompt.options.map((option, idx) => {
          const isSelected = selected.has(option.value);
          const isCursor = idx === highlighted;
          const marker = isSelected ? ICONS.squareFilled : ICONS.squareOpen;
          // biome-ignore lint/nursery/noLeakedRender: variable assignment, not JSX expression
          const markerColor = isSelected ? COLOR_SUCCESS : MUTED_DIM;
          return (
            <Box flexDirection="row" key={option.value}>
              <Box flexShrink={0} width={3}>
                <Text color={ACCENT}>
                  {isCursor ? ICONS.triangleSmallRight : " "}
                </Text>
              </Box>
              <Text color={markerColor}>{marker} </Text>
              <Text bold={isCursor}>{option.label}</Text>
              {option.hint !== undefined && option.hint !== "" ? (
                <Text color={MUTED_DIM}> {option.hint}</Text>
              ) : null}
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
