/**
 * sentry replay view
 *
 * View detailed information about a Session Replay.
 */

import type { SentryContext } from "../../context.js";
import { getReplay } from "../../lib/api-client.js";
import {
  detectSwappedViewArgs,
  parseSlashSeparatedArg,
} from "../../lib/arg-parsing.js";
import { openInBrowser } from "../../lib/browser.js";
import { buildCommand } from "../../lib/command.js";
import { ApiError, ContextError, ResolutionError } from "../../lib/errors.js";
import {
  escapeMarkdownCell,
  escapeMarkdownInline,
  mdKvTable,
  renderMarkdown,
} from "../../lib/formatters/index.js";
import { filterFields } from "../../lib/formatters/json.js";
import { CommandOutput } from "../../lib/formatters/output.js";
import { validateHexId } from "../../lib/hex-id.js";
import {
  applyFreshFlag,
  FRESH_ALIASES,
  FRESH_FLAG,
} from "../../lib/list-command.js";
import { resolveOrgOptionalProjectFromArg } from "../../lib/resolve-target.js";
import { buildReplayUrl } from "../../lib/sentry-urls.js";
import type { ReplayDetails } from "../../types/index.js";
import { ReplayDetailsSchema } from "../../types/index.js";

type ViewFlags = {
  readonly json: boolean;
  readonly web: boolean;
  readonly fresh: boolean;
  readonly fields?: string[];
};

type ParsedPositionalArgs = {
  replayId: string;
  targetArg: string | undefined;
  warning?: string;
};

type MarkdownRow = [string, string];

const USAGE_HINT = "sentry replay view [<org>/<project>/]<replay-id>";
const REPLAY_ID_SEGMENT_RE = /^[0-9a-fA-F-]{16,36}$/;

function pluralize(value: number, singular: string): string {
  return `${value} ${singular}${value === 1 ? "" : "s"}`;
}

function formatReplayDuration(seconds: number): string {
  const rounded = Math.max(0, Math.round(seconds));
  if (rounded < 60) {
    return pluralize(rounded, "second");
  }

  const minutes = Math.floor(rounded / 60);
  const remainingSeconds = rounded % 60;
  if (minutes < 60) {
    return remainingSeconds > 0
      ? `${pluralize(minutes, "minute")} and ${pluralize(remainingSeconds, "second")}`
      : pluralize(minutes, "minute");
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours < 24) {
    return remainingMinutes > 0
      ? `${pluralize(hours, "hour")} and ${pluralize(remainingMinutes, "minute")}`
      : pluralize(hours, "hour");
  }

  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return remainingHours > 0
    ? `${pluralize(days, "day")} and ${pluralize(remainingHours, "hour")}`
    : pluralize(days, "day");
}

function parseSingleArg(arg: string): ParsedPositionalArgs {
  const trimmed = arg.trim();
  if (!trimmed) {
    throw new ContextError("Replay ID", USAGE_HINT, []);
  }

  const slashIdx = trimmed.indexOf("/");
  if (slashIdx !== -1 && trimmed.indexOf("/", slashIdx + 1) === -1) {
    const org = trimmed.slice(0, slashIdx);
    const replaySegment = trimmed.slice(slashIdx + 1);
    if (!(replaySegment && REPLAY_ID_SEGMENT_RE.test(replaySegment))) {
      throw new ContextError("Replay ID", USAGE_HINT, []);
    }
    return { replayId: replaySegment, targetArg: `${org}/` };
  }

  const { id: replayId, targetArg } = parseSlashSeparatedArg(
    trimmed,
    "Replay ID",
    USAGE_HINT
  );
  return { replayId, targetArg };
}

/**
 * Parse replay view positional arguments.
 *
 * Supports:
 * - `<replay-id>`
 * - `<org>/<replay-id>`
 * - `<org>/<project>/<replay-id>`
 * - `<target> <replay-id>`
 */
export function parsePositionalArgs(args: string[]): ParsedPositionalArgs {
  if (args.length === 0) {
    throw new ContextError("Replay ID", USAGE_HINT, []);
  }

  const first = args[0];
  if (!first) {
    throw new ContextError("Replay ID", USAGE_HINT, []);
  }

  if (args.length === 1) {
    return parseSingleArg(first);
  }

  const second = args[1];
  if (!second) {
    throw new ContextError("Replay ID", USAGE_HINT, []);
  }

  const warning =
    args.length === 2 ? detectSwappedViewArgs(first, second) : null;
  if (warning) {
    return {
      replayId: first,
      targetArg: second,
      warning,
    };
  }

  return { replayId: second, targetArg: first };
}

function replayUserLabel(replay: ReplayDetails): string | undefined {
  const user = replay.user;
  if (!user) {
    return;
  }
  return (
    user.display_name ??
    user.username ??
    user.email ??
    user.id ??
    user.ip ??
    undefined
  );
}

function formatList(values: string[] | undefined): string | undefined {
  if (!values || values.length === 0) {
    return;
  }
  return values.map((value) => `- \`${value}\``).join("\n");
}

function pushMarkdownRow(
  rows: MarkdownRow[],
  label: string,
  value: string | undefined
): void {
  if (!value) {
    return;
  }
  rows.push([label, value]);
}

function formatYesNo(value: boolean | null | undefined): string | undefined {
  if (value === null || value === undefined) {
    return;
  }
  return value ? "Yes" : "No";
}

function formatNullableCount(
  value: number | null | undefined
): string | undefined {
  if (value === null || value === undefined) {
    return;
  }
  return String(value);
}

function formatJoinedMarkdown(
  values: Array<string | null | undefined>
): string | undefined {
  const joined = values.filter(Boolean).join(" ");
  return joined ? escapeMarkdownCell(joined) : undefined;
}

function formatReplayLocation(replay: ReplayDetails): string | undefined {
  const geo = replay.user?.geo;
  if (!geo) {
    return;
  }

  const location = [geo.city, geo.region, geo.country_code]
    .filter(Boolean)
    .join(", ");
  return location ? escapeMarkdownCell(location) : undefined;
}

function buildReplayOverviewRows(replay: ReplayDetails): MarkdownRow[] {
  const rows: MarkdownRow[] = [["Replay ID", `\`${replay.id}\``]];

  pushMarkdownRow(
    rows,
    "Started",
    replay.started_at ? new Date(replay.started_at).toLocaleString() : undefined
  );
  pushMarkdownRow(
    rows,
    "Finished",
    replay.finished_at
      ? new Date(replay.finished_at).toLocaleString()
      : undefined
  );
  pushMarkdownRow(
    rows,
    "Duration",
    replay.duration !== null && replay.duration !== undefined
      ? formatReplayDuration(replay.duration)
      : undefined
  );
  pushMarkdownRow(
    rows,
    "Environment",
    replay.environment ? escapeMarkdownCell(replay.environment) : undefined
  );
  pushMarkdownRow(
    rows,
    "Platform",
    replay.platform ? escapeMarkdownCell(replay.platform) : undefined
  );
  pushMarkdownRow(rows, "Project ID", replay.project_id ?? undefined);
  pushMarkdownRow(
    rows,
    "Replay Type",
    replay.replay_type ? escapeMarkdownCell(replay.replay_type) : undefined
  );
  pushMarkdownRow(rows, "Archived", formatYesNo(replay.is_archived));
  pushMarkdownRow(rows, "Viewed", formatYesNo(replay.has_viewed));
  pushMarkdownRow(rows, "Errors", formatNullableCount(replay.count_errors));
  pushMarkdownRow(rows, "Segments", formatNullableCount(replay.count_segments));
  pushMarkdownRow(
    rows,
    "Rage Clicks",
    formatNullableCount(replay.count_rage_clicks)
  );
  pushMarkdownRow(
    rows,
    "Dead Clicks",
    formatNullableCount(replay.count_dead_clicks)
  );

  return rows;
}

function buildReplayUserRows(replay: ReplayDetails): MarkdownRow[] {
  const rows: MarkdownRow[] = [];
  const userLabel = replayUserLabel(replay);
  pushMarkdownRow(
    rows,
    "User",
    userLabel ? escapeMarkdownCell(userLabel) : undefined
  );
  pushMarkdownRow(
    rows,
    "Email",
    replay.user?.email ? escapeMarkdownCell(replay.user.email) : undefined
  );
  pushMarkdownRow(
    rows,
    "IP",
    replay.user?.ip ? escapeMarkdownCell(replay.user.ip) : undefined
  );
  pushMarkdownRow(rows, "Location", formatReplayLocation(replay));
  return rows;
}

function buildReplayClientRows(replay: ReplayDetails): MarkdownRow[] {
  const rows: MarkdownRow[] = [];
  pushMarkdownRow(
    rows,
    "Browser",
    formatJoinedMarkdown([replay.browser?.name, replay.browser?.version])
  );
  pushMarkdownRow(
    rows,
    "OS",
    formatJoinedMarkdown([replay.os?.name, replay.os?.version])
  );
  pushMarkdownRow(
    rows,
    "Device",
    formatJoinedMarkdown([
      replay.device?.brand,
      replay.device?.family,
      replay.device?.name,
      replay.device?.model_id,
    ])
  );
  pushMarkdownRow(
    rows,
    "SDK",
    formatJoinedMarkdown([replay.sdk?.name, replay.sdk?.version])
  );
  pushMarkdownRow(
    rows,
    "Dist",
    replay.dist ? escapeMarkdownCell(replay.dist) : undefined
  );
  return rows;
}

function pushKvSection(
  lines: string[],
  rows: MarkdownRow[],
  title?: string
): void {
  if (rows.length === 0) {
    return;
  }
  lines.push("");
  lines.push(mdKvTable(rows, title));
}

function pushListSection(
  lines: string[],
  title: string,
  values: string[] | undefined
): void {
  const content = formatList(values);
  if (!content) {
    return;
  }
  lines.push("");
  lines.push(`### ${title}`);
  lines.push("");
  lines.push(content);
}

function pushTagsSection(lines: string[], replay: ReplayDetails): void {
  if (
    !replay.tags ||
    Array.isArray(replay.tags) ||
    Object.keys(replay.tags).length === 0
  ) {
    return;
  }

  lines.push("");
  lines.push("### Tags");
  lines.push("");
  for (const [key, values] of Object.entries(replay.tags).sort()) {
    lines.push(
      `- \`${escapeMarkdownInline(key)}\`: ${values.map((value) => `\`${escapeMarkdownInline(value)}\``).join(", ")}`
    );
  }
}

function formatReplayDetails(replay: ReplayDetails): string {
  const lines: string[] = [];

  lines.push(`## Replay \`${replay.id.slice(0, 8)}\``);
  lines.push("");
  lines.push(mdKvTable(buildReplayOverviewRows(replay)));

  pushKvSection(lines, buildReplayUserRows(replay), "User");
  pushKvSection(lines, buildReplayClientRows(replay), "Client");

  pushListSection(lines, "Releases", replay.releases);
  pushListSection(lines, "URLs", replay.urls);
  pushListSection(lines, "Trace IDs", replay.trace_ids);
  pushListSection(lines, "Error IDs", replay.error_ids);
  pushTagsSection(lines, replay);

  return renderMarkdown(lines.join("\n"));
}

function replayHint(org: string, replay: ReplayDetails): string | undefined {
  const traceId = replay.trace_ids?.[0];
  if (traceId) {
    return `Related trace: sentry trace view ${org}/${traceId}`;
  }
  return;
}

export const viewCommand = buildCommand({
  docs: {
    brief: "View a Session Replay",
    fullDescription:
      "View detailed information about a Session Replay.\n\n" +
      "Replay ID formats:\n" +
      "  <replay-id>              - auto-detect org from config or DSN\n" +
      "  <org>/<replay-id>        - explicit organization\n" +
      "  <org>/<project>/<id>     - explicit org/project context\n\n" +
      "Examples:\n" +
      "  sentry replay view 346789a703f6454384f1de473b8b9fcc\n" +
      "  sentry replay view sentry/346789a703f6454384f1de473b8b9fcc\n" +
      "  sentry replay view sentry/cli/346789a703f6454384f1de473b8b9fcc\n" +
      "  sentry replay view --web sentry/346789a703f6454384f1de473b8b9fcc",
  },
  output: {
    human: formatReplayDetails,
    jsonTransform: (replay: ReplayDetails, fields?: string[]) =>
      fields && fields.length > 0 ? filterFields(replay, fields) : replay,
    schema: ReplayDetailsSchema,
  },
  parameters: {
    positional: {
      kind: "array",
      parameter: {
        placeholder: "org/project/replay-id",
        brief:
          "[<org>/<project>] <replay-id> - Target (optional) and replay ID (required)",
        parse: String,
      },
    },
    flags: {
      web: {
        kind: "boolean",
        brief: "Open in browser",
        default: false,
      },
      fresh: FRESH_FLAG,
    },
    aliases: { ...FRESH_ALIASES, w: "web" },
  },
  async *func(this: SentryContext, flags: ViewFlags, ...args: string[]) {
    applyFreshFlag(flags);
    const { cwd } = this;

    const parsedArgs = parsePositionalArgs(args);
    if (parsedArgs.warning) {
      this.stderr.write(`${parsedArgs.warning}\n`);
    }

    const replayId = validateHexId(parsedArgs.replayId, "replay ID");
    const resolved = await resolveOrgOptionalProjectFromArg(
      parsedArgs.targetArg,
      cwd,
      "replay view"
    );

    if (flags.web) {
      await openInBrowser(buildReplayUrl(resolved.org, replayId), "replay");
      return;
    }

    let replay: ReplayDetails;
    try {
      replay = await getReplay(resolved.org, replayId);
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        throw new ResolutionError(
          `Replay '${replayId}'`,
          "not found",
          `sentry replay view ${resolved.org}/${replayId}`,
          [
            "Check that you are querying the right organization",
            "The replay may be past your retention window",
          ]
        );
      }
      throw error;
    }

    yield new CommandOutput(replay);
    return { hint: replayHint(resolved.org, replay) };
  },
});
