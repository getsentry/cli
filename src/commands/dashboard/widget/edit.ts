/**
 * sentry dashboard widget edit
 *
 * Edit a widget in an existing dashboard using inline flags.
 */

import type { SentryContext } from "../../../context.js";
import { getDashboard, updateDashboard } from "../../../lib/api-client.js";
import { parseOrgProjectArg } from "../../../lib/arg-parsing.js";
import { buildCommand, numberParser } from "../../../lib/command.js";
import { ValidationError } from "../../../lib/errors.js";
import { formatWidgetEdited } from "../../../lib/formatters/human.js";
import { CommandOutput } from "../../../lib/formatters/output.js";
import { buildDashboardUrl } from "../../../lib/sentry-urls.js";
import {
  type DashboardDetail,
  type DashboardWidget,
  type DashboardWidgetQuery,
  parseAggregate,
  parseSortExpression,
  parseWidgetInput,
  prepareDashboardForUpdate,
  prepareWidgetQueries,
} from "../../../types/dashboard.js";
import {
  parseDashboardPositionalArgs,
  resolveDashboardId,
  resolveOrgFromTarget,
  resolveWidgetIndex,
  validateWidgetEnums,
} from "../resolve.js";

type EditFlags = {
  readonly index?: number;
  readonly title?: string;
  readonly display?: string;
  readonly dataset?: string;
  readonly query?: string[];
  readonly where?: string;
  readonly "group-by"?: string[];
  readonly sort?: string;
  readonly limit?: number;
  readonly "new-title"?: string;
  readonly json: boolean;
  readonly fields?: string[];
};

type EditResult = {
  dashboard: DashboardDetail;
  widget: DashboardWidget;
  url: string;
};

/** Merge query-level flags over existing widget query */
function mergeQueries(
  flags: EditFlags,
  existingQuery: DashboardWidgetQuery | undefined
): DashboardWidgetQuery[] | undefined {
  const hasChanges =
    flags.query || flags.where !== undefined || flags["group-by"] || flags.sort;

  if (!hasChanges) {
    return; // signal: keep existing
  }

  return [
    {
      ...existingQuery,
      ...(flags.query && { aggregates: flags.query.map(parseAggregate) }),
      ...(flags.where !== undefined && { conditions: flags.where }),
      ...(flags["group-by"] && { columns: flags["group-by"] }),
      ...(flags.sort && { orderby: parseSortExpression(flags.sort) }),
    },
  ];
}

/** Build the replacement widget object by merging flags over existing */
function buildReplacement(
  flags: EditFlags,
  existing: DashboardWidget
): DashboardWidget {
  const mergedQueries = mergeQueries(flags, existing.queries?.[0]);

  const widgetType = flags.dataset ?? existing.widgetType;
  const limit = flags.limit !== undefined ? flags.limit : existing.limit;

  const raw: Record<string, unknown> = {
    title: flags["new-title"] ?? existing.title,
    displayType: flags.display ?? existing.displayType,
    queries: mergedQueries ?? existing.queries,
    layout: existing.layout,
  };
  if (widgetType) {
    raw.widgetType = widgetType;
  }
  if (limit !== undefined) {
    raw.limit = limit;
  }

  return prepareWidgetQueries(parseWidgetInput(raw));
}

export const editCommand = buildCommand({
  docs: {
    brief: "Edit a widget in a dashboard",
    fullDescription:
      "Edit a widget in an existing Sentry dashboard.\n\n" +
      "The dashboard can be specified by numeric ID or title.\n" +
      "Identify the widget by --index (0-based) or --title.\n" +
      "Only provided flags are changed — omitted values are preserved.\n\n" +
      "Examples:\n" +
      "  sentry dashboard widget edit 12345 --title 'Error Rate' --display bar\n" +
      "  sentry dashboard widget edit 'My Dashboard' --index 0 --query p95:span.duration\n" +
      "  sentry dashboard widget edit 12345 --title 'Old Name' --new-title 'New Name'",
  },
  output: {
    human: formatWidgetEdited,
  },
  parameters: {
    positional: {
      kind: "array",
      parameter: {
        brief: "[<org/project>] <dashboard-id-or-title>",
        parse: String,
      },
    },
    flags: {
      index: {
        kind: "parsed",
        parse: numberParser,
        brief: "Widget index (0-based)",
        optional: true,
      },
      title: {
        kind: "parsed",
        parse: String,
        brief: "Widget title to match",
        optional: true,
      },
      "new-title": {
        kind: "parsed",
        parse: String,
        brief: "New widget title",
        optional: true,
      },
      display: {
        kind: "parsed",
        parse: String,
        brief: "Display type (line, bar, table, big_number, ...)",
        optional: true,
      },
      dataset: {
        kind: "parsed",
        parse: String,
        brief: "Widget dataset (default: spans)",
        optional: true,
      },
      query: {
        kind: "parsed",
        parse: String,
        brief: "Aggregate expression (e.g. count, p95:span.duration)",
        variadic: true,
        optional: true,
      },
      where: {
        kind: "parsed",
        parse: String,
        brief: "Search conditions filter (e.g. is:unresolved)",
        optional: true,
      },
      "group-by": {
        kind: "parsed",
        parse: String,
        brief: "Group-by column (repeatable)",
        variadic: true,
        optional: true,
      },
      sort: {
        kind: "parsed",
        parse: String,
        brief: "Order by (prefix - for desc, e.g. -count)",
        optional: true,
      },
      limit: {
        kind: "parsed",
        parse: numberParser,
        brief: "Result limit",
        optional: true,
      },
    },
    aliases: {
      i: "index",
      t: "title",
      d: "display",
      q: "query",
      w: "where",
      g: "group-by",
      s: "sort",
      n: "limit",
    },
  },
  async *func(this: SentryContext, flags: EditFlags, ...args: string[]) {
    const { cwd } = this;

    if (flags.index === undefined && !flags.title) {
      throw new ValidationError(
        "Specify --index or --title to identify the widget to edit.\n\n" +
          "Example:\n" +
          "  sentry dashboard widget edit <dashboard> --title 'My Widget' --display bar",
        "index"
      );
    }

    validateWidgetEnums(flags.display, flags.dataset);

    const { dashboardRef, targetArg } = parseDashboardPositionalArgs(args);
    const parsed = parseOrgProjectArg(targetArg);
    const orgSlug = await resolveOrgFromTarget(
      parsed,
      cwd,
      "sentry dashboard widget edit <org>/ <dashboard> --title <name> --display <type>"
    );
    const dashboardId = await resolveDashboardId(orgSlug, dashboardRef);

    // GET current dashboard → find widget → merge changes → PUT
    const current = await getDashboard(orgSlug, dashboardId);
    const widgets = current.widgets ?? [];
    const widgetIndex = resolveWidgetIndex(widgets, flags.index, flags.title);

    const updateBody = prepareDashboardForUpdate(current);
    const existing = updateBody.widgets[widgetIndex] as DashboardWidget;
    const replacement = buildReplacement(flags, existing);
    updateBody.widgets[widgetIndex] = replacement;

    const updated = await updateDashboard(orgSlug, dashboardId, updateBody);
    const url = buildDashboardUrl(orgSlug, dashboardId);

    yield new CommandOutput({
      dashboard: updated,
      widget: replacement,
      url,
    } as EditResult);
  },
});
