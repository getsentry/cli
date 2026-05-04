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
import { openInBrowser } from "../../lib/browser.js";
import { buildCommand } from "../../lib/command.js";
import { ApiError, ResolutionError } from "../../lib/errors.js";
import { filterFields } from "../../lib/formatters/json.js";
import { CommandOutput } from "../../lib/formatters/output.js";
import {
  extractReplayActivityEvents,
  formatReplayDetails,
  type ReplayViewData,
  replayHint,
} from "../../lib/formatters/replay.js";
import { validateHexId } from "../../lib/hex-id.js";
import {
  applyFreshFlag,
  FRESH_ALIASES,
  FRESH_FLAG,
} from "../../lib/list-command.js";
import { logger } from "../../lib/logger.js";
import { resolveOrgOptionalProjectFromArg } from "../../lib/resolve-target.js";
import { buildReplayUrl } from "../../lib/sentry-urls.js";
import type {
  ReplayActivityEvent,
  ReplayDetails,
  ReplayRelatedIssue,
  ReplayRelatedTrace,
} from "../../types/index.js";
import { ReplayViewOutputSchema } from "../../types/index.js";
import { parseReplayTargetArgs } from "./target.js";

type ViewFlags = {
  readonly json: boolean;
  readonly web: boolean;
  readonly fresh: boolean;
  readonly fields?: string[];
};

const USAGE_HINT =
  "sentry replay view [<org>/<project>/]<replay-id> | <replay-url>";
const MAX_ACTIVITY_EVENTS = 6;
const MAX_RELATED_ERRORS = 3;
const MAX_RELATED_TRACES = 2;

const log = logger.withTag("replay.view");

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
export const parsePositionalArgs = (args: string[]) =>
  parseReplayTargetArgs(args, USAGE_HINT);

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
      replay.id,
      { expectedSegments: replay.count_segments }
    );
    return extractReplayActivityEvents(segments, MAX_ACTIVITY_EVENTS);
  } catch (error) {
    log.debug("Failed to fetch replay recording segments", error);
    return [];
  }
}

/**
 * Fetch related issue metadata for replay-linked error event IDs.
 *
 * Uses org-wide issue search (`project = ""`) because replays may span
 * multiple projects within the same organization.
 */
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
      } catch (error) {
        log.debug(`Failed to resolve issue for event ${eventId}`, error);
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
      } catch (error) {
        log.debug(`Failed to fetch trace meta for ${traceId}`, error);
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
      log.warn(parsedArgs.warning);
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
