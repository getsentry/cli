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
  FALLBACK_LAYOUT,
  parseAggregate,
  parseSortExpression,
  parseWidgetInput,
  prepareDashboardForUpdate,
  prepareWidgetQueries,
  validateAggregateNames,
  validateWidgetLayout,
  type WidgetLayoutFlags,
} from "../../../types/dashboard.js";
import {
  enrichDashboardError,
  parseDashboardPositionalArgs,
  resolveDashboardId,
  resolveOrgFromTarget,
  resolveWidgetIndex,
  validateWidgetEnums,
  type WidgetQueryFlags,
} from "../resolve.js";

type EditFlags = WidgetQueryFlags &
  WidgetLayoutFlags & {
    readonly index?: number;
    readonly title?: string;
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

  // Destructure to omit stale `fields` — prepareWidgetQueries will
  // recompute it from the updated aggregates/columns.
  const { fields: _staleFields, ...base } = existingQuery ?? {};
  return [
    {
      ...base,
      ...(flags.query && { aggregates: flags.query.map(parseAggregate) }),
      ...(flags.where !== undefined && { conditions: flags.where }),
      ...(flags["group-by"] && { columns: flags["group-by"] }),
      ...(flags.sort && { orderby: parseSortExpression(flags.sort) }),
    },
  ];
}

/** Merge layout flags over existing layout, returning the result or the existing layout unchanged */
function mergeLayout(
  flags: WidgetLayoutFlags,
  existing: DashboardWidget
): DashboardWidget["layout"] {
  const hasChange =
    flags.x !== undefined ||
    flags.y !== undefined ||
    flags.width !== undefined ||
    flags.height !== undefined;

  if (!hasChange) {
    return existing.layout;
  }

  return {
    ...(existing.layout ?? FALLBACK_LAYOUT),
    ...(flags.x !== undefined && { x: flags.x }),
    ...(flags.y !== undefined && { y: flags.y }),
    ...(flags.width !== undefined && { w: flags.width }),
    ...(flags.height !== undefined && { h: flags.height }),
  };
}

/** Build the replacement widget object by merging flags over existing */
function buildReplacement(
  flags: EditFlags,
  existing: DashboardWidget
): DashboardWidget {
  const mergedQueries = mergeQueries(flags, existing.queries?.[0]);

  // Validate aggregates when query or dataset changes — prevents broken widgets
  // (e.g. switching --dataset from discover to spans with discover-only aggregates)
  const newDataset = flags.dataset ?? existing.widgetType;
  const aggregatesToValidate =
    mergedQueries?.[0]?.aggregates ?? existing.queries?.[0]?.aggregates;
  if ((flags.query || flags.dataset) && aggregatesToValidate) {
    validateAggregateNames(aggregatesToValidate, newDataset);
  }

  const limit = flags.limit !== undefined ? flags.limit : existing.limit;

  const effectiveDisplay = flags.display ?? existing.displayType;
  const effectiveDataset = flags.dataset ?? existing.widgetType;

  // Re-validate after merging with existing values. validateWidgetEnums only
  // checks the cross-constraint when both args are provided, so it misses
  // e.g. `--dataset preprod-app-size` on a widget that's already `table`.
  // validateWidgetEnums itself skips untracked display types (text, wheel, etc.).
  if (flags.display || flags.dataset) {
    validateWidgetEnums(effectiveDisplay, effectiveDataset);
  }

  const raw: Record<string, unknown> = {
    title: flags["new-title"] ?? existing.title,
    displayType: effectiveDisplay,
    queries: mergedQueries ?? existing.queries,
    layout: mergeLayout(flags, existing),
  };
  // Only set widgetType if explicitly provided via --dataset or already on the widget.
  // Avoids parseWidgetInput defaulting to "spans" for widgets without a widgetType.
  if (flags.dataset) {
    raw.widgetType = flags.dataset;
  } else if (existing.widgetType) {
    raw.widgetType = existing.widgetType;
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
      "Layout flags (--x, --y, --width, --height) control widget position\n" +
      "and size in the 6-column dashboard grid.\n\n" +
      "Examples:\n" +
      "  sentry dashboard widget edit 12345 --title 'Error Rate' --display bar\n" +
      "  sentry dashboard widget edit 'My Dashboard' --index 0 --query p95:span.duration\n" +
      "  sentry dashboard widget edit 12345 --title 'Old Name' --new-title 'New Name'\n" +
      "  sentry dashboard widget edit 12345 --index 0 --x 0 --y 0 --width 6 --height 2",
  },
  output: {
    human: formatWidgetEdited,
  },
  parameters: {
    positional: {
      kind: "array",
      parameter: {
        placeholder: "org/project/dashboard",
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
        brief:
          "Display type (big_number, line, area, bar, table, stacked_area, top_n, text, categorical_bar, details, wheel, rage_and_dead_clicks, server_tree, agents_traces_table)",
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
      x: {
        kind: "parsed",
        parse: numberParser,
        brief: "Grid column position (0-based, 0–5)",
        optional: true,
      },
      y: {
        kind: "parsed",
        parse: numberParser,
        brief: "Grid row position (0-based)",
        optional: true,
      },
      width: {
        kind: "parsed",
        parse: numberParser,
        brief: "Widget width in grid columns (1–6)",
        optional: true,
      },
      height: {
        kind: "parsed",
        parse: numberParser,
        brief: "Widget height in grid rows (min 1)",
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
    const current = await getDashboard(orgSlug, dashboardId).catch(
      (error: unknown) =>
        enrichDashboardError(error, { orgSlug, dashboardId, operation: "view" })
    );
    const widgets = current.widgets ?? [];
    const widgetIndex = resolveWidgetIndex(widgets, flags.index, flags.title);

    const updateBody = prepareDashboardForUpdate(current);
    const existing = updateBody.widgets[widgetIndex] as DashboardWidget;

    // Validate individual layout flag ranges early (catches --x -1, --width 7, etc.)
    validateWidgetLayout(flags, existing.layout);

    const replacement = buildReplacement(flags, existing);

    // Re-validate the final merged layout when the existing widget had no layout
    // and FALLBACK_LAYOUT was used — the early check couldn't cross-validate
    // because the fallback dimensions weren't known yet.
    if (replacement.layout && !existing.layout) {
      validateWidgetLayout(
        { x: replacement.layout.x, width: replacement.layout.w },
        replacement.layout
      );
    }

    updateBody.widgets[widgetIndex] = replacement;

    const updated = await updateDashboard(
      orgSlug,
      dashboardId,
      updateBody
    ).catch((error: unknown) =>
      enrichDashboardError(error, {
        orgSlug,
        dashboardId,
        operation: "update",
      })
    );
    const url = buildDashboardUrl(orgSlug, dashboardId);

    yield new CommandOutput({
      dashboard: updated,
      widget: replacement,
      url,
    } as EditResult);
    return { hint: `Dashboard: ${url}` };
  },
});
