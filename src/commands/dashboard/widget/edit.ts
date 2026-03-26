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
  DATASET_SUPPORTED_DISPLAY_TYPES,
  type DashboardDetail,
  type DashboardWidget,
  type DashboardWidgetQuery,
  parseAggregate,
  parseSortExpression,
  parseWidgetInput,
  prepareDashboardForUpdate,
  prepareWidgetQueries,
  validateAggregateNames,
} from "../../../types/dashboard.js";
import {
  parseDashboardPositionalArgs,
  resolveDashboardId,
  resolveOrgFromTarget,
  resolveWidgetIndex,
  validateWidgetEnums,
  type WidgetQueryFlags,
} from "../resolve.js";

type EditFlags = WidgetQueryFlags & {
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

/** Build the replacement widget object by merging flags over existing */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: merging + validating widget flags requires several conditional branches
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
  //
  // Scope: only cross-validate when effectiveDisplay is a tracked type (present in
  // DATASET_SUPPORTED_DISPLAY_TYPES). Untracked types — text, wheel, rage_and_dead_clicks,
  // agents_traces_table — bypass Sentry's dataset system entirely and have no constraints.
  // Validating them against a dataset would always fail, blocking legitimate edits like
  // changing --dataset on a text widget.
  if (flags.display || flags.dataset) {
    // Only cross-validate when effectiveDisplay is a tracked type (present in
    // DATASET_SUPPORTED_DISPLAY_TYPES). Untracked types — text, wheel,
    // rage_and_dead_clicks, agents_traces_table — bypass Sentry's dataset system
    // entirely, so any dataset is valid with them regardless of which flag triggered this.
    const isTrackedDisplay = Object.values(
      DATASET_SUPPORTED_DISPLAY_TYPES
    ).some((types) =>
      (types as readonly string[]).includes(effectiveDisplay ?? "")
    );
    if (isTrackedDisplay) {
      validateWidgetEnums(effectiveDisplay, effectiveDataset);
    }
  }

  const raw: Record<string, unknown> = {
    title: flags["new-title"] ?? existing.title,
    displayType: effectiveDisplay,
    queries: mergedQueries ?? existing.queries,
    layout: existing.layout,
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
    return { hint: `Dashboard: ${url}` };
  },
});
