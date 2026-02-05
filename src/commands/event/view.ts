/**
 * sentry event view
 *
 * View detailed information about a Sentry event.
 */

import { buildCommand } from "@stricli/core";
import type { SentryContext } from "../../context.js";
import { findProjectsBySlug, getEvent } from "../../lib/api-client.js";
import {
  ProjectSpecificationType,
  parseOrgProjectArg,
  spansFlag,
} from "../../lib/arg-parsing.js";
import { openInBrowser } from "../../lib/browser.js";
import { ContextError } from "../../lib/errors.js";
import { formatEventDetails, writeJson } from "../../lib/formatters/index.js";
import { resolveOrgAndProject } from "../../lib/resolve-target.js";
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
 * Handles: `<event-id>` or `<target> <event-id>`
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

  if (args.length === 1) {
    // Single arg - must be event ID
    return { eventId: first, targetArg: undefined };
  }

  const second = args[1];
  if (second === undefined) {
    // Should not happen given length check, but TypeScript needs this
    return { eventId: first, targetArg: undefined };
  }

  // Two or more args - first is target, second is event ID
  return { eventId: second, targetArg: first };
}

/** Resolved target type for internal use */
type ResolvedEventTarget = {
  org: string;
  project: string;
  orgDisplay: string;
  projectDisplay: string;
  detectedFrom?: string;
};

/**
 * Resolve target from a project search result.
 */
async function resolveFromProjectSearch(
  projectSlug: string,
  eventId: string
): Promise<ResolvedEventTarget> {
  const found = await findProjectsBySlug(projectSlug);
  if (found.length === 0) {
    throw new ContextError(`Project "${projectSlug}"`, USAGE_HINT, [
      "Check that you have access to a project with this slug",
    ]);
  }
  if (found.length > 1) {
    const alternatives = found.map(
      (p) => `${p.organization?.slug ?? "unknown"}/${p.slug}`
    );
    throw new ContextError(
      `Project "${projectSlug}" exists in multiple organizations`,
      `sentry event view <org>/${projectSlug} ${eventId}`,
      alternatives
    );
  }
  const foundProject = found[0];
  if (!foundProject) {
    throw new ContextError(`Project "${projectSlug}" not found`, USAGE_HINT);
  }
  const orgSlug = foundProject.organization?.slug;
  if (!orgSlug) {
    throw new ContextError(
      `Could not determine organization for project "${projectSlug}"`,
      USAGE_HINT
    );
  }
  return {
    org: orgSlug,
    project: foundProject.slug,
    orgDisplay: orgSlug,
    projectDisplay: foundProject.slug,
  };
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

    let target: ResolvedEventTarget | null = null;

    switch (parsed.type) {
      case ProjectSpecificationType.Explicit:
        target = {
          org: parsed.org,
          project: parsed.project,
          orgDisplay: parsed.org,
          projectDisplay: parsed.project,
        };
        break;

      case ProjectSpecificationType.ProjectSearch:
        target = await resolveFromProjectSearch(parsed.projectSlug, eventId);
        break;

      case ProjectSpecificationType.OrgAll:
        throw new ContextError(
          "A specific project is required for event view",
          USAGE_HINT
        );

      case ProjectSpecificationType.AutoDetect:
        target = await resolveOrgAndProject({ cwd, usageHint: USAGE_HINT });
        break;

      default:
        // Exhaustive check - should never reach here
        throw new ContextError("Invalid target specification", USAGE_HINT);
    }

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

    const event = await getEvent(target.org, target.project, eventId);

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
