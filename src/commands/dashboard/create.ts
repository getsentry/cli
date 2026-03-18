/**
 * sentry dashboard create
 *
 * Create a new dashboard in a Sentry organization.
 */

import type { SentryContext } from "../../context.js";
import { createDashboard, getProject } from "../../lib/api-client.js";
import {
  type ParsedOrgProject,
  parseOrgProjectArg,
} from "../../lib/arg-parsing.js";
import { buildCommand, numberParser } from "../../lib/command.js";
import { ContextError, ValidationError } from "../../lib/errors.js";
import { formatDashboardCreated } from "../../lib/formatters/human.js";
import { CommandOutput } from "../../lib/formatters/output.js";
import {
  fetchProjectId,
  resolveAllTargets,
  resolveOrg,
  resolveProjectBySlug,
  toNumericId,
} from "../../lib/resolve-target.js";
import { buildDashboardUrl } from "../../lib/sentry-urls.js";
import {
  assignDefaultLayout,
  type DashboardDetail,
  type DashboardWidget,
  DISPLAY_TYPES,
} from "../../types/dashboard.js";
import { buildWidgetFromFlags } from "./resolve.js";

type CreateFlags = {
  readonly "widget-title"?: string;
  readonly "widget-display"?: string;
  readonly "widget-dataset"?: string;
  readonly "widget-query"?: string[];
  readonly "widget-where"?: string;
  readonly "widget-group-by"?: string[];
  readonly "widget-sort"?: string;
  readonly "widget-limit"?: number;
  readonly json: boolean;
  readonly fields?: string[];
};

type CreateResult = DashboardDetail & { url: string };

/**
 * Parse array positional args for `dashboard create`.
 *
 * Handles:
 * - `<title>` — title only (auto-detect org/project)
 * - `<target> <title>` — explicit target + title
 */
function parsePositionalArgs(args: string[]): {
  title: string;
  targetArg: string | undefined;
} {
  if (args.length === 0) {
    throw new ValidationError("Dashboard title is required.", "title");
  }
  if (args.length === 1) {
    return { title: args[0] as string, targetArg: undefined };
  }
  // Two args: first is target, second is title
  return { title: args[1] as string, targetArg: args[0] as string };
}

/** Result of resolving org + project IDs from the parsed target */
type ResolvedDashboardTarget = {
  orgSlug: string;
  projectIds: number[];
};

/** Enrich targets that lack a projectId by calling the project API */
async function enrichTargetProjectIds(
  targets: { org: string; project: string; projectId?: number }[]
): Promise<number[]> {
  const enriched = await Promise.all(
    targets.map(async (t) => {
      if (t.projectId !== undefined) {
        return t.projectId;
      }
      try {
        const info = await getProject(t.org, t.project);
        return toNumericId(info.id);
      } catch {
        return;
      }
    })
  );
  return enriched.filter((id): id is number => id !== undefined);
}

/** Resolve org and project IDs from the parsed target argument */
async function resolveDashboardTarget(
  parsed: ParsedOrgProject,
  cwd: string
): Promise<ResolvedDashboardTarget> {
  switch (parsed.type) {
    case "explicit": {
      const pid = await fetchProjectId(parsed.org, parsed.project);
      return {
        orgSlug: parsed.org,
        projectIds: pid !== undefined ? [pid] : [],
      };
    }
    case "org-all":
      return { orgSlug: parsed.org, projectIds: [] };

    case "project-search": {
      const found = await resolveProjectBySlug(
        parsed.projectSlug,
        "sentry dashboard create <org>/<project> <title>"
      );
      const pid = await fetchProjectId(found.org, found.project);
      return {
        orgSlug: found.org,
        projectIds: pid !== undefined ? [pid] : [],
      };
    }
    case "auto-detect": {
      const result = await resolveAllTargets({ cwd });
      if (result.targets.length === 0) {
        const resolved = await resolveOrg({ cwd });
        if (!resolved) {
          throw new ContextError(
            "Organization",
            "sentry dashboard create <org>/ <title>"
          );
        }
        return { orgSlug: resolved.org, projectIds: [] };
      }
      const orgSlug = (result.targets[0] as (typeof result.targets)[0]).org;
      const projectIds = await enrichTargetProjectIds(result.targets);
      return { orgSlug, projectIds };
    }
    default: {
      const _exhaustive: never = parsed;
      throw new Error(
        `Unexpected parsed type: ${(_exhaustive as { type: string }).type}`
      );
    }
  }
}

/** Build an inline widget from --widget-* flags */
function buildInlineWidget(flags: CreateFlags): DashboardWidget {
  if (!flags["widget-title"]) {
    throw new ValidationError(
      "Missing --widget-title. Both --widget-title and --widget-display are required for inline widgets.\n\n" +
        "Example:\n" +
        "  sentry dashboard create 'My Dashboard' --widget-title \"Error Count\" --widget-display big_number --widget-query count",
      "widget-title"
    );
  }

  return buildWidgetFromFlags({
    title: flags["widget-title"],
    display: flags["widget-display"] as string,
    dataset: flags["widget-dataset"],
    query: flags["widget-query"],
    where: flags["widget-where"],
    groupBy: flags["widget-group-by"],
    sort: flags["widget-sort"],
    limit: flags["widget-limit"],
  });
}

export const createCommand = buildCommand({
  docs: {
    brief: "Create a dashboard",
    fullDescription:
      "Create a new Sentry dashboard.\n\n" +
      "Examples:\n" +
      "  sentry dashboard create 'My Dashboard'\n" +
      "  sentry dashboard create my-org/ 'My Dashboard'\n" +
      "  sentry dashboard create my-org/my-project 'My Dashboard'\n\n" +
      "With an inline widget:\n" +
      "  sentry dashboard create 'My Dashboard' \\\n" +
      '    --widget-title "Error Count" --widget-display big_number --widget-query count',
  },
  output: {
    human: formatDashboardCreated,
  },
  parameters: {
    positional: {
      kind: "array",
      parameter: {
        brief: "[<org/project>] <title>",
        parse: String,
      },
    },
    flags: {
      "widget-title": {
        kind: "parsed",
        parse: String,
        brief: "Inline widget title",
        optional: true,
      },
      "widget-display": {
        kind: "parsed",
        parse: String,
        brief: "Inline widget display type (line, bar, table, big_number, ...)",
        optional: true,
      },
      "widget-dataset": {
        kind: "parsed",
        parse: String,
        brief: "Inline widget dataset (default: spans)",
        optional: true,
      },
      "widget-query": {
        kind: "parsed",
        parse: String,
        brief: "Inline widget aggregate (e.g. count, p95:span.duration)",
        variadic: true,
        optional: true,
      },
      "widget-where": {
        kind: "parsed",
        parse: String,
        brief: "Inline widget search conditions filter",
        optional: true,
      },
      "widget-group-by": {
        kind: "parsed",
        parse: String,
        brief: "Inline widget group-by column (repeatable)",
        variadic: true,
        optional: true,
      },
      "widget-sort": {
        kind: "parsed",
        parse: String,
        brief: "Inline widget order by (prefix - for desc)",
        optional: true,
      },
      "widget-limit": {
        kind: "parsed",
        parse: numberParser,
        brief: "Inline widget result limit",
        optional: true,
      },
    },
  },
  async *func(this: SentryContext, flags: CreateFlags, ...args: string[]) {
    const { cwd } = this;

    const { title, targetArg } = parsePositionalArgs(args);
    const parsed = parseOrgProjectArg(targetArg);
    const { orgSlug, projectIds } = await resolveDashboardTarget(parsed, cwd);

    const widgets: DashboardWidget[] = [];
    if (flags["widget-display"]) {
      const validated = buildInlineWidget(flags);
      widgets.push(assignDefaultLayout(validated, widgets));
    } else if (flags["widget-title"]) {
      throw new ValidationError(
        "Missing --widget-display. Both --widget-title and --widget-display are required for inline widgets.\n\n" +
          "Example:\n" +
          "  sentry dashboard create 'My Dashboard' --widget-title \"Error Count\" --widget-display big_number --widget-query count\n\n" +
          `Valid display types: ${DISPLAY_TYPES.join(", ")}`,
        "widget-display"
      );
    } else if (
      flags["widget-query"] ||
      flags["widget-dataset"] ||
      flags["widget-where"] ||
      flags["widget-group-by"] ||
      flags["widget-sort"] ||
      flags["widget-limit"] !== undefined
    ) {
      throw new ValidationError(
        "Widget flags require --widget-title and --widget-display.\n\n" +
          "Example:\n" +
          "  sentry dashboard create 'My Dashboard' --widget-title \"Error Count\" --widget-display big_number --widget-query count",
        "widget-display"
      );
    }

    const dashboard = await createDashboard(orgSlug, {
      title,
      widgets,
      projects: projectIds.length > 0 ? projectIds : undefined,
    });
    const url = buildDashboardUrl(orgSlug, dashboard.id);

    yield new CommandOutput({ ...dashboard, url } as CreateResult);
    return { hint: `Dashboard: ${url}` };
  },
});
