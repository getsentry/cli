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
import {
  CommandOutput,
  formatFooter,
  type HumanRenderer,
} from "../../../lib/formatters/output.js";
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
  readonly around?: number;
  readonly fields?: string[];
  readonly fresh: boolean;
  readonly json: boolean;
  readonly kind?: readonly string[];
  readonly limit: number;
  readonly path?: string;
  readonly raw: boolean;
  readonly search?: string;
};

const COMMAND_NAME = "replay event list";
const USAGE_HINT =
  "sentry replay event list [<org>/<project>/]<replay-id> [path] | <replay-url> [path]";
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
  if (flags.around === undefined) {
    return {};
  }

  return {
    fromMs: Math.max(0, flags.around - DEFAULT_BEFORE_MS),
    toMs: flags.around + DEFAULT_AFTER_MS,
  };
}

function splitTargetAndPathArgs(
  args: string[],
  flagPath: string | undefined
): { targetArgs: string[]; path?: string } {
  const lastArg = args.at(-1);
  if (args.length > 1 && lastArg?.startsWith("/")) {
    if (flagPath) {
      throw new ValidationError(
        "Path provided both positionally and with --path",
        "path"
      );
    }
    return { targetArgs: args.slice(0, -1), path: lastArg };
  }

  return { targetArgs: args, path: flagPath };
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

function createEventListHumanRenderer(): HumanRenderer<ReplayEvent> {
  const events: ReplayEvent[] = [];
  return {
    render(event) {
      events.push(event);
      return "";
    },
    finalize(hint) {
      if (events.length === 0) {
        return `No replay events matched the filters.${hint ? formatFooter(hint) : "\n"}`;
      }

      const replayId = events[0]?.replayId;
      const title = replayId
        ? `Replay events for ${replayId.slice(0, 8)}:`
        : "Replay events:";
      const output = `${title}\n\n${formatTable(events, EVENT_COLUMNS, { truncate: true })}`;
      return hint ? `${output}${formatFooter(hint)}` : `${output}\n`;
    },
  };
}

function jsonTransformReplayEvent(
  event: ReplayEvent,
  fields?: string[]
): unknown {
  return fields && fields.length > 0 ? filterFields(event, fields) : event;
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
      "Add a trailing /path argument to focus the timeline on one route.\n\n" +
      "Examples:\n" +
      "  sentry replay events sentry/346789a703f6454384f1de473b8b9fcc --json\n" +
      "  sentry replay events sentry/cli/346789a703f6454384f1de473b8b9fcc --kind click,network,error --json\n" +
      '  sentry replay events sentry/346789a703f6454384f1de473b8b9fcc /signup -q "button[type=submit]" --json\n' +
      "  sentry replay events sentry/346789a703f6454384f1de473b8b9fcc --around 01:23 --json",
  },
  output: {
    human: createEventListHumanRenderer,
    jsonTransform: jsonTransformReplayEvent,
    jsonLines: true,
    schema: ReplayEventSchema,
  },
  parameters: {
    positional: {
      kind: "array",
      parameter: {
        placeholder: "replay-target",
        brief: "[<org>/<project>] <replay-id> [path] or <replay-url> [path]",
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
      path: {
        kind: "parsed",
        parse: String,
        brief: "Filter events by parsed URL pathname",
        optional: true,
      },
      search: {
        kind: "parsed",
        parse: String,
        brief:
          "Filter events by text in labels, messages, URLs, selectors, or data",
        optional: true,
      },
      around: {
        kind: "parsed",
        parse: parseOffsetFlag,
        brief: "Show an evidence window around this replay offset",
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
      fresh: FRESH_FLAG,
    },
    aliases: {
      ...FRESH_ALIASES,
      k: "kind",
      n: "limit",
      q: "search",
    },
  },
  async *func(this: SentryContext, flags: EventListFlags, ...args: string[]) {
    applyFreshFlag(flags);
    const kinds = parseEventKinds(flags.kind);
    const window = resolveWindow(flags);
    const { path, targetArgs } = splitTargetAndPathArgs(args, flags.path);

    const parsedArgs = parseReplayTargetArgs(targetArgs, USAGE_HINT);
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

    const allEvents = extractNormalizedReplayEvents(replay, segments, {
      includeRaw: flags.raw,
    });
    const filtered = filterNormalizedReplayEvents(allEvents, {
      kinds,
      path,
      contains: flags.search,
      ...window,
    });
    const events = filtered.slice(0, flags.limit);
    const truncated = filtered.length > events.length;

    for (const event of events) {
      yield new CommandOutput(event);
    }

    const countText = `Showing ${events.length} of ${filtered.length} replay event${filtered.length === 1 ? "" : "s"}.`;
    const truncationHint = truncated
      ? ` Increase --limit or narrow filters to inspect the remaining ${filtered.length - events.length}.`
      : "";
    return { hint: `${countText}${truncationHint}` };
  },
});
