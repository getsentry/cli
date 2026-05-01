/**
 * sentry replay view
 *
 * View detailed information about a Session Replay.
 */

import type { SentryContext } from "../../context.js";
import {
  getProject,
  getReplay,
  getReplayRecordingSegments,
  getTraceMeta,
  listIssuesPaginated,
} from "../../lib/api-client.js";
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
  ValidationError,
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
import { formatReplayDurationVerbose } from "../../lib/replay-duration.js";
import { normalizeReplayId } from "../../lib/replay-id.js";
import { getReplayUserLabel } from "../../lib/replay-search.js";
import { resolveOrgOptionalProjectFromArg } from "../../lib/resolve-target.js";
import {
  applySentryUrlContext,
  parseSentryUrl,
} from "../../lib/sentry-url-parser.js";
import { buildReplayUrl } from "../../lib/sentry-urls.js";
import type {
  ReplayActivityEvent,
  ReplayDetails,
  ReplayRecordingSegments,
  ReplayRelatedIssue,
  ReplayRelatedTrace,
} from "../../types/index.js";
import { ReplayViewOutputSchema } from "../../types/index.js";

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

type ReplayViewData = {
  org: string;
  replay: ReplayDetails;
  activity: ReplayActivityEvent[];
  relatedIssues: ReplayRelatedIssue[];
  relatedTraces: ReplayRelatedTrace[];
};

type MarkdownRow = [string, string];

const USAGE_HINT =
  "sentry replay view [<org>/<project>/]<replay-id> | <replay-url>";
const MAX_ACTIVITY_EVENTS = 6;
const MAX_RELATED_ERRORS = 3;
const MAX_RELATED_TRACES = 2;

function parseSingleArg(arg: string): ParsedPositionalArgs {
  const trimmed = arg.trim();
  if (!trimmed) {
    throw new ContextError("Replay ID", USAGE_HINT, []);
  }

  const slashIdx = trimmed.indexOf("/");
  if (slashIdx !== -1 && trimmed.indexOf("/", slashIdx + 1) === -1) {
    const org = trimmed.slice(0, slashIdx);
    const replaySegment = trimmed.slice(slashIdx + 1);
    const normalizedReplayId =
      replaySegment && normalizeReplayId(replaySegment);
    if (!normalizedReplayId) {
      throw new ContextError("Replay ID", USAGE_HINT, []);
    }
    return { replayId: normalizedReplayId, targetArg: `${org}/` };
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
 * - `<replay-url>`
 */
export function parsePositionalArgs(args: string[]): ParsedPositionalArgs {
  if (args.length === 0) {
    throw new ContextError("Replay ID", USAGE_HINT, []);
  }
  if (args.length > 2) {
    throw new ValidationError(
      `Too many positional arguments (got ${args.length}, expected at most 2).\n\nUsage: ${USAGE_HINT}`,
      "positional"
    );
  }

  const first = args[0];
  if (!first) {
    throw new ContextError("Replay ID", USAGE_HINT, []);
  }

  const urlParsed = parseSentryUrl(first);
  if (urlParsed) {
    applySentryUrlContext(urlParsed.baseUrl);
    if (urlParsed.replayId && urlParsed.org) {
      return { replayId: urlParsed.replayId, targetArg: `${urlParsed.org}/` };
    }
    throw new ContextError("Replay ID", USAGE_HINT, [
      "Pass a replay URL: https://sentry.io/organizations/{org}/explore/replays/{replayId}/",
    ]);
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
    const normalizedReplayId = normalizeReplayId(first) ?? first;
    return {
      replayId: normalizedReplayId,
      targetArg: second,
      warning,
    };
  }

  return { replayId: second, targetArg: first };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function formatRelativeOffset(milliseconds: number): string {
  const seconds = Math.max(0, Math.round(milliseconds / 1000));
  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) {
    return remainingSeconds > 0
      ? `${minutes}m ${remainingSeconds}s`
      : `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

function getEventTimestampMillis(value: unknown): number | null {
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

function firstString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function compactDetails(values: Array<string | null>): string[] {
  return values.filter((value): value is string => value !== null);
}

function summarizePerformanceSpan(
  payload: Record<string, unknown> | null
): Omit<ReplayActivityEvent, "timestampMs"> | null {
  const op = firstString(payload?.op);
  const description = firstString(payload?.description);
  const durationMs =
    isRecord(payload?.data) && typeof payload.data.duration === "number"
      ? payload.data.duration
      : null;

  if (!(description || op)) {
    return null;
  }

  return {
    label: op ?? "performanceSpan",
    details: compactDetails([
      description ? `description=${description}` : null,
      durationMs !== null ? `duration_ms=${durationMs}` : null,
    ]),
  };
}

function summarizeClickLikeEvent(
  label: string,
  payload: Record<string, unknown> | null,
  includeLabel = false
): Omit<ReplayActivityEvent, "timestampMs"> {
  const selector = firstString(payload?.selector);
  const clickLabel = firstString(payload?.label);

  return {
    label,
    details: compactDetails([
      selector ? `selector=${selector}` : null,
      includeLabel && clickLabel ? `label=${clickLabel}` : null,
    ]),
  };
}

function summarizeBreadcrumb(
  payload: Record<string, unknown> | null
): Omit<ReplayActivityEvent, "timestampMs"> | null {
  const category = firstString(payload?.category);
  const message = firstString(payload?.message);
  if (!(category || message)) {
    return null;
  }

  return {
    label: category ?? "breadcrumb",
    details: compactDetails([message ? `message=${message}` : null]),
  };
}

const TAGGED_REPLAY_EVENT_SUMMARIZERS: Record<
  string,
  (
    payload: Record<string, unknown> | null
  ) => Omit<ReplayActivityEvent, "timestampMs"> | null
> = {
  breadcrumb: summarizeBreadcrumb,
  click: (payload: Record<string, unknown> | null) =>
    summarizeClickLikeEvent("click", payload, true),
  deadClick: (payload: Record<string, unknown> | null) =>
    summarizeClickLikeEvent("dead.click", payload),
  performanceSpan: summarizePerformanceSpan,
  rageClick: (payload: Record<string, unknown> | null) =>
    summarizeClickLikeEvent("rage.click", payload),
};

function summarizeTaggedReplayEvent(
  tag: string,
  payload: Record<string, unknown> | null
): Omit<ReplayActivityEvent, "timestampMs"> | null {
  const summarize = TAGGED_REPLAY_EVENT_SUMMARIZERS[tag];
  return summarize ? summarize(payload) : null;
}

function summarizeReplayEvent(event: unknown): ReplayActivityEvent | null {
  if (!isRecord(event)) {
    return null;
  }

  const timestampMs = getEventTimestampMillis(event.timestamp);
  const data = isRecord(event.data) ? event.data : null;
  const tag = typeof data?.tag === "string" ? data.tag : "";
  const payload = isRecord(data?.payload) ? data.payload : null;

  if (tag) {
    const replayEvent = summarizeTaggedReplayEvent(tag, payload);
    if (replayEvent) {
      return { timestampMs, ...replayEvent };
    }
  }

  const href = firstString(data?.href);
  if (href) {
    return {
      timestampMs,
      label: "page.view",
      details: [`href=${href}`],
    };
  }

  return null;
}

function extractReplayActivityEvents(
  segments: ReplayRecordingSegments | null
): ReplayActivityEvent[] {
  if (!segments) {
    return [];
  }

  const events: ReplayActivityEvent[] = [];
  for (const segment of segments) {
    for (const event of segment) {
      const replayEvent = summarizeReplayEvent(event);
      if (replayEvent) {
        events.push(replayEvent);
      }
      if (events.length >= MAX_ACTIVITY_EVENTS) {
        return events;
      }
    }
  }

  return events;
}

type ReplayProjectScope = {
  org: string;
  project?: string;
  expectedProjectId?: string;
  replayId: string;
  replay: ReplayDetails;
};

async function validateReplayProjectScope(
  scope: ReplayProjectScope
): Promise<void> {
  const { expectedProjectId, org, project, replay, replayId } = scope;
  if (!project) {
    return;
  }

  if (replay.project_id === null || replay.project_id === undefined) {
    if (replay.is_archived) {
      return;
    }

    throw new ResolutionError(
      `Replay '${replayId}'`,
      "has no project association",
      `sentry replay view ${org}/${project}/${replayId}`,
      [
        `Open the org-scoped replay instead: sentry replay view ${org}/${replayId}`,
      ]
    );
  }

  const projectId = expectedProjectId ?? (await getProject(org, project)).id;
  if (String(projectId) !== String(replay.project_id)) {
    throw new ResolutionError(
      `Replay '${replayId}'`,
      `is not in project '${project}'`,
      `sentry replay view ${org}/${project}/${replayId}`,
      [
        `Open the org-scoped replay instead: sentry replay view ${org}/${replayId}`,
      ]
    );
  }
}

async function fetchReplayActivity(
  org: string,
  replay: ReplayDetails
): Promise<ReplayActivityEvent[]> {
  if (
    replay.is_archived ||
    !replay.project_id ||
    (replay.count_segments ?? 0) <= 0
  ) {
    return [];
  }

  try {
    const segments = await getReplayRecordingSegments(
      org,
      String(replay.project_id),
      replay.id
    );
    return extractReplayActivityEvents(segments);
  } catch {
    return [];
  }
}

function fetchRelatedReplayIssues(
  org: string,
  replay: ReplayDetails
): Promise<ReplayRelatedIssue[]> {
  const eventIds = replay.error_ids.slice(0, MAX_RELATED_ERRORS);

  return Promise.all(
    eventIds.map(async (eventId) => {
      try {
        const page = await listIssuesPaginated(org, "", {
          query: `event.id:${eventId}`,
          perPage: 1,
        });
        const issue = page.data[0];
        return {
          eventId,
          issueId: issue?.id ?? null,
          shortId: issue?.shortId ?? null,
          title: issue?.title ?? null,
        };
      } catch {
        return { eventId, issueId: null, shortId: null, title: null };
      }
    })
  );
}

function fetchRelatedReplayTraces(
  org: string,
  replay: ReplayDetails
): Promise<ReplayRelatedTrace[]> {
  const traceIds = replay.trace_ids.slice(0, MAX_RELATED_TRACES);

  return Promise.all(
    traceIds.map(async (traceId) => {
      try {
        const meta = await getTraceMeta(org, traceId);
        return {
          traceId,
          errorCount: meta.errors,
          logCount: meta.logs,
          performanceIssueCount: meta.performance_issues,
          spanCount: meta.span_count,
        };
      } catch {
        return {
          traceId,
          errorCount: null,
          logCount: null,
          performanceIssueCount: null,
          spanCount: null,
        };
      }
    })
  );
}

async function enrichReplayView(
  org: string,
  replay: ReplayDetails
): Promise<
  Pick<ReplayViewData, "activity" | "relatedIssues" | "relatedTraces">
> {
  const [activity, relatedIssues, relatedTraces] = await Promise.all([
    fetchReplayActivity(org, replay),
    fetchRelatedReplayIssues(org, replay),
    fetchRelatedReplayTraces(org, replay),
  ]);

  return { activity, relatedIssues, relatedTraces };
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

function buildReplayOverviewRows(
  org: string,
  replay: ReplayDetails
): MarkdownRow[] {
  const rows: MarkdownRow[] = [["Replay ID", `\`${replay.id}\``]];
  pushMarkdownRow(rows, "Link", buildReplayUrl(org, replay.id));

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
      ? formatReplayDurationVerbose(replay.duration)
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
  pushMarkdownRow(
    rows,
    "Project ID",
    replay.project_id !== null && replay.project_id !== undefined
      ? String(replay.project_id)
      : undefined
  );
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
  const userLabel = getReplayUserLabel(replay);
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
  if (Object.keys(replay.tags).length === 0) {
    return;
  }

  lines.push("");
  lines.push("### Tags");
  lines.push("");
  for (const [key, values] of Object.entries(replay.tags).sort(([a], [b]) =>
    a.localeCompare(b)
  )) {
    lines.push(
      `- \`${escapeMarkdownInline(key)}\`: ${values.map((value) => `\`${escapeMarkdownInline(value)}\``).join(", ")}`
    );
  }
}

function pushActivitySection(
  lines: string[],
  replay: ReplayDetails,
  activity: ReplayActivityEvent[]
): void {
  lines.push("");
  lines.push("### Activity");
  lines.push("");

  if (replay.is_archived) {
    lines.push("Recording is archived and not available for playback.");
    return;
  }

  if (activity.length === 0) {
    lines.push("No activity events recorded.");
    return;
  }

  const startTime =
    getEventTimestampMillis(replay.started_at) ??
    activity[0]?.timestampMs ??
    null;
  for (const event of activity) {
    const prefix =
      event.timestampMs !== null && startTime !== null
        ? `${formatRelativeOffset(event.timestampMs - startTime)} · `
        : "";
    const details =
      event.details.length > 0
        ? ` · ${event.details.map((detail) => escapeMarkdownInline(detail)).join(" · ")}`
        : "";
    lines.push(`- ${prefix}\`${escapeMarkdownInline(event.label)}\`${details}`);
  }
}

function formatRelatedIssueLine(
  org: string,
  issue: ReplayRelatedIssue
): string {
  if (!(issue.shortId && issue.title)) {
    return `- Event \`${issue.eventId}\``;
  }

  return `- \`${issue.shortId}\`: ${escapeMarkdownInline(issue.title)} (view: \`sentry issue view ${org}/${issue.shortId}\`)`;
}

function buildRelatedTraceStats(trace: ReplayRelatedTrace): string[] {
  return [
    trace.spanCount !== null && trace.spanCount !== undefined
      ? `${trace.spanCount} spans`
      : null,
    trace.errorCount !== null && trace.errorCount !== undefined
      ? `${trace.errorCount} errors`
      : null,
    trace.logCount !== null && trace.logCount !== undefined
      ? `${trace.logCount} logs`
      : null,
    trace.performanceIssueCount !== null &&
    trace.performanceIssueCount !== undefined
      ? `${trace.performanceIssueCount} perf issues`
      : null,
  ].filter((value): value is string => value !== null);
}

function formatRelatedTraceLine(
  org: string,
  trace: ReplayRelatedTrace
): string {
  const stats = buildRelatedTraceStats(trace);
  const suffix = stats.length > 0 ? ` (${stats.join(", ")})` : "";
  return `- Trace \`${trace.traceId}\`${suffix} (view: \`sentry trace view ${org}/${trace.traceId}\`)`;
}

function pushRelatedSection(
  lines: string[],
  org: string,
  relatedIssues: ReplayRelatedIssue[],
  relatedTraces: ReplayRelatedTrace[]
): void {
  if (relatedIssues.length === 0 && relatedTraces.length === 0) {
    return;
  }

  lines.push("");
  lines.push("### Related");
  lines.push("");

  for (const issue of relatedIssues) {
    lines.push(formatRelatedIssueLine(org, issue));
  }

  for (const trace of relatedTraces) {
    lines.push(formatRelatedTraceLine(org, trace));
  }
}

function formatReplayDetails(data: ReplayViewData): string {
  const { activity, org, relatedIssues, relatedTraces, replay } = data;
  const lines: string[] = [];

  lines.push(`## Replay \`${replay.id.slice(0, 8)}\``);
  lines.push("");
  lines.push(mdKvTable(buildReplayOverviewRows(org, replay)));

  pushKvSection(lines, buildReplayUserRows(replay), "User");
  pushKvSection(lines, buildReplayClientRows(replay), "Client");

  pushListSection(lines, "Releases", replay.releases);
  pushListSection(lines, "URLs", replay.urls);
  pushListSection(lines, "Trace IDs", replay.trace_ids);
  pushListSection(lines, "Error IDs", replay.error_ids);
  pushActivitySection(lines, replay, activity);
  pushRelatedSection(lines, org, relatedIssues, relatedTraces);
  pushTagsSection(lines, replay);

  return renderMarkdown(lines.join("\n"));
}

function replayHint(data: ReplayViewData): string | undefined {
  const traceId = data.replay.trace_ids?.[0];
  if (traceId) {
    return `Related trace: sentry trace view ${data.org}/${traceId}`;
  }

  const issue = data.relatedIssues[0];
  if (issue?.shortId) {
    return `Related issue: sentry issue view ${data.org}/${issue.shortId}`;
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
      "  <org>/<project>/<id>     - explicit org/project context\n" +
      "  <replay-url>             - parse org and replay ID from a Sentry URL\n\n" +
      "Examples:\n" +
      "  sentry replay view 346789a703f6454384f1de473b8b9fcc\n" +
      "  sentry replay view sentry/346789a703f6454384f1de473b8b9fcc\n" +
      "  sentry replay view sentry/cli/346789a703f6454384f1de473b8b9fcc\n" +
      "  sentry replay view https://sentry.io/organizations/sentry/explore/replays/346789a703f6454384f1de473b8b9fcc/\n" +
      "  sentry replay view --web sentry/346789a703f6454384f1de473b8b9fcc",
  },
  output: {
    human: formatReplayDetails,
    jsonTransform: (data: ReplayViewData, fields?: string[]) => {
      const result: Record<string, unknown> = {
        ...data.replay,
        org: data.org,
        activity: data.activity,
        relatedIssues: data.relatedIssues,
        relatedTraces: data.relatedTraces,
      };
      return fields && fields.length > 0
        ? filterFields(result, fields)
        : result;
    },
    schema: ReplayViewOutputSchema,
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

    await validateReplayProjectScope({
      org: resolved.org,
      project: resolved.project,
      expectedProjectId: resolved.projectData?.id,
      replayId,
      replay,
    });

    const enrichment = await enrichReplayView(resolved.org, replay);
    const data: ReplayViewData = {
      org: resolved.org,
      replay,
      ...enrichment,
    };

    yield new CommandOutput(data);
    return { hint: replayHint(data) };
  },
});
