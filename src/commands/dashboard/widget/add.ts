/**
 * sentry dashboard widget add
 *
 * Add a widget to an existing dashboard.
 */

import type { SentryContext } from "../../../context.js";
import { getDashboard, updateDashboard } from "../../../lib/api-client.js";
import { buildCommand, numberParser } from "../../../lib/command.js";
import { ContextError, ValidationError } from "../../../lib/errors.js";
import { formatWidgetAdded } from "../../../lib/formatters/human.js";
import { resolveOrg } from "../../../lib/resolve-target.js";
import { buildDashboardUrl } from "../../../lib/sentry-urls.js";
import {
  type DashboardDetail,
  type DashboardWidget,
  DashboardWidgetSchema,
  prepareDashboardForUpdate,
} from "../../../types/dashboard.js";

type AddFlags = {
  readonly org?: string;
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
      "The widget definition is read from a JSON file.\n\n" +
      "Examples:\n" +
      "  sentry dashboard widget add 12345 --from-json widget.json\n" +
      "  sentry dashboard widget add 12345 --from-json widget.json --org my-org",
  },
  output: {
    json: true,
    human: formatWidgetAdded,
  },
  parameters: {
    positional: {
      kind: "tuple",
      parameters: [
        {
          brief: "Dashboard ID",
          parse: numberParser,
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
      "from-json": {
        kind: "parsed",
        parse: String,
        brief: "Path to JSON file containing widget definition",
      },
    },
    aliases: { o: "org" },
  },
  async func(this: SentryContext, flags: AddFlags, dashboardId: number) {
    const { cwd } = this;

    const resolved = await resolveOrg({ org: flags.org, cwd });
    if (!resolved) {
      throw new ContextError(
        "Organization",
        "sentry dashboard widget add <id> --from-json <path> --org <org>"
      );
    }
    const { org: orgSlug } = resolved;

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
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new ValidationError(
        `Invalid JSON in widget file: ${jsonPath}`,
        "from-json"
      );
    }

    const widgetResult = DashboardWidgetSchema.safeParse(parsed);
    if (!widgetResult.success) {
      throw new ValidationError(
        `Invalid widget definition: ${widgetResult.error.message}`,
        "from-json"
      );
    }
    const newWidget = widgetResult.data;

    // GET current dashboard → append widget → PUT
    const current = await getDashboard(orgSlug, String(dashboardId));
    const updateBody = prepareDashboardForUpdate(current);
    updateBody.widgets.push(newWidget);

    const updated = await updateDashboard(
      orgSlug,
      String(dashboardId),
      updateBody
    );
    const url = buildDashboardUrl(orgSlug, String(dashboardId));

    return {
      data: { dashboard: updated, widget: newWidget, url } as AddResult,
    };
  },
});
