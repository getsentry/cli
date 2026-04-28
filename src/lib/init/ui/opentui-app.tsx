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
 *   │  ║  ▸ sentry init            ║  ║  ──────────────          ║   │
 *   │  ║  ──────────                ║  ║  <tip title>             ║   │
 *   │  ║  ●  log line              ║  ║  <tip body, wrapped>     ║   │
 *   │  ║  ▲  log line              ║  ║                          ║   │
 *   │  ║  ◒  spinner...            ║  ║  Tip 3 of 12             ║   │
 *   │  ║  <prompt area>            ║  ╚══════════════════════════╝   │
 *   │  ╚═══════════════════════════╝                                 │
 *   └────────────────────────────────────────────────────────────────┘
 *
 * Why an external store rather than React state owned by the App?
 * The `WizardUI` interface is imperative (the wizard runner calls
 * `ui.log.info(...)` from a generator). Threading those calls through
 * React's state setters from outside React would require keeping a
 * mutable reference to a setter that gets bound on first render —
 * fragile, especially with concurrent mode. An external store keeps
 * the imperative side decoupled from React's lifecycle.
 */

import { useKeyboard } from "@opentui/react";
import { useState, useSyncExternalStore } from "react";
import type {
  ActivePrompt,
  LogEntry,
  LogSeverity,
  SpinnerState,
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
 * Root component. Subscribes to the store once at the top, then drills
 * the snapshot fields into individual presentational components.
 */
export function App({ store }: AppProps): React.ReactNode {
  const snapshot = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot
  );

  return (
    <box
      borderColor={MUTED}
      borderStyle="rounded"
      flexDirection="column"
      flexGrow={1}
      padding={1}
      title=" Sentry init "
      titleAlignment="left"
    >
      <box flexDirection="row" flexGrow={1} gap={2}>
        <MainColumn
          bannerRows={snapshot.bannerRows}
          intro={snapshot.intro}
          logs={snapshot.logs}
          prompt={snapshot.prompt}
          spinner={snapshot.spinner}
          summary={snapshot.summary}
        />
        <Sidebar tipIndex={snapshot.tipIndex} />
      </box>
    </box>
  );
}

// ──────────────────────────── Main column ─────────────────────────────

type MainColumnProps = {
  bannerRows: { content: string; color: string }[];
  intro: string;
  logs: LogEntry[];
  spinner: SpinnerState;
  prompt: ActivePrompt | null;
  summary: WizardSummary | null;
};

function MainColumn({
  bannerRows,
  intro,
  logs,
  spinner,
  prompt,
  summary,
}: MainColumnProps): React.ReactNode {
  return (
    <box flexDirection="column" flexGrow={1}>
      <Header bannerRows={bannerRows} intro={intro} />
      <Divider />
      <box flexDirection="column" flexGrow={1}>
        {logs.map((log) => (
          <LogLine entry={log} key={log.id} />
        ))}
      </box>
      {spinner.active ? <SpinnerRow state={spinner} /> : null}
      {summary ? <SummaryPanel summary={summary} /> : null}
      {prompt ? <PromptArea prompt={prompt} /> : null}
    </box>
  );
}

function Header({
  bannerRows,
  intro,
}: {
  bannerRows: { content: string; color: string }[];
  intro: string;
}): React.ReactNode {
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
      {intro ? (
        <text fg={ACCENT} marginTop={1}>
          ▸ {intro}
        </text>
      ) : null}
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
        <box flexDirection="column" flexShrink={0} marginTop={1}>
          <text fg={MUTED}>Changed files</text>
          {summary.changedFiles.map((file) => (
            <ChangedFileRow file={file} key={file.path} />
          ))}
        </box>
      ) : null}
    </box>
  );
}

function ChangedFileRow({
  file,
}: {
  file: { action: string; path: string };
}): React.ReactNode {
  const { glyph, color } = changedFileStyle(file.action);
  return (
    <box flexDirection="row" flexShrink={0}>
      <text fg={color} width={3}>
        {glyph}
      </text>
      <text fg={FOREGROUND} flexGrow={1}>
        {file.path}
      </text>
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
  return (
    <box flexDirection="column" flexShrink={0} gap={1} marginTop={1}>
      <text fg={FOREGROUND}>{prompt.message}</text>
      <select
        descriptionColor={MUTED}
        focused
        focusedTextColor={FOREGROUND}
        height={Math.min(prompt.options.length + 1, 8)}
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
        showDescription
        showScrollIndicator={prompt.options.length > 8}
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

  const decoratedOptions = prompt.options.map((option) => ({
    name: `${selected.has(option.value) ? "◉" : "◯"} ${option.label}`,
    description: option.hint ?? "",
    value: option.value,
  }));

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

  return (
    <box flexDirection="column" flexShrink={0} gap={1} marginTop={1}>
      <text fg={FOREGROUND}>{prompt.message}</text>
      <text fg={MUTED}>space toggle · enter confirm · esc cancel</text>
      <select
        descriptionColor={MUTED}
        focused
        focusedTextColor={FOREGROUND}
        height={Math.min(prompt.options.length + 2, 10)}
        onChange={(index) => setHighlighted(index)}
        options={decoratedOptions}
        selectedBackgroundColor={ACCENT}
        selectedTextColor="#FFFFFF"
        showDescription
        showScrollIndicator={prompt.options.length > 10}
        textColor={FOREGROUND}
      />
    </box>
  );
}

// ────────────────────────────── Sidebar ───────────────────────────────

function Sidebar({ tipIndex }: { tipIndex: number }): React.ReactNode {
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
      padding={1}
      title=" Did you know? "
      titleAlignment="left"
      width={36}
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
