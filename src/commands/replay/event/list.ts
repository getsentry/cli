/**
 * sentry replay event list
 *
 * List normalized events extracted from a Session Replay recording.
 */

import type { SentryContext } from "../../../context.js";
import { validateLimit } from "../../../lib/arg-parsing.js";
import { buildCommand } from "../../../lib/command.js";
import { ValidationError } from "../../../lib/errors.js";
import {
  escapeMarkdownCell,
  formatTable,
} from "../../../lib/formatters/index.js";
import { filterFields } from "../../../lib/formatters/json.js";
import { CommandOutput } from "../../../lib/formatters/output.js";
import type { Column } from "../../../lib/formatters/table.js";
import { formatDurationCompactMs } from "../../../lib/formatters/time-utils.js";
import { validateHexId } from "../../../lib/hex-id.js";
import {
  applyFreshFlag,
  FRESH_ALIASES,
  FRESH_FLAG,
  LIST_MAX_LIMIT,
  LIST_MIN_LIMIT,
} from "../../../lib/list-command.js";
import { withProgress } from "../../../lib/polling.js";
import {
  extractNormalizedReplayEvents,
  filterNormalizedReplayEvents,
  parseReplayOffset,
} from "../../../lib/replay-events.js";
import { resolveOrgOptionalProjectFromArg } from "../../../lib/resolve-target.js";
import {
  REPLAY_EVENT_KINDS,
  type ReplayEvent,
  type ReplayEventKind,
  ReplayEventSchema,
} from "../../../types/index.js";
import {
  fetchReplayDetailsForCommand,
  fetchReplaySegmentsForCommand,
  validateReplayProjectScope,
} from "../shared.js";
import { parseReplayTargetArgs } from "../target.js";

type EventListFlags = {
  readonly after?: number;
  readonly around?: number;
  readonly before?: number;
  readonly contains?: string;
  readonly fields?: string[];
  readonly fresh: boolean;
  readonly from?: number;
  readonly json: boolean;
  readonly jsonl: boolean;
  readonly kind?: readonly string[];
  readonly limit: number;
  readonly path?: string;
  readonly raw: boolean;
  readonly selector?: string;
  readonly to?: number;
  readonly url?: string;
};

type EventListResult = {
  events: ReplayEvent[];
  total: number;
  truncated: boolean;
  replayId: string;
  org: string;
  project?: string;
};

type ReplayEventOutput = EventListResult | ReplayEvent;

const COMMAND_NAME = "replay event list";
const USAGE_HINT =
  "sentry replay event list [<org>/<project>/]<replay-id> | <replay-url>";
const DEFAULT_LIMIT = 200;
const DEFAULT_BEFORE_MS = 10_000;
const DEFAULT_AFTER_MS = 30_000;

const REPLAY_EVENT_KIND_SET = new Set<string>(REPLAY_EVENT_KINDS);

function parseLimit(value: string): number {
  return validateLimit(value, LIST_MIN_LIMIT, LIST_MAX_LIMIT);
}

function parseOffsetFlag(value: string): number {
  return parseReplayOffset(value);
}

function parseEventKinds(
  values: readonly string[] | undefined
): ReplayEventKind[] {
  const kinds = values
    ? [...values]
        .flatMap((value) => value.split(","))
        .map((value) => value.trim())
        .filter(Boolean)
    : [];

  for (const kind of kinds) {
    if (!REPLAY_EVENT_KIND_SET.has(kind)) {
      throw new ValidationError(
        `Invalid replay event kind "${kind}". Must be one of: ${REPLAY_EVENT_KINDS.join(", ")}`,
        "kind"
      );
    }
  }

  return kinds as ReplayEventKind[];
}

function resolveWindow(flags: EventListFlags): {
  fromMs?: number;
  toMs?: number;
} {
  if (
    flags.around !== undefined &&
    (flags.from !== undefined || flags.to !== undefined)
  ) {
    throw new ValidationError(
      "--around cannot be combined with --from or --to",
      "around"
    );
  }

  if (flags.around === undefined) {
    return { fromMs: flags.from, toMs: flags.to };
  }

  const before = flags.before ?? DEFAULT_BEFORE_MS;
  const after = flags.after ?? DEFAULT_AFTER_MS;
  return {
    fromMs: Math.max(0, flags.around - before),
    toMs: flags.around + after,
  };
}

function eventLabel(event: ReplayEvent): string {
  return event.label ?? event.message ?? event.selector ?? "—";
}

function formatOffset(event: ReplayEvent): string {
  return event.offsetMs === null
    ? "—"
    : formatDurationCompactMs(event.offsetMs);
}

const EVENT_COLUMNS: Column<ReplayEvent>[] = [
  {
    header: "OFFSET",
    value: formatOffset,
    minWidth: 8,
    shrinkable: false,
  },
  {
    header: "KIND",
    value: (event) => event.kind,
    minWidth: 10,
  },
  {
    header: "LABEL",
    value: (event) => escapeMarkdownCell(eventLabel(event)),
    minWidth: 18,
    truncate: true,
  },
  {
    header: "URL",
    value: (event) => escapeMarkdownCell(event.url ?? "—"),
    minWidth: 20,
    truncate: true,
  },
  {
    header: "POINTER",
    value: (event) => `${event.segmentIndex}:${event.frameIndex}`,
    minWidth: 9,
    shrinkable: false,
  },
];

function formatEventListHuman(result: EventListResult): string {
  if (result.events.length === 0) {
    return "No replay events matched the filters.";
  }

  const scope = result.project
    ? `${result.org}/${result.project}`
    : `${result.org}`;
  return (
    `Replay events for ${scope}/${result.replayId.slice(0, 8)}:\n\n` +
    formatTable(result.events, EVENT_COLUMNS, { truncate: true })
  );
}

function isEventListResult(data: ReplayEventOutput): data is EventListResult {
  return "events" in data;
}

function jsonTransformEventOutput(
  data: ReplayEventOutput,
  fields?: string[]
): unknown {
  if (!isEventListResult(data)) {
    return fields && fields.length > 0 ? filterFields(data, fields) : data;
  }

  const items =
    fields && fields.length > 0
      ? data.events.map((event) => filterFields(event, fields))
      : data.events;
  return {
    data: items,
    total: data.total,
    truncated: data.truncated,
    replayId: data.replayId,
    org: data.org,
    project: data.project,
  };
}

function validateJsonlMode(flags: EventListFlags): void {
  if (flags.jsonl && !flags.json) {
    throw new ValidationError("--jsonl requires --json", "jsonl");
  }
}

export const listCommand = buildCommand({
  docs: {
    brief: "List normalized events from a Session Replay",
    fullDescription:
      "List normalized events extracted from Session Replay recording segments.\n\n" +
      "Replay ID formats:\n" +
      "  <replay-id>              - auto-detect org from config or DSN\n" +
      "  <org>/<replay-id>        - explicit organization\n" +
      "  <org>/<project>/<id>     - explicit org/project context\n" +
      "  <replay-url>             - parse org and replay ID from a Sentry URL\n\n" +
      "Examples:\n" +
      "  sentry replay events sentry/346789a703f6454384f1de473b8b9fcc --json\n" +
      "  sentry replay event list sentry/cli/346789a703f6454384f1de473b8b9fcc --kind click,network,error\n" +
      "  sentry replay events sentry/346789a703f6454384f1de473b8b9fcc --path /signup --json\n" +
      "  sentry replay events sentry/346789a703f6454384f1de473b8b9fcc --around 01:23 --json\n" +
      "  sentry replay events sentry/346789a703f6454384f1de473b8b9fcc --json --jsonl",
  },
  output: {
    human: formatEventListHuman,
    jsonTransform: jsonTransformEventOutput,
    schema: ReplayEventSchema,
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
      kind: {
        kind: "parsed",
        parse: String,
        brief: `Event kind filter (${REPLAY_EVENT_KINDS.join(", ")})`,
        variadic: true,
        optional: true,
      },
      url: {
        kind: "parsed",
        parse: String,
        brief: "Filter events by current or target URL substring",
        optional: true,
      },
      path: {
        kind: "parsed",
        parse: String,
        brief: "Filter events by parsed URL pathname",
        optional: true,
      },
      contains: {
        kind: "parsed",
        parse: String,
        brief:
          "Filter events by text in labels, messages, URLs, selectors, or data",
        optional: true,
      },
      selector: {
        kind: "parsed",
        parse: String,
        brief: "Filter events by selector substring",
        optional: true,
      },
      from: {
        kind: "parsed",
        parse: parseOffsetFlag,
        brief: "Start offset (seconds, 90s, 01:23, or 1:02:03)",
        optional: true,
      },
      to: {
        kind: "parsed",
        parse: parseOffsetFlag,
        brief: "End offset (seconds, 90s, 01:23, or 1:02:03)",
        optional: true,
      },
      around: {
        kind: "parsed",
        parse: parseOffsetFlag,
        brief: "Center an evidence window around this offset",
        optional: true,
      },
      before: {
        kind: "parsed",
        parse: parseOffsetFlag,
        brief: "Window before --around (default: 10s)",
        optional: true,
      },
      after: {
        kind: "parsed",
        parse: parseOffsetFlag,
        brief: "Window after --around (default: 30s)",
        optional: true,
      },
      limit: {
        kind: "parsed",
        parse: parseLimit,
        brief: `Number of events (${LIST_MIN_LIMIT}-${LIST_MAX_LIMIT})`,
        default: String(DEFAULT_LIMIT),
      },
      raw: {
        kind: "boolean",
        brief: "Include raw source frame payloads in JSON output",
        default: false,
      },
      jsonl: {
        kind: "boolean",
        brief: "Emit one JSON object per event (requires --json)",
        default: false,
      },
      fresh: FRESH_FLAG,
    },
    aliases: {
      ...FRESH_ALIASES,
      k: "kind",
      n: "limit",
      q: "contains",
      u: "url",
    },
  },
  async *func(this: SentryContext, flags: EventListFlags, ...args: string[]) {
    validateJsonlMode(flags);
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
          "sentry replay event list"
        )
    );

    validateReplayProjectScope({
      replay,
      projectId: resolved.projectData?.id,
      replayId,
      org: resolved.org,
      project: resolved.project,
      command: "sentry replay event list",
    });

    const segments = await fetchReplaySegmentsForCommand({
      org: resolved.org,
      replay,
      replayId,
      project: resolved.project,
      json: flags.json,
    });

    const kinds = parseEventKinds(flags.kind);
    const window = resolveWindow(flags);
    const allEvents = extractNormalizedReplayEvents(replay, segments, {
      includeRaw: flags.raw,
    });
    const filtered = filterNormalizedReplayEvents(allEvents, {
      kinds,
      url: flags.url,
      path: flags.path,
      contains: flags.contains,
      selector: flags.selector,
      ...window,
    });
    const events = filtered.slice(0, flags.limit);
    const truncated = filtered.length > events.length;

    if (flags.jsonl) {
      for (const event of events) {
        yield new CommandOutput<ReplayEventOutput>(event);
      }
      return;
    }

    yield new CommandOutput<ReplayEventOutput>({
      events,
      total: filtered.length,
      truncated,
      replayId,
      org: resolved.org,
      project: resolved.project,
    });

    const countText = `Showing ${events.length} of ${filtered.length} replay event${filtered.length === 1 ? "" : "s"}.`;
    const truncationHint = truncated
      ? ` Increase --limit or narrow filters to inspect the remaining ${filtered.length - events.length}.`
      : "";
    return { hint: `${countText}${truncationHint}` };
  },
});
