/**
 * sentry trace list
 *
 * List recent traces from Sentry projects.
 */

import { buildCommand } from "@stricli/core";
import type { SentryContext } from "../../context.js";
import { findProjectsBySlug, listTransactions } from "../../lib/api-client.js";
import { parseOrgProjectArg } from "../../lib/arg-parsing.js";
import { ContextError } from "../../lib/errors.js";
import {
  formatTraceRow,
  formatTracesHeader,
  writeFooter,
  writeJson,
} from "../../lib/formatters/index.js";
import { resolveOrgAndProject } from "../../lib/resolve-target.js";

type ListFlags = {
  readonly limit: number;
  readonly query?: string;
  readonly sort: "date" | "duration";
  readonly json: boolean;
};

type SortValue = "date" | "duration";

/** Accepted values for the --sort flag */
const VALID_SORT_VALUES: SortValue[] = ["date", "duration"];

/** Usage hint for ContextError messages */
const USAGE_HINT = "sentry trace list <org>/<project>";

/** Maximum allowed value for --limit flag */
const MAX_LIMIT = 1000;

/** Minimum allowed value for --limit flag */
const MIN_LIMIT = 1;

/** Default number of traces to show */
const DEFAULT_LIMIT = 20;

/**
 * Validate that --limit value is within allowed range.
 *
 * @throws Error if value is outside MIN_LIMIT..MAX_LIMIT range
 */
function validateLimit(value: string): number {
  const num = Number.parseInt(value, 10);
  if (Number.isNaN(num) || num < MIN_LIMIT || num > MAX_LIMIT) {
    throw new Error(`--limit must be between ${MIN_LIMIT} and ${MAX_LIMIT}`);
  }
  return num;
}

/**
 * Parse and validate sort flag value.
 *
 * @throws Error if value is not "date" or "duration"
 */
function parseSort(value: string): SortValue {
  if (!VALID_SORT_VALUES.includes(value as SortValue)) {
    throw new Error(
      `Invalid sort value. Must be one of: ${VALID_SORT_VALUES.join(", ")}`
    );
  }
  return value as SortValue;
}

/** Resolved org and project for trace commands */
type ResolvedTraceTarget = {
  org: string;
  project: string;
};

/**
 * Resolve org/project from parsed argument or auto-detection.
 *
 * Handles:
 * - explicit: "org/project" -> use directly
 * - project-search: "project" -> find project across all orgs
 * - auto-detect: no input -> use DSN detection or config defaults
 *
 * @throws {ContextError} When target cannot be resolved
 */
async function resolveTraceTarget(
  target: string | undefined,
  cwd: string
): Promise<ResolvedTraceTarget> {
  const parsed = parseOrgProjectArg(target);

  switch (parsed.type) {
    case "explicit":
      return { org: parsed.org, project: parsed.project };

    case "org-all":
      throw new ContextError(
        "Project",
        `Please specify a project: sentry trace list ${parsed.org}/<project>`
      );

    case "project-search": {
      const matches = await findProjectsBySlug(parsed.projectSlug);

      if (matches.length === 0) {
        throw new ContextError(
          "Project",
          `No project '${parsed.projectSlug}' found in any accessible organization.\n\n` +
            `Try: sentry trace list <org>/${parsed.projectSlug}`
        );
      }

      if (matches.length > 1) {
        const options = matches
          .map((m) => `  sentry trace list ${m.orgSlug}/${m.slug}`)
          .join("\n");
        throw new ContextError(
          "Project",
          `Found '${parsed.projectSlug}' in ${matches.length} organizations. Please specify:\n${options}`
        );
      }

      // Safe: we checked matches.length === 1 above, so first element exists
      const match = matches[0] as (typeof matches)[number];
      return { org: match.orgSlug, project: match.slug };
    }

    case "auto-detect": {
      const resolved = await resolveOrgAndProject({
        cwd,
        usageHint: USAGE_HINT,
      });
      if (!resolved) {
        throw new ContextError("Organization and project", USAGE_HINT);
      }
      return { org: resolved.org, project: resolved.project };
    }

    default: {
      const _exhaustiveCheck: never = parsed;
      throw new Error(`Unexpected parsed type: ${_exhaustiveCheck}`);
    }
  }
}

export const listCommand = buildCommand({
  docs: {
    brief: "List recent traces in a project",
    fullDescription:
      "List recent traces from Sentry projects.\n\n" +
      "Target specification:\n" +
      "  sentry trace list               # auto-detect from DSN or config\n" +
      "  sentry trace list <org>/<proj>  # explicit org and project\n" +
      "  sentry trace list <project>     # find project across all orgs\n\n" +
      "Examples:\n" +
      "  sentry trace list                     # List last 10 traces\n" +
      "  sentry trace list --limit 50          # Show more traces\n" +
      "  sentry trace list --sort duration     # Sort by slowest first\n" +
      '  sentry trace list -q "transaction:GET /api/users"  # Filter by transaction',
  },
  parameters: {
    positional: {
      kind: "tuple",
      parameters: [
        {
          placeholder: "target",
          brief: "Target: <org>/<project> or <project>",
          parse: String,
          optional: true,
        },
      ],
    },
    flags: {
      limit: {
        kind: "parsed",
        parse: validateLimit,
        brief: `Number of traces (${MIN_LIMIT}-${MAX_LIMIT})`,
        default: String(DEFAULT_LIMIT),
      },
      query: {
        kind: "parsed",
        parse: String,
        brief: "Search query (Sentry search syntax)",
        optional: true,
      },
      sort: {
        kind: "parsed",
        parse: parseSort,
        brief: "Sort by: date, duration",
        default: "date" as const,
      },
      json: {
        kind: "boolean",
        brief: "Output as JSON",
        default: false,
      },
    },
    aliases: { n: "limit", q: "query", s: "sort" },
  },
  async func(
    this: SentryContext,
    flags: ListFlags,
    target?: string
  ): Promise<void> {
    const { stdout, cwd, setContext } = this;

    // Resolve org/project from positional arg, config, or DSN auto-detection
    const { org, project } = await resolveTraceTarget(target, cwd);
    setContext([org], [project]);

    const traces = await listTransactions(org, project, {
      query: flags.query,
      limit: flags.limit,
      sort: flags.sort,
    });

    if (flags.json) {
      writeJson(stdout, traces);
      return;
    }

    if (traces.length === 0) {
      stdout.write("No traces found.\n");
      return;
    }

    stdout.write(`Recent traces in ${org}/${project}:\n\n`);
    stdout.write(formatTracesHeader());
    for (const trace of traces) {
      stdout.write(formatTraceRow(trace));
    }

    // Show footer with tip
    const hasMore = traces.length >= flags.limit;
    const countText = `Showing ${traces.length} trace${traces.length === 1 ? "" : "s"}.`;
    const tip = hasMore ? " Use --limit to show more." : "";
    writeFooter(
      stdout,
      `${countText}${tip} Use 'sentry trace view <TRACE_ID>' to view the full span tree.`
    );
  },
});
