/**
 * sentry dashboard widget delete
 *
 * Remove a widget from an existing dashboard.
 */

import type { SentryContext } from "../../../context.js";
import { getDashboard, updateDashboard } from "../../../lib/api-client.js";
import { parseOrgProjectArg } from "../../../lib/arg-parsing.js";
import { buildCommand, numberParser } from "../../../lib/command.js";
import { ValidationError } from "../../../lib/errors.js";
import { formatWidgetDeleted } from "../../../lib/formatters/human.js";
import { CommandOutput } from "../../../lib/formatters/output.js";
import { buildDashboardUrl } from "../../../lib/sentry-urls.js";
import {
  type DashboardDetail,
  prepareDashboardForUpdate,
} from "../../../types/dashboard.js";
import {
  parseDashboardPositionalArgs,
  resolveDashboardId,
  resolveOrgFromTarget,
  resolveWidgetIndex,
} from "../resolve.js";

type DeleteFlags = {
  readonly index?: number;
  readonly title?: string;
  readonly json: boolean;
  readonly fields?: string[];
};

type DeleteResult = {
  dashboard: DashboardDetail;
  widgetTitle: string;
  url: string;
};

export const deleteCommand = buildCommand({
  docs: {
    brief: "Delete a widget from a dashboard",
    fullDescription:
      "Remove a widget from an existing Sentry dashboard.\n\n" +
      "The dashboard can be specified by numeric ID or title.\n" +
      "Identify the widget by --index (0-based) or --title.\n\n" +
      "Examples:\n" +
      "  sentry dashboard widget delete 12345 --index 0\n" +
      "  sentry dashboard widget delete 'My Dashboard' --title 'Error Rate'",
  },
  output: {
    human: formatWidgetDeleted,
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
    },
    aliases: { i: "index", t: "title" },
  },
  async *func(this: SentryContext, flags: DeleteFlags, ...args: string[]) {
    const { cwd } = this;

    if (flags.index === undefined && !flags.title) {
      throw new ValidationError(
        "Specify --index or --title to identify the widget to delete.",
        "index"
      );
    }

    const { dashboardRef, targetArg } = parseDashboardPositionalArgs(args);
    const parsed = parseOrgProjectArg(targetArg);
    const orgSlug = await resolveOrgFromTarget(
      parsed,
      cwd,
      "sentry dashboard widget delete <org>/ <id> (--index <n> | --title <name>)"
    );
    const dashboardId = await resolveDashboardId(orgSlug, dashboardRef);

    // GET current dashboard → find widget → splice → PUT
    const current = await getDashboard(orgSlug, dashboardId);
    const widgets = current.widgets ?? [];

    const widgetIndex = resolveWidgetIndex(widgets, flags.index, flags.title);

    const widgetTitle = widgets[widgetIndex]?.title;
    const updateBody = prepareDashboardForUpdate(current);
    updateBody.widgets.splice(widgetIndex, 1);

    const updated = await updateDashboard(orgSlug, dashboardId, updateBody);
    const url = buildDashboardUrl(orgSlug, dashboardId);

    yield new CommandOutput({
      dashboard: updated,
      widgetTitle,
      url,
    } as DeleteResult);
  },
});
