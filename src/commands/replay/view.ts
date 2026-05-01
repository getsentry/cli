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
import {
  ApiError,
  ContextError,
  ResolutionError,
} from "../../lib/errors.js";
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
    const replayId = trimmed.slice(slashIdx + 1);
    if (!replayId || !REPLAY_ID_SEGMENT_RE.test(replayId)) {
      throw new ContextError("Replay ID", USAGE_HINT, []);
    }
    return { replayId, targetArg: `${org}/` };
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

function formatReplayDetails(replay: ReplayDetails): string {
  const lines: string[] = [];
  const kvRows: [string, string][] = [["Replay ID", `\`${replay.id}\``]];

  if (replay.started_at) {
    kvRows.push(["Started", new Date(replay.started_at).toLocaleString()]);
  }
  if (replay.finished_at) {
    kvRows.push(["Finished", new Date(replay.finished_at).toLocaleString()]);
  }
  if (replay.duration !== null && replay.duration !== undefined) {
    kvRows.push(["Duration", formatReplayDuration(replay.duration)]);
  }
  if (replay.environment) {
    kvRows.push(["Environment", escapeMarkdownCell(replay.environment)]);
  }
  if (replay.platform) {
    kvRows.push(["Platform", escapeMarkdownCell(replay.platform)]);
  }
  if (replay.project_id) {
    kvRows.push(["Project ID", replay.project_id]);
  }
  if (replay.replay_type) {
    kvRows.push(["Replay Type", escapeMarkdownCell(replay.replay_type)]);
  }
  if (replay.is_archived !== undefined && replay.is_archived !== null) {
    kvRows.push(["Archived", replay.is_archived ? "Yes" : "No"]);
  }
  if (replay.has_viewed !== undefined && replay.has_viewed !== null) {
    kvRows.push(["Viewed", replay.has_viewed ? "Yes" : "No"]);
  }
  if (replay.count_errors !== null && replay.count_errors !== undefined) {
    kvRows.push(["Errors", String(replay.count_errors)]);
  }
  if (replay.count_segments !== null && replay.count_segments !== undefined) {
    kvRows.push(["Segments", String(replay.count_segments)]);
  }
  if (
    replay.count_rage_clicks !== null &&
    replay.count_rage_clicks !== undefined
  ) {
    kvRows.push(["Rage Clicks", String(replay.count_rage_clicks)]);
  }
  if (
    replay.count_dead_clicks !== null &&
    replay.count_dead_clicks !== undefined
  ) {
    kvRows.push(["Dead Clicks", String(replay.count_dead_clicks)]);
  }

  lines.push(`## Replay \`${replay.id.slice(0, 8)}\``);
  lines.push("");
  lines.push(mdKvTable(kvRows));

  const userRows: [string, string][] = [];
  if (replayUserLabel(replay)) {
    userRows.push(["User", escapeMarkdownCell(replayUserLabel(replay) ?? "")]);
  }
  if (replay.user?.email) {
    userRows.push(["Email", escapeMarkdownCell(replay.user.email)]);
  }
  if (replay.user?.ip) {
    userRows.push(["IP", escapeMarkdownCell(replay.user.ip)]);
  }
  if (replay.user?.geo) {
    const geoParts = [
      replay.user.geo.city,
      replay.user.geo.region,
      replay.user.geo.country_code,
    ].filter(Boolean);
    if (geoParts.length > 0) {
      userRows.push(["Location", escapeMarkdownCell(geoParts.join(", "))]);
    }
  }
  if (userRows.length > 0) {
    lines.push("");
    lines.push(mdKvTable(userRows, "User"));
  }

  const clientRows: [string, string][] = [];
  if (replay.browser?.name || replay.browser?.version) {
    clientRows.push([
      "Browser",
      escapeMarkdownCell(
        [replay.browser.name, replay.browser.version].filter(Boolean).join(" ")
      ),
    ]);
  }
  if (replay.os?.name || replay.os?.version) {
    clientRows.push([
      "OS",
      escapeMarkdownCell(
        [replay.os.name, replay.os.version].filter(Boolean).join(" ")
      ),
    ]);
  }
  if (replay.device?.family || replay.device?.name || replay.device?.model_id) {
    clientRows.push([
      "Device",
      escapeMarkdownCell(
        [
          replay.device.brand,
          replay.device.family,
          replay.device.name,
          replay.device.model_id,
        ]
          .filter(Boolean)
          .join(" ")
      ),
    ]);
  }
  if (replay.sdk?.name || replay.sdk?.version) {
    clientRows.push([
      "SDK",
      escapeMarkdownCell(
        [replay.sdk.name, replay.sdk.version].filter(Boolean).join(" ")
      ),
    ]);
  }
  if (replay.dist) {
    clientRows.push(["Dist", escapeMarkdownCell(replay.dist)]);
  }
  if (clientRows.length > 0) {
    lines.push("");
    lines.push(mdKvTable(clientRows, "Client"));
  }

  const releases = formatList(replay.releases);
  if (releases) {
    lines.push("");
    lines.push("### Releases");
    lines.push("");
    lines.push(releases);
  }

  const urls = formatList(replay.urls);
  if (urls) {
    lines.push("");
    lines.push("### URLs");
    lines.push("");
    lines.push(urls);
  }

  const traces = formatList(replay.trace_ids);
  if (traces) {
    lines.push("");
    lines.push("### Trace IDs");
    lines.push("");
    lines.push(traces);
  }

  const errors = formatList(replay.error_ids);
  if (errors) {
    lines.push("");
    lines.push("### Error IDs");
    lines.push("");
    lines.push(errors);
  }

  if (
    replay.tags &&
    !Array.isArray(replay.tags) &&
    Object.keys(replay.tags).length
  ) {
    lines.push("");
    lines.push("### Tags");
    lines.push("");
    for (const [key, values] of Object.entries(replay.tags).sort()) {
      lines.push(
        `- \`${escapeMarkdownInline(key)}\`: ${values.map((value) => `\`${escapeMarkdownInline(value)}\``).join(", ")}`
      );
    }
  }

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
