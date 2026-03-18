/**
 * sentry dashboard widget add
 *
 * Add a widget to an existing dashboard using inline flags.
 */

import type { SentryContext } from "../../../context.js";
import { getDashboard, updateDashboard } from "../../../lib/api-client.js";
import { parseOrgProjectArg } from "../../../lib/arg-parsing.js";
import { buildCommand, numberParser } from "../../../lib/command.js";
import { ValidationError } from "../../../lib/errors.js";
import { formatWidgetAdded } from "../../../lib/formatters/human.js";
import { CommandOutput } from "../../../lib/formatters/output.js";
import { buildDashboardUrl } from "../../../lib/sentry-urls.js";
import {
  assignDefaultLayout,
  type DashboardDetail,
  type DashboardWidget,
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
  validateWidgetEnums,
} from "../resolve.js";

type AddFlags = {
  readonly display: string;
  readonly dataset?: string;
  readonly query?: string[];
  readonly where?: string;
  readonly "group-by"?: string[];
  readonly sort?: string;
  readonly limit?: number;
  readonly json: boolean;
  readonly fields?: string[];
};

type AddResult = {
  dashboard: DashboardDetail;
  widget: DashboardWidget;
  url: string;
};

/**
 * Parse positional args for widget add.
 * Last arg is widget title, rest go to dashboard resolution.
 */
function parseAddPositionalArgs(args: string[]): {
  dashboardArgs: string[];
  title: string;
} {
  if (args.length < 2) {
    throw new ValidationError(
      "Widget title is required as a positional argument.\n\n" +
        "Example:\n" +
        '  sentry dashboard widget add <dashboard> "My Widget" --display line --query count',
      "title"
    );
  }

  const title = args.at(-1) as string;
  const dashboardArgs = args.slice(0, -1);
  return { dashboardArgs, title };
}

export const addCommand = buildCommand({
  docs: {
    brief: "Add a widget to a dashboard",
    fullDescription:
      "Add a widget to an existing Sentry dashboard.\n\n" +
      "The dashboard can be specified by numeric ID or title.\n\n" +
      "Examples:\n" +
      "  sentry dashboard widget add 'My Dashboard' \"Error Count\" \\\n" +
      "    --display big_number --query count\n\n" +
      "  sentry dashboard widget add 'My Dashboard' \"Errors by Browser\" \\\n" +
      "    --display line --query count --group-by browser.name\n\n" +
      "  sentry dashboard widget add 'My Dashboard' \"Top Endpoints\" \\\n" +
      "    --display table --query count --query p95:span.duration \\\n" +
      "    --group-by transaction --sort -count --limit 10\n\n" +
      "Query shorthand (--query flag):\n" +
      "  count          → count()         (bare name = no-arg aggregate)\n" +
      "  p95:span.duration → p95(span.duration)  (colon = function with arg)\n" +
      "  count()        → count()         (parens passthrough)\n\n" +
      "Sort shorthand (--sort flag):\n" +
      "  count          → count()         (ascending)\n" +
      "  -count         → -count()        (descending)",
  },
  output: {
    human: formatWidgetAdded,
  },
  parameters: {
    positional: {
      kind: "array",
      parameter: {
        brief: "[<org/project>] <dashboard> <title>",
        parse: String,
      },
    },
    flags: {
      display: {
        kind: "parsed",
        parse: String,
        brief: "Display type (line, bar, table, big_number, ...)",
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
      d: "display",
      q: "query",
      w: "where",
      g: "group-by",
      s: "sort",
      n: "limit",
    },
  },
  async *func(this: SentryContext, flags: AddFlags, ...args: string[]) {
    const { cwd } = this;

    const { dashboardArgs, title } = parseAddPositionalArgs(args);
    const { dashboardRef, targetArg } =
      parseDashboardPositionalArgs(dashboardArgs);
    const parsed = parseOrgProjectArg(targetArg);
    const orgSlug = await resolveOrgFromTarget(
      parsed,
      cwd,
      "sentry dashboard widget add <org>/ <dashboard> <title> --display <type>"
    );
    const dashboardId = await resolveDashboardId(orgSlug, dashboardRef);

    validateWidgetEnums(flags.display, flags.dataset);

    const aggregates = (flags.query ?? ["count"]).map(parseAggregate);
    const columns = flags["group-by"] ?? [];
    const orderby = flags.sort ? parseSortExpression(flags.sort) : undefined;

    const raw = {
      title,
      displayType: flags.display,
      ...(flags.dataset && { widgetType: flags.dataset }),
      queries: [
        {
          aggregates,
          columns,
          conditions: flags.where ?? "",
          ...(orderby && { orderby }),
          name: "",
        },
      ],
      ...(flags.limit !== undefined && { limit: flags.limit }),
    };
    let newWidget = prepareWidgetQueries(parseWidgetInput(raw));

    // GET current dashboard → append widget with auto-layout → PUT
    const current = await getDashboard(orgSlug, dashboardId);
    const updateBody = prepareDashboardForUpdate(current);
    newWidget = assignDefaultLayout(newWidget, updateBody.widgets);
    updateBody.widgets.push(newWidget);

    const updated = await updateDashboard(orgSlug, dashboardId, updateBody);
    const url = buildDashboardUrl(orgSlug, dashboardId);

    yield new CommandOutput({
      dashboard: updated,
      widget: newWidget,
      url,
    } as AddResult);
  },
});
