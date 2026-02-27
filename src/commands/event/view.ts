/**
 * sentry event view
 *
 * View detailed information about a Sentry event.
 */

import type { SentryContext } from "../../context.js";
import {
  findEventAcrossOrgs,
  getEvent,
  type ResolvedEvent,
  resolveEventInOrg,
} from "../../lib/api-client.js";
import {
  ProjectSpecificationType,
  parseOrgProjectArg,
  parseSlashSeparatedArg,
  spansFlag,
} from "../../lib/arg-parsing.js";
import { openInBrowser } from "../../lib/browser.js";
import { buildCommand } from "../../lib/command.js";
import { ContextError, ResolutionError } from "../../lib/errors.js";
import { formatEventDetails, writeJson } from "../../lib/formatters/index.js";
import {
  resolveOrgAndProject,
  resolveProjectBySlug,
} from "../../lib/resolve-target.js";
import {
  applySentryUrlContext,
  parseSentryUrl,
} from "../../lib/sentry-url-parser.js";
import { buildEventSearchUrl } from "../../lib/sentry-urls.js";
import { getSpanTreeLines } from "../../lib/span-tree.js";
import type { SentryEvent, Writer } from "../../types/index.js";

type ViewFlags = {
  readonly json: boolean;
  readonly web: boolean;
  readonly spans: number;
};

type HumanOutputOptions = {
  event: SentryEvent;
  detectedFrom?: string;
  spanTreeLines?: string[];
};

/**
 * Write human-readable event output to stdout.
 *
 * @param stdout - Output stream
 * @param options - Output options including event, detectedFrom, and spanTreeLines
 */
function writeHumanOutput(stdout: Writer, options: HumanOutputOptions): void {
  const { event, detectedFrom, spanTreeLines } = options;

  const lines = formatEventDetails(event, `Event ${event.eventID}`);

  // Skip leading empty line for standalone display
  const output = lines.slice(1);
  stdout.write(`${output.join("\n")}\n`);

  if (spanTreeLines && spanTreeLines.length > 0) {
    stdout.write(`${spanTreeLines.join("\n")}\n`);
  }

  if (detectedFrom) {
    stdout.write(`\nDetected from ${detectedFrom}\n`);
  }
}

/** Usage hint for ContextError messages */
const USAGE_HINT = "sentry event view <org>/<project> <event-id>";

/**
 * Parse positional arguments for event view.
 *
 * Handles:
 * - `<event-id>` — event ID only (auto-detect org/project)
 * - `<target> <event-id>` — explicit target + event ID
 * - `<sentry-url>` — extract eventId and org from a Sentry event URL
 *   (e.g., `https://sentry.example.com/organizations/my-org/issues/123/events/abc/`)
 *
 * For event URLs, the org is returned as `targetArg` in `"{org}/"` format
 * (OrgAll). Since event URLs don't contain a project slug, the caller
 * must fall back to auto-detection for the project. The URL must contain
 * an eventId segment — issue-only URLs are not valid for event view.
 *
 * @returns Parsed event ID and optional target arg
 */
export function parsePositionalArgs(args: string[]): {
  eventId: string;
  targetArg: string | undefined;
} {
  if (args.length === 0) {
    throw new ContextError("Event ID", USAGE_HINT);
  }

  const first = args[0];
  if (first === undefined) {
    throw new ContextError("Event ID", USAGE_HINT);
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
    // URL recognized but no eventId — not valid for event view
    throw new ContextError(
      "Event ID in URL (use a URL like /issues/{id}/events/{eventId}/)",
      USAGE_HINT
    );
  }

  if (args.length === 1) {
    const { id: eventId, targetArg } = parseSlashSeparatedArg(
      first,
      "Event ID",
      USAGE_HINT
    );
    return { eventId, targetArg };
  }

  const second = args[1];
  if (second === undefined) {
    // Should not happen given length check, but TypeScript needs this
    return { eventId: first, targetArg: undefined };
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
  stderr: { write(s: string): void };
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
  const { parsed, eventId, cwd, stderr } = options;

  switch (parsed.type) {
    case ProjectSpecificationType.Explicit:
      return {
        org: parsed.org,
        project: parsed.project,
        orgDisplay: parsed.org,
        projectDisplay: parsed.project,
      };

    case ProjectSpecificationType.ProjectSearch: {
      const resolved = await resolveProjectBySlug(
        parsed.projectSlug,
        USAGE_HINT,
        `sentry event view <org>/${parsed.projectSlug} ${eventId}`,
        stderr
      );
      return {
        ...resolved,
        orgDisplay: resolved.org,
        projectDisplay: resolved.project,
      };
    }

    case ProjectSpecificationType.OrgAll:
      return resolveOrgAllTarget(parsed.org, eventId, cwd);

    case ProjectSpecificationType.AutoDetect:
      return resolveAutoDetectTarget(eventId, cwd, stderr);

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
  cwd: string,
  stderr: { write(s: string): void }
): Promise<ResolvedEventTarget | null> {
  const autoTarget = await resolveOrgAndProject({ cwd, usageHint: USAGE_HINT });
  if (autoTarget) {
    return autoTarget;
  }

  const resolved = await findEventAcrossOrgs(eventId);
  if (resolved) {
    stderr.write(
      `Tip: Found event in ${resolved.org}/${resolved.project}. ` +
        `Use: sentry event view ${resolved.org}/${resolved.project} ${eventId}\n`
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
      json: {
        kind: "boolean",
        brief: "Output as JSON",
        default: false,
      },
      web: {
        kind: "boolean",
        brief: "Open in browser",
        default: false,
      },
      ...spansFlag,
    },
    aliases: { w: "web" },
  },
  async func(
    this: SentryContext,
    flags: ViewFlags,
    ...args: string[]
  ): Promise<void> {
    const { stdout, cwd } = this;

    // Parse positional args
    const { eventId, targetArg } = parsePositionalArgs(args);
    const parsed = parseOrgProjectArg(targetArg);

    const target = await resolveEventTarget({
      parsed,
      eventId,
      cwd,
      stderr: this.stderr,
    });

    if (!target) {
      throw new ContextError("Organization and project", USAGE_HINT);
    }

    if (flags.web) {
      await openInBrowser(
        stdout,
        buildEventSearchUrl(target.org, eventId),
        "event"
      );
      return;
    }

    // Use the pre-fetched event when cross-project resolution already fetched it,
    // avoiding a redundant API call.
    const event =
      target.prefetchedEvent ??
      (await getEvent(target.org, target.project, eventId));

    // Fetch span tree data (for both JSON and human output)
    // Skip when spans=0 (disabled via --spans no or --spans 0)
    const spanTreeResult =
      flags.spans > 0
        ? await getSpanTreeLines(target.org, event, flags.spans)
        : undefined;

    if (flags.json) {
      const trace = spanTreeResult?.success
        ? { traceId: spanTreeResult.traceId, spans: spanTreeResult.spans }
        : null;
      writeJson(stdout, { event, trace });
      return;
    }

    writeHumanOutput(stdout, {
      event,
      detectedFrom: target.detectedFrom,
      spanTreeLines: spanTreeResult?.lines,
    });
  },
});
