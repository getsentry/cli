/**
 * sentry replay summarize
 *
 * Summarize Session Replay behavior and deterministic friction signals.
 */

import type { SentryContext } from "../../context.js";
import { validateLimit } from "../../lib/arg-parsing.js";
import { buildCommand } from "../../lib/command.js";
import { escapeMarkdownCell, formatTable } from "../../lib/formatters/index.js";
import { filterFields } from "../../lib/formatters/json.js";
import { CommandOutput } from "../../lib/formatters/output.js";
import type { Column } from "../../lib/formatters/table.js";
import { formatDurationCompactMs } from "../../lib/formatters/time-utils.js";
import { validateHexId } from "../../lib/hex-id.js";
import {
  applyFreshFlag,
  FRESH_ALIASES,
  FRESH_FLAG,
} from "../../lib/list-command.js";
import { withProgress } from "../../lib/polling.js";
import { extractNormalizedReplayEvents } from "../../lib/replay-events.js";
import { summarizeReplay } from "../../lib/replay-summary.js";
import { resolveOrgOptionalProjectFromArg } from "../../lib/resolve-target.js";
import {
  type ReplayFrictionSignal,
  type ReplayRouteSummary,
  type ReplaySummaryOutput,
  ReplaySummaryOutputSchema,
} from "../../types/index.js";
import {
  fetchReplayDetailsForCommand,
  fetchReplaySegmentsForCommand,
  validateReplayProjectScope,
} from "./shared.js";
import { parseReplayTargetArgs } from "./target.js";

type SummaryFlags = {
  readonly fields?: string[];
  readonly fresh: boolean;
  readonly json: boolean;
  readonly "limit-events": number;
  readonly "limit-signals": number;
  readonly path?: string;
};

const COMMAND_NAME = "replay summarize";
const USAGE_HINT =
  "sentry replay summarize [<org>/<project>/]<replay-id> | <replay-url>";
const DEFAULT_SIGNAL_LIMIT = 10;
const DEFAULT_EVENT_LIMIT = 12;

function parseSignalLimit(value: string): number {
  return validateLimit(value, 0, 50);
}

function parseEventLimit(value: string): number {
  return validateLimit(value, 0, 50);
}

function formatOffset(offsetMs: number | null | undefined): string {
  return offsetMs === null || offsetMs === undefined
    ? "-"
    : formatDurationCompactMs(offsetMs);
}

function formatDurationSeconds(seconds: number | null | undefined): string {
  return seconds === null || seconds === undefined ? "-" : `${seconds}s`;
}

const SIGNAL_COLUMNS: Column<ReplayFrictionSignal>[] = [
  {
    header: "OFFSET",
    value: (signal) => formatOffset(signal.offsetMs),
    minWidth: 8,
    shrinkable: false,
  },
  {
    header: "SEVERITY",
    value: (signal) => signal.severity,
    minWidth: 8,
  },
  {
    header: "SIGNAL",
    value: (signal) => signal.kind,
    minWidth: 14,
  },
  {
    header: "MESSAGE",
    value: (signal) => escapeMarkdownCell(signal.message),
    minWidth: 28,
    truncate: true,
  },
];

const ROUTE_COLUMNS: Column<ReplayRouteSummary>[] = [
  {
    header: "ENTER",
    value: (route) => formatOffset(route.enteredAtOffsetMs),
    minWidth: 8,
    shrinkable: false,
  },
  {
    header: "DURATION",
    value: (route) => formatOffset(route.durationMs),
    minWidth: 8,
    shrinkable: false,
  },
  {
    header: "EVENTS",
    value: (route) => String(route.eventCount),
    align: "right",
    minWidth: 6,
  },
  {
    header: "INTERACTIONS",
    value: (route) => formatRouteInteractions(route),
    minWidth: 12,
    truncate: true,
  },
  {
    header: "PATH",
    value: (route) => escapeMarkdownCell(route.path),
    minWidth: 24,
    truncate: true,
  },
  {
    header: "NEXT",
    value: (route) => escapeMarkdownCell(route.nextPath ?? "-"),
    minWidth: 16,
    truncate: true,
  },
];

function formatCount(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function formatNonZeroCount(
  count: number,
  singular: string,
  plural = `${singular}s`
): string | undefined {
  return count > 0 ? formatCount(count, singular, plural) : undefined;
}

function formatRouteInteractions(route: ReplayRouteSummary): string {
  const parts = [
    formatNonZeroCount(route.counts.clicks, "click"),
    formatNonZeroCount(route.counts.taps, "tap"),
    formatNonZeroCount(route.counts.inputs, "input"),
    formatNonZeroCount(route.counts.scrolls, "scroll"),
    formatNonZeroCount(route.counts.focuses, "focus", "focuses"),
    formatNonZeroCount(route.counts.blurs, "blur"),
  ].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(", ") : "-";
}

function formatRecordingStats(summary: ReplaySummaryOutput): string {
  return [
    summary.recording.segmentCount !== null
      ? formatCount(summary.recording.segmentCount, "segment")
      : undefined,
    summary.recording.frameCount !== null
      ? formatCount(summary.recording.frameCount, "raw frame")
      : undefined,
    formatCount(summary.recording.normalizedEventCount, "normalized event"),
    summary.recording.focusedEventCount !== null
      ? formatCount(summary.recording.focusedEventCount, "focused event")
      : undefined,
  ]
    .filter((part): part is string => Boolean(part))
    .join(", ");
}

function formatEventCounts(summary: ReplaySummaryOutput): string {
  return [
    formatCount(summary.counts.total, "event"),
    formatCount(summary.counts.clicks, "click"),
    formatCount(summary.counts.taps, "tap"),
    formatCount(summary.counts.inputs, "input"),
    formatCount(summary.counts.scrolls, "scroll"),
    formatCount(summary.counts.focuses, "focus", "focuses"),
    formatCount(summary.counts.blurs, "blur"),
    formatCount(summary.counts.network, "network event"),
    formatCount(summary.counts.errors, "error"),
  ].join(", ");
}

function jsonTransformSummary(
  summary: ReplaySummaryOutput,
  fields?: string[]
): unknown {
  return fields && fields.length > 0 ? filterFields(summary, fields) : summary;
}

function formatSummaryHuman(summary: ReplaySummaryOutput): string {
  const lines = [
    `Replay summary for ${summary.org}/${summary.replayId.slice(0, 8)}`,
    "",
    `Platform: ${summary.platform ?? "-"}`,
    `SDK: ${[summary.sdkName, summary.sdkVersion].filter(Boolean).join(" ") || "-"}`,
    `Replay type: ${summary.replayType ?? "-"}`,
    `Entry: ${summary.entryUrl ?? "-"}`,
    `Exit: ${summary.exitUrl ?? "-"}`,
    `Duration: ${formatDurationSeconds(summary.durationSeconds)}`,
    `Recording: ${formatRecordingStats(summary)}`,
    `Events: ${formatEventCounts(summary)}`,
  ];

  if (summary.focusPath) {
    lines.push(`Focus path: ${summary.focusPath}`);
  }

  if (summary.signals.length > 0) {
    lines.push(
      "",
      "Signals:",
      "",
      formatTable(summary.signals, SIGNAL_COLUMNS)
    );
  } else {
    lines.push("", "Signals: none detected");
  }

  if (summary.routes.length > 0) {
    lines.push("", "Routes:", "", formatTable(summary.routes, ROUTE_COLUMNS));
  }

  return lines.join("\n");
}

export const summarizeCommand = buildCommand({
  docs: {
    brief: "Summarize Session Replay behavior",
    fullDescription:
      "Summarize a Session Replay into route flow, event counts, timing facts, and deterministic friction signals.\n\n" +
      "This command does not use AI. It returns factual evidence that an agent can use for analysis.\n\n" +
      "Recording parsing is best-effort. Summary metadata includes platform, SDK, replay type, and raw recording counts so agents can tell when a replay fetched successfully but produced sparse normalized events.\n\n" +
      "Examples:\n" +
      "  sentry replay summarize sentry/346789a703f6454384f1de473b8b9fcc --json\n" +
      "  sentry replay summarize sentry/346789a703f6454384f1de473b8b9fcc --path /signup --json\n" +
      "  sentry replay summarize sentry/cli/346789a703f6454384f1de473b8b9fcc --limit-signals 20 --json",
  },
  output: {
    human: formatSummaryHuman,
    jsonTransform: jsonTransformSummary,
    schema: ReplaySummaryOutputSchema,
  },
  parameters: {
    positional: {
      kind: "array",
      parameter: {
        placeholder: "replay-id-or-url",
        brief: "[<org>/<project>] <replay-id> or <replay-url>",
        parse: String,
      },
    },
    flags: {
      path: {
        kind: "parsed",
        parse: String,
        brief: "Focus summary on events from this URL pathname",
        optional: true,
      },
      "limit-signals": {
        kind: "parsed",
        parse: parseSignalLimit,
        brief: "Maximum friction signals to include (0-50)",
        default: String(DEFAULT_SIGNAL_LIMIT),
      },
      "limit-events": {
        kind: "parsed",
        parse: parseEventLimit,
        brief: "Maximum notable events to include (0-50)",
        default: String(DEFAULT_EVENT_LIMIT),
      },
      fresh: FRESH_FLAG,
    },
    aliases: {
      ...FRESH_ALIASES,
    },
  },
  async *func(this: SentryContext, flags: SummaryFlags, ...args: string[]) {
    applyFreshFlag(flags);

    const parsedArgs = parseReplayTargetArgs(args, USAGE_HINT);
    const replayId = validateHexId(parsedArgs.replayId, "replay ID");
    const resolved = await resolveOrgOptionalProjectFromArg(
      parsedArgs.targetArg,
      this.cwd,
      COMMAND_NAME
    );

    const replay = await withProgress(
      { message: "Fetching replay metadata...", json: flags.json },
      () =>
        fetchReplayDetailsForCommand(
          resolved.org,
          replayId,
          "sentry replay summarize"
        )
    );

    validateReplayProjectScope({
      replay,
      projectId: resolved.projectData?.id,
      replayId,
      org: resolved.org,
      project: resolved.project,
      command: "sentry replay summarize",
    });

    const segments = await fetchReplaySegmentsForCommand({
      org: resolved.org,
      replay,
      replayId,
      project: resolved.project,
      json: flags.json,
    });

    const events = extractNormalizedReplayEvents(replay, segments);
    const recordingFrameCount = segments.reduce(
      (count, segment) => count + segment.length,
      0
    );
    const summary = summarizeReplay(replay, events, {
      org: resolved.org,
      project: resolved.project,
      focusPath: flags.path,
      maxSignals: flags["limit-signals"],
      maxNotableEvents: flags["limit-events"],
      recordingFrameCount,
      recordingSegmentCount: segments.length,
    });

    yield new CommandOutput(summary);
    return {
      hint:
        summary.signals.length > 0
          ? `Detected ${summary.signals.length} friction signal${summary.signals.length === 1 ? "" : "s"}. Cite replay ID and offset when reporting findings.`
          : "No deterministic friction signals detected. Use route flow and notable events for behavior context.",
    };
  },
});
