/**
 * sentry event view
 *
 * View detailed information about a Sentry event.
 */

import type { SentryContext } from "../../context.js";
import {
  findEventAcrossOrgs,
  getEvent,
  getIssueByShortId,
  getLatestEvent,
  type ResolvedEvent,
  resolveEventInOrg,
} from "../../lib/api-client.js";
import {
  detectSwappedViewArgs,
  looksLikeIssueShortId,
  ProjectSpecificationType,
  parseOrgProjectArg,
  parseSlashSeparatedArg,
  spansFlag,
} from "../../lib/arg-parsing.js";
import { openInBrowser } from "../../lib/browser.js";
import { buildCommand } from "../../lib/command.js";
import { ApiError, ContextError, ResolutionError } from "../../lib/errors.js";
import { formatEventDetails } from "../../lib/formatters/index.js";
import { filterFields } from "../../lib/formatters/json.js";
import { CommandOutput } from "../../lib/formatters/output.js";
import {
  applyFreshFlag,
  FRESH_ALIASES,
  FRESH_FLAG,
} from "../../lib/list-command.js";
import { logger } from "../../lib/logger.js";
import { resolveEffectiveOrg } from "../../lib/region.js";
import {
  resolveOrg,
  resolveOrgAndProject,
  resolveProjectBySlug,
} from "../../lib/resolve-target.js";
import {
  applySentryUrlContext,
  parseSentryUrl,
} from "../../lib/sentry-url-parser.js";
import { buildEventSearchUrl } from "../../lib/sentry-urls.js";
import { getSpanTreeLines } from "../../lib/span-tree.js";
import type { SentryEvent } from "../../types/index.js";

type ViewFlags = {
  readonly json: boolean;
  readonly web: boolean;
  readonly spans: number;
  readonly fresh: boolean;
  readonly fields?: string[];
};

/** Return type for event view — includes all data both renderers need */
type EventViewData = {
  event: SentryEvent;
  trace: { traceId: string; spans: unknown[] } | null;
  /** Pre-formatted span tree lines for human output (not serialized) */
  spanTreeLines?: string[];
};

/**
 * Format event view data for human-readable terminal output.
 *
 * Renders event details and optional span tree.
 */
function formatEventView(data: EventViewData): string {
  const parts: string[] = [];

  parts.push(formatEventDetails(data.event, `Event ${data.event.eventID}`));

  if (data.spanTreeLines && data.spanTreeLines.length > 0) {
    parts.push(data.spanTreeLines.join("\n"));
  }

  return parts.join("\n");
}

/**
 * Transform event view data for JSON output.
 *
 * Flattens the event as the primary object so that `--fields eventID,title`
 * works directly on event properties. The `trace` enrichment data is
 * attached as a nested key, accessible via `--fields trace.traceId`.
 *
 * Without this transform, `--fields eventID` would return `{}` because
 * the raw yield shape is `{ event, trace }` and `eventID` lives inside `event`.
 */
function jsonTransformEventView(
  data: EventViewData,
  fields?: string[]
): unknown {
  const { event, trace } = data;
  const result: Record<string, unknown> = { ...event, trace };
  if (fields && fields.length > 0) {
    return filterFields(result, fields);
  }
  return result;
}
/** Usage hint for ContextError messages */
const USAGE_HINT = "sentry event view <org>/<project> <event-id>";

/**
 * Parse a single positional arg for event view, handling issue short ID
 * detection both in bare form ("BRUNCHIE-APP-29") and org-prefixed form
 * ("figma/FULLSCREEN-2RN").
 *
 * Must run before `parseSlashSeparatedArg` because that function throws
 * ContextError for single-slash args like "org/SHORT-ID", which looks like
 * "org/project" with a missing event ID.
 */
function parseSingleArg(arg: string): ParsedPositionalArgs {
  // Detect "org/SHORT-ID" pattern before parseSlashSeparatedArg.
  // e.g., "figma/FULLSCREEN-2RN" → auto-redirect to that issue's latest event.
  const slashIdx = arg.indexOf("/");
  if (slashIdx !== -1 && arg.indexOf("/", slashIdx + 1) === -1) {
    const afterSlash = arg.slice(slashIdx + 1);
    if (afterSlash && looksLikeIssueShortId(afterSlash)) {
      // Use "org/" (trailing slash) to signal OrgAll mode so downstream
      // parseOrgProjectArg interprets this as an org, not a project search.
      return {
        eventId: "latest",
        targetArg: `${arg.slice(0, slashIdx)}/`,
        issueShortId: afterSlash,
      };
    }
  }

  const { id: eventId, targetArg } = parseSlashSeparatedArg(
    arg,
    "Event ID",
    USAGE_HINT
  );

  // Detect bare issue short ID passed as event ID (e.g., "BRUNCHIE-APP-29").
  if (!targetArg && looksLikeIssueShortId(eventId)) {
    return {
      eventId: "latest",
      targetArg: undefined,
      issueShortId: eventId,
    };
  }

  return { eventId, targetArg };
}

/** Return type for parsePositionalArgs */
type ParsedPositionalArgs = {
  eventId: string;
  targetArg: string | undefined;
  /** Issue ID from a Sentry issue URL — triggers latest-event fetch */
  issueId?: string;
  /** Issue short ID detected from positional args (e.g., "BRUNCHIE-APP-29") */
  issueShortId?: string;
  /** Warning message if arguments appear to be in the wrong order */
  warning?: string;
};

/**
 * Parse positional arguments for event view.
 *
 * Handles:
 * - `<event-id>` — event ID only (auto-detect org/project)
 * - `<target> <event-id>` — explicit target + event ID
 * - `<sentry-event-url>` — extract eventId and org from a Sentry event URL
 *   (e.g., `https://sentry.example.com/organizations/my-org/issues/123/events/abc/`)
 * - `<sentry-issue-url>` — extract issueId and org; caller fetches latest event
 *   (e.g., `https://sentry.example.com/organizations/my-org/issues/123/`)
 *
 * For event URLs, the org is returned as `targetArg` in `"{org}/"` format
 * (OrgAll). Since event URLs don't contain a project slug, the caller
 * must fall back to auto-detection for the project.
 *
 * For issue URLs (no eventId segment), the `issueId` field is set so the
 * caller can fetch the latest event via `getLatestEvent(org, issueId)`.
 *
 * @returns Parsed event ID and optional target arg
 */
export function parsePositionalArgs(args: string[]): ParsedPositionalArgs {
  if (args.length === 0) {
    throw new ContextError("Event ID", USAGE_HINT, []);
  }

  const first = args[0];
  if (first === undefined) {
    throw new ContextError("Event ID", USAGE_HINT, []);
  }

  // URL detection — extract eventId and org from Sentry event URLs
  const urlParsed = parseSentryUrl(first);
  if (urlParsed) {
    applySentryUrlContext(urlParsed.baseUrl);
    if (urlParsed.eventId) {
      // Event URL: pass org as OrgAll target ("{org}/").
      // Event URLs don't contain a project slug, so viewCommand falls
      // back to auto-detect for the project while keeping the org context.
      return { eventId: urlParsed.eventId, targetArg: `${urlParsed.org}/` };
    }
    if (urlParsed.issueId) {
      // Issue URL without event ID — fetch the latest event for this issue.
      // Use a placeholder eventId; the caller uses issueId to fetch via getLatestEvent.
      return {
        eventId: "latest",
        targetArg: `${urlParsed.org}/`,
        issueId: urlParsed.issueId,
      };
    }
    // URL recognized but no eventId or issueId — not useful for event view
    throw new ContextError("Event ID", USAGE_HINT, [
      "Pass an event URL: https://sentry.io/organizations/{org}/issues/{id}/events/{eventId}/",
      "Or an issue URL to view the latest event: https://sentry.io/organizations/{org}/issues/{id}/",
    ]);
  }

  if (args.length === 1) {
    return parseSingleArg(first);
  }

  const second = args[1];
  if (second === undefined) {
    // Should not happen given length check, but TypeScript needs this
    return { eventId: first, targetArg: undefined };
  }

  // Detect swapped args: user put ID first and target second
  const swapWarning = detectSwappedViewArgs(first, second);
  if (swapWarning) {
    return { eventId: first, targetArg: second, warning: swapWarning };
  }

  // Detect issue short ID passed as first arg (e.g., "CAM-82X 95fd7f5a").
  // Auto-redirect to the issue's latest event instead of treating the short
  // ID as a project slug (which would fail — slugs are lowercase, short IDs
  // are uppercase). The second arg is ignored since we fetch the latest event.
  if (looksLikeIssueShortId(first)) {
    return {
      eventId: "latest",
      targetArg: undefined,
      issueShortId: first,
      warning: `'${first}' is an issue short ID, not a project slug. Ignoring second argument '${second}'.`,
    };
  }

  // Two or more args - first is target, second is event ID
  return { eventId: second, targetArg: first };
}

/**
 * Resolved target type for event commands.
 * @internal Exported for testing
 */
export type ResolvedEventTarget = {
  org: string;
  project: string;
  orgDisplay: string;
  projectDisplay: string;
  detectedFrom?: string;
  /** Pre-fetched event from cross-project resolution — avoids a second API call */
  prefetchedEvent?: ResolvedEvent["event"];
};

/** Options for resolving the event target */
type ResolveTargetOptions = {
  parsed: ReturnType<typeof parseOrgProjectArg>;
  eventId: string;
  cwd: string;
};

/**
 * Resolve org/project context for the event view command.
 *
 * Handles all target types (explicit, search, org-all, auto-detect)
 * including cross-project fallback via the eventids endpoint.
 */
/** @internal Exported for testing */
export async function resolveEventTarget(
  options: ResolveTargetOptions
): Promise<ResolvedEventTarget | null> {
  const { parsed, eventId, cwd } = options;

  switch (parsed.type) {
    case ProjectSpecificationType.Explicit: {
      const org = await resolveEffectiveOrg(parsed.org);
      return {
        org,
        project: parsed.project,
        orgDisplay: parsed.org,
        projectDisplay: parsed.project,
      };
    }

    case ProjectSpecificationType.ProjectSearch: {
      const resolved = await resolveProjectBySlug(
        parsed.projectSlug,
        USAGE_HINT,
        `sentry event view <org>/${parsed.projectSlug} ${eventId}`
      );
      return {
        org: resolved.org,
        project: resolved.project,
        orgDisplay: resolved.org,
        projectDisplay: resolved.project,
      };
    }

    case ProjectSpecificationType.OrgAll: {
      const org = await resolveEffectiveOrg(parsed.org);
      return resolveOrgAllTarget(org, eventId, cwd);
    }

    case ProjectSpecificationType.AutoDetect:
      return resolveAutoDetectTarget(eventId, cwd);

    default:
      return null;
  }
}

/**
 * Resolve target when only an org is known (e.g., from a Sentry event URL).
 * Uses the eventids endpoint to find the project directly.
 *
 * Throws a ContextError if the event is not found in the given org, with a
 * message that names the org so the error is not misleading.
 * Propagates auth/network errors from resolveEventInOrg.
 */
/** @internal Exported for testing */
export async function resolveOrgAllTarget(
  org: string,
  eventId: string,
  _cwd: string
): Promise<ResolvedEventTarget> {
  const resolved = await resolveEventInOrg(org, eventId);
  if (!resolved) {
    throw new ResolutionError(
      `Event ${eventId} in organization "${org}"`,
      "not found",
      `sentry event view ${org}/<project> ${eventId}`
    );
  }
  return {
    org: resolved.org,
    project: resolved.project,
    orgDisplay: org,
    projectDisplay: resolved.project,
    prefetchedEvent: resolved.event,
  };
}

/**
 * Resolve target via auto-detect cascade, falling back to cross-project
 * event search across all accessible orgs.
 */
/** @internal Exported for testing */
export async function resolveAutoDetectTarget(
  eventId: string,
  cwd: string
): Promise<ResolvedEventTarget | null> {
  const autoTarget = await resolveOrgAndProject({ cwd, usageHint: USAGE_HINT });
  if (autoTarget) {
    return autoTarget;
  }

  const resolved = await findEventAcrossOrgs(eventId);
  if (resolved) {
    logger
      .withTag("event.view")
      .warn(
        `Found event in ${resolved.org}/${resolved.project}. ` +
          `Use: sentry event view ${resolved.org}/${resolved.project} ${eventId}`
      );
    return {
      org: resolved.org,
      project: resolved.project,
      orgDisplay: resolved.org,
      projectDisplay: resolved.project,
      prefetchedEvent: resolved.event,
    };
  }
  return null;
}

/**
 * Fetch the latest event for an issue URL and build the output data.
 * Extracted from func() to reduce cyclomatic complexity.
 */
async function fetchLatestEventData(
  org: string,
  issueId: string,
  spans: number
): Promise<EventViewData> {
  const event = await getLatestEvent(org, issueId);
  const spanTreeResult =
    spans > 0 ? await getSpanTreeLines(org, event, spans) : undefined;

  const trace =
    spanTreeResult?.success && spanTreeResult.traceId
      ? { traceId: spanTreeResult.traceId, spans: spanTreeResult.spans ?? [] }
      : null;

  return { event, trace, spanTreeLines: spanTreeResult?.lines };
}

/**
 * Fetch an event, enriching 404 errors with actionable suggestions.
 *
 * The generic "Failed to get event: 404 Not Found" is the most common
 * event view failure (CLI-6F, 54 users). This wrapper adds context about
 * data retention, ID format, and cross-project lookup.
 *
 * When the project-scoped fetch returns 404, automatically tries the
 * org-wide eventids resolution endpoint as a fallback. This handles the
 * common case where DSN auto-detection or config defaults resolve to
 * the wrong project within the correct org (CLI-KW, 9 users).
 *
 * @param prefetchedEvent - Already-resolved event (from cross-org lookup), or null
 * @param org - Organization slug
 * @param project - Project slug
 * @param eventId - Event ID being looked up
 * @returns The event data
 */
export async function fetchEventWithContext(
  prefetchedEvent: SentryEvent | null,
  org: string,
  project: string,
  eventId: string
): Promise<SentryEvent> {
  if (prefetchedEvent) {
    return prefetchedEvent;
  }
  try {
    return await getEvent(org, project, eventId);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      // Auto-fallback: try cross-project lookup within the same org.
      // Handles wrong-project resolution from DSN auto-detect or config defaults.
      const resolved = await resolveEventInOrg(org, eventId);
      if (resolved) {
        logger.warn(
          `Event not found in ${org}/${project}, but found in ${resolved.org}/${resolved.project}.`
        );
        return resolved.event;
      }

      const suggestions = [
        "The event may have been deleted due to data retention policies",
        "Verify the event ID is a 32-character hex string (e.g., a1b2c3d4...)",
        `Search across all projects in the org: sentry event view ${org}/ ${eventId}`,
      ];

      // Nudge the user when the event ID looks like an issue short ID
      if (looksLikeIssueShortId(eventId)) {
        suggestions.unshift(
          `This looks like an issue short ID. Try: sentry issue view ${eventId}`
        );
      }

      throw new ResolutionError(
        `Event '${eventId}'`,
        `not found in ${org}/${project}`,
        `sentry event view ${org}/<project> ${eventId}`,
        suggestions
      );
    }
    throw error;
  }
}

/**
 * Resolve an issue short ID and fetch its latest event.
 *
 * Used when the user passes an issue short ID (e.g., "BRUNCHIE-APP-29")
 * to `event view` instead of a hex event ID. We auto-detect this and
 * show the latest event for the issue, with a warning nudging them
 * toward `sentry issue view`.
 *
 * @param issueShortId - Issue short ID (e.g., "BRUNCHIE-APP-29")
 * @param org - Organization slug
 * @param spans - Span tree depth
 */
async function resolveIssueShortIdEvent(
  issueShortId: string,
  org: string,
  spans: number
): Promise<EventViewData> {
  const issue = await getIssueByShortId(org, issueShortId);
  return fetchLatestEventData(org, issue.id, spans);
}

/** Result from an issue-based shortcut (URL or short ID) */
type IssueShortcutResult = {
  org: string;
  data: EventViewData;
  hint: string;
};

/** Options for resolving issue-based shortcuts */
type IssueShortcutOptions = {
  parsed: ReturnType<typeof parseOrgProjectArg>;
  issueId: string | undefined;
  issueShortId: string | undefined;
  cwd: string;
  spans: number;
};

/**
 * Handle issue-based shortcuts: issue URLs and issue short IDs.
 *
 * Both paths resolve an issue and fetch its latest event. Extracted from
 * func() to reduce cyclomatic complexity.
 *
 * @returns Result with org, data, and hint — or null if not an issue shortcut
 */
async function resolveIssueShortcut(
  options: IssueShortcutOptions
): Promise<IssueShortcutResult | null> {
  const { parsed, issueId, issueShortId, cwd, spans } = options;
  const log = logger.withTag("event.view");

  // Issue URL shortcut: fetch the latest event directly via the issue ID.
  // This bypasses project resolution entirely since getLatestEvent only
  // needs org + issue ID.
  if (issueId) {
    const org = await resolveEffectiveOrg(
      parsed.type === "org-all" ? parsed.org : ""
    );
    log.info(`Fetching latest event for issue ${issueId}...`);
    const data = await fetchLatestEventData(org, issueId, spans);
    return { org, data, hint: `Showing latest event for issue ${issueId}` };
  }

  // Issue short ID auto-redirect: user passed an issue short ID
  // (e.g., "BRUNCHIE-APP-29" or "figma/FULLSCREEN-2RN") instead of a hex
  // event ID. Resolve the issue and show its latest event.
  if (issueShortId) {
    log.warn(
      `'${issueShortId}' is an issue short ID, not an event ID. Showing the latest event.`
    );

    // Use the explicit org from the parsed target if available (e.g.,
    // "figma/" → org-all with org "figma"), otherwise fall back to
    // auto-detection via DSN/env/config.
    const explicitOrg = parsed.type === "org-all" ? parsed.org : undefined;
    const resolved = await resolveOrg({ org: explicitOrg, cwd });
    if (!resolved) {
      throw new ContextError(
        "Organization",
        `sentry issue view ${issueShortId}`
      );
    }

    const data = await resolveIssueShortIdEvent(
      issueShortId,
      resolved.org,
      spans
    );
    return {
      org: resolved.org,
      data,
      hint: `Tip: Use 'sentry issue view ${issueShortId}' to view the full issue`,
    };
  }

  return null;
}

export const viewCommand = buildCommand({
  docs: {
    brief: "View details of a specific event",
    fullDescription:
      "View detailed information about a Sentry event by its ID.\n\n" +
      "Target specification:\n" +
      "  sentry event view <event-id>              # auto-detect from DSN or config\n" +
      "  sentry event view <org>/<proj> <event-id> # explicit org and project\n" +
      "  sentry event view <project> <event-id>    # find project across all orgs",
  },
  output: {
    human: formatEventView,
    jsonTransform: jsonTransformEventView,
  },
  parameters: {
    positional: {
      kind: "array",
      parameter: {
        placeholder: "args",
        brief:
          "[<org>/<project>] <event-id> - Target (optional) and event ID (required)",
        parse: String,
      },
    },
    flags: {
      web: {
        kind: "boolean",
        brief: "Open in browser",
        default: false,
      },
      ...spansFlag,
      fresh: FRESH_FLAG,
    },
    aliases: { ...FRESH_ALIASES, w: "web" },
  },
  async *func(this: SentryContext, flags: ViewFlags, ...args: string[]) {
    applyFreshFlag(flags);
    const { cwd } = this;

    const log = logger.withTag("event.view");

    // Parse positional args
    const { eventId, targetArg, warning, issueId, issueShortId } =
      parsePositionalArgs(args);
    if (warning) {
      log.warn(warning);
    }
    const parsed = parseOrgProjectArg(targetArg);

    // Handle issue-based shortcuts (issue URLs and short IDs) before
    // normal event resolution. Both paths fetch the latest event.
    const issueShortcut = await resolveIssueShortcut({
      parsed,
      issueId,
      issueShortId,
      cwd,
      spans: flags.spans,
    });
    if (issueShortcut) {
      if (flags.web) {
        await openInBrowser(
          buildEventSearchUrl(
            issueShortcut.org,
            issueShortcut.data.event.eventID
          ),
          "event"
        );
        return;
      }
      yield new CommandOutput(issueShortcut.data);
      return { hint: issueShortcut.hint };
    }

    const target = await resolveEventTarget({
      parsed,
      eventId,
      cwd,
    });

    if (!target) {
      throw new ContextError("Organization and project", USAGE_HINT);
    }

    if (flags.web) {
      await openInBrowser(buildEventSearchUrl(target.org, eventId), "event");
      return;
    }

    // Use the pre-fetched event when cross-project resolution already fetched it,
    // avoiding a redundant API call.
    const event = await fetchEventWithContext(
      target.prefetchedEvent ?? null,
      target.org,
      target.project,
      eventId
    );

    // Fetch span tree data (for both JSON and human output)
    // Skip when spans=0 (disabled via --spans no or --spans 0)
    const spanTreeResult =
      flags.spans > 0
        ? await getSpanTreeLines(target.org, event, flags.spans)
        : undefined;

    const trace = spanTreeResult?.success
      ? { traceId: spanTreeResult.traceId, spans: spanTreeResult.spans }
      : null;

    yield new CommandOutput({
      event,
      trace,
      spanTreeLines: spanTreeResult?.lines,
    });
    return {
      hint: target.detectedFrom
        ? `Detected from ${target.detectedFrom}`
        : undefined,
    };
  },
});
