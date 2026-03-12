/**
 * sentry dashboard widget add
 *
 * Add a widget to an existing dashboard.
 */

import type { SentryContext } from "../../../context.js";
import { getDashboard, updateDashboard } from "../../../lib/api-client.js";
import { parseOrgProjectArg } from "../../../lib/arg-parsing.js";
import { buildCommand } from "../../../lib/command.js";
import { ValidationError } from "../../../lib/errors.js";
import { formatWidgetAdded } from "../../../lib/formatters/human.js";
import { buildDashboardUrl } from "../../../lib/sentry-urls.js";
import {
  assignDefaultLayout,
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

type AddFlags = {
  readonly "from-json": string;
  readonly json: boolean;
  readonly fields?: string[];
};

type AddResult = {
  dashboard: DashboardDetail;
  widget: DashboardWidget;
  url: string;
};

export const addCommand = buildCommand({
  docs: {
    brief: "Add a widget to a dashboard",
    fullDescription:
      "Add a widget to an existing Sentry dashboard.\n\n" +
      "The dashboard can be specified by numeric ID or title.\n" +
      "The widget definition is read from a JSON file.\n\n" +
      "Examples:\n" +
      "  sentry dashboard widget add 12345 --from-json widget.json\n" +
      "  sentry dashboard widget add 'My Dashboard' --from-json widget.json\n" +
      "  sentry dashboard widget add my-org/ 12345 --from-json widget.json",
  },
  output: {
    json: true,
    human: formatWidgetAdded,
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
    },
  },
  async func(this: SentryContext, flags: AddFlags, ...args: string[]) {
    const { cwd } = this;

    const { dashboardRef, targetArg } = parseDashboardPositionalArgs(args);
    const parsed = parseOrgProjectArg(targetArg);
    const orgSlug = await resolveOrgFromTarget(
      parsed,
      cwd,
      "sentry dashboard widget add <org>/ <id> --from-json <path>"
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
    const newWidget = widgetResult.data;

    // GET current dashboard → append widget with auto-layout → PUT
    const current = await getDashboard(orgSlug, dashboardId);
    const updateBody = prepareDashboardForUpdate(current);
    updateBody.widgets.push(assignDefaultLayout(newWidget, updateBody.widgets));

    const updated = await updateDashboard(orgSlug, dashboardId, updateBody);
    const url = buildDashboardUrl(orgSlug, dashboardId);

    return {
      data: { dashboard: updated, widget: newWidget, url } as AddResult,
    };
  },
});
