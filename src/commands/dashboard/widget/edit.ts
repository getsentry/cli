/**
 * sentry dashboard widget edit
 *
 * Edit a widget in an existing dashboard.
 */

import type { SentryContext } from "../../../context.js";
import { getDashboard, updateDashboard } from "../../../lib/api-client.js";
import { parseOrgProjectArg } from "../../../lib/arg-parsing.js";
import { buildCommand, numberParser } from "../../../lib/command.js";
import { ValidationError } from "../../../lib/errors.js";
import { formatWidgetEdited } from "../../../lib/formatters/human.js";
import { buildDashboardUrl } from "../../../lib/sentry-urls.js";
import {
  type DashboardDetail,
  type DashboardWidget,
  DashboardWidgetSchema,
  prepareDashboardForUpdate,
} from "../../../types/dashboard.js";
import {
  parseDashboardPositionalArgs,
  resolveDashboardId,
  resolveOrgFromTarget,
} from "../resolve.js";

type EditFlags = {
  readonly "from-json": string;
  readonly index?: number;
  readonly title?: string;
  readonly json: boolean;
  readonly fields?: string[];
};

type EditResult = {
  dashboard: DashboardDetail;
  widget: DashboardWidget;
  url: string;
};

/** Resolve widget index from --index or --title flags */
function resolveWidgetIndex(
  widgets: DashboardWidget[],
  index: number | undefined,
  title: string | undefined
): number {
  if (index !== undefined) {
    if (index < 0 || index >= widgets.length) {
      throw new ValidationError(
        `Widget index ${index} out of range (dashboard has ${widgets.length} widgets).`,
        "index"
      );
    }
    return index;
  }
  const matchIndex = widgets.findIndex((w) => w.title === title);
  if (matchIndex === -1) {
    throw new ValidationError(
      `No widget with title '${title}' found in dashboard.`,
      "title"
    );
  }
  return matchIndex;
}

export const editCommand = buildCommand({
  docs: {
    brief: "Edit a widget in a dashboard",
    fullDescription:
      "Edit a widget in an existing Sentry dashboard.\n\n" +
      "The dashboard can be specified by numeric ID or title.\n" +
      "Identify the widget by --index (0-based) or --title.\n\n" +
      "Examples:\n" +
      "  sentry dashboard widget edit 12345 --index 0 --from-json widget.json\n" +
      "  sentry dashboard widget edit 'My Dashboard' --title 'Error Rate' --from-json widget.json",
  },
  output: {
    json: true,
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
      "from-json": {
        kind: "parsed",
        parse: String,
        brief: "Path to JSON file containing widget definition",
      },
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
  async func(this: SentryContext, flags: EditFlags, ...args: string[]) {
    const { cwd } = this;

    if (flags.index === undefined && !flags.title) {
      throw new ValidationError(
        "Specify --index or --title to identify the widget to edit.",
        "index"
      );
    }

    const { dashboardRef, targetArg } = parseDashboardPositionalArgs(args);
    const parsed = parseOrgProjectArg(targetArg);
    const orgSlug = await resolveOrgFromTarget(
      parsed,
      cwd,
      "sentry dashboard widget edit <org>/ <id> --from-json <path>"
    );
    const dashboardId = await resolveDashboardId(orgSlug, dashboardRef);

    // Read and validate widget JSON
    const jsonPath = flags["from-json"];
    const file = Bun.file(jsonPath);
    if (!(await file.exists())) {
      throw new ValidationError(
        `Widget JSON file not found: ${jsonPath}`,
        "from-json"
      );
    }
    const raw = await file.text();
    let widgetParsed: unknown;
    try {
      widgetParsed = JSON.parse(raw);
    } catch {
      throw new ValidationError(
        `Invalid JSON in widget file: ${jsonPath}`,
        "from-json"
      );
    }

    const widgetResult = DashboardWidgetSchema.safeParse(widgetParsed);
    if (!widgetResult.success) {
      throw new ValidationError(
        `Invalid widget definition: ${widgetResult.error.message}`,
        "from-json"
      );
    }
    let replacement = widgetResult.data;

    // GET current dashboard → find widget → replace → PUT
    const current = await getDashboard(orgSlug, dashboardId);
    const widgets = current.widgets ?? [];

    const widgetIndex = resolveWidgetIndex(widgets, flags.index, flags.title);

    const updateBody = prepareDashboardForUpdate(current);
    // Preserve existing layout when replacement doesn't specify one
    const existingWidget = updateBody.widgets[widgetIndex];
    if (!replacement.layout && existingWidget?.layout) {
      replacement = { ...replacement, layout: existingWidget.layout };
    }
    updateBody.widgets[widgetIndex] = replacement;

    const updated = await updateDashboard(orgSlug, dashboardId, updateBody);
    const url = buildDashboardUrl(orgSlug, dashboardId);

    return {
      data: { dashboard: updated, widget: replacement, url } as EditResult,
    };
  },
});
