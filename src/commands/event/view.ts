/**
 * sentry event view
 *
 * View detailed information about a Sentry event.
 */

import { buildCommand } from "@stricli/core";
import type { SentryContext } from "../../context.js";
import { getEvent, getTrace } from "../../lib/api-client.js";
import { openInBrowser } from "../../lib/browser.js";
import { ContextError } from "../../lib/errors.js";
import {
  formatEventDetails,
  formatSpanTree,
  muted,
  writeJson,
} from "../../lib/formatters/index.js";
import { resolveOrgAndProject } from "../../lib/resolve-target.js";
import { buildEventSearchUrl } from "../../lib/sentry-urls.js";
import type { SentryEvent, Writer } from "../../types/index.js";

type ViewFlags = {
  readonly org?: string;
  readonly project?: string;
  readonly json: boolean;
  readonly web: boolean;
  readonly spans?: number;
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

export const viewCommand = buildCommand({
  docs: {
    brief: "View details of a specific event",
    fullDescription:
      "View detailed information about a Sentry event by its ID.\n\n" +
      "The organization and project are resolved from:\n" +
      "  1. --org and --project flags\n" +
      "  2. Config defaults\n" +
      "  3. SENTRY_DSN environment variable or source code detection",
  },
  parameters: {
    positional: {
      kind: "tuple",
      parameters: [
        {
          brief:
            "Event ID (hexadecimal, e.g., 9999aaaaca8b46d797c23c6077c6ff01)",
          parse: String,
        },
      ],
    },
    flags: {
      org: {
        kind: "parsed",
        parse: String,
        brief: "Organization slug",
        optional: true,
      },
      project: {
        kind: "parsed",
        parse: String,
        brief: "Project slug",
        optional: true,
      },
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
      spans: {
        kind: "parsed",
        parse: (input: string) => Number(input === "" ? 1 : input),
        brief: "Show span tree from the event's trace",
        optional: true,
        inferEmpty: true,
      },
    },
    aliases: { w: "web" },
  },
  async func(
    this: SentryContext,
    flags: ViewFlags,
    eventId: string
  ): Promise<void> {
    const { stdout, cwd } = this;

    const target = await resolveOrgAndProject({
      org: flags.org,
      project: flags.project,
      cwd,
      usageHint: `sentry event view ${eventId} --org <org> --project <project>`,
    });

    if (!target) {
      throw new ContextError(
        "Organization and project",
        `sentry event view ${eventId} --org <org-slug> --project <project-slug>`
      );
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

    let spanTreeLines: string[] | undefined;
    if (flags.spans !== undefined && event.contexts?.trace?.trace_id) {
      try {
        const traceEvents = await getTrace(
          target.org,
          event.contexts.trace.trace_id
        );
        spanTreeLines = formatSpanTree(traceEvents);
      } catch {
        // Non-fatal: trace data may not be available for all events
        spanTreeLines = [muted("\nUnable to fetch span tree for this event.")];
      }
    } else if (flags.spans !== undefined && !event.contexts?.trace?.trace_id) {
      spanTreeLines = [muted("\nNo trace data available for this event.")];
    }

    if (flags.json) {
      writeJson(stdout, event);
      return;
    }

    writeHumanOutput(stdout, {
      event,
      detectedFrom: target.detectedFrom,
      spanTreeLines,
    });
  },
});
