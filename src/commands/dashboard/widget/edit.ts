/**
 * sentry dashboard widget edit
 *
 * Edit a widget in an existing dashboard.
 */

import type { SentryContext } from "../../../context.js";
import { getDashboard, updateDashboard } from "../../../lib/api-client.js";
import { buildCommand, numberParser } from "../../../lib/command.js";
import { ContextError, ValidationError } from "../../../lib/errors.js";
import { formatWidgetEdited } from "../../../lib/formatters/human.js";
import { resolveOrg } from "../../../lib/resolve-target.js";
import { buildDashboardUrl } from "../../../lib/sentry-urls.js";
import {
  type DashboardDetail,
  type DashboardWidget,
  DashboardWidgetSchema,
  prepareDashboardForUpdate,
} from "../../../types/dashboard.js";

type EditFlags = {
  readonly org?: string;
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

export const editCommand = buildCommand({
  docs: {
    brief: "Edit a widget in a dashboard",
    fullDescription:
      "Edit a widget in an existing Sentry dashboard.\n\n" +
      "Identify the widget by --index (0-based) or --title.\n\n" +
      "Examples:\n" +
      "  sentry dashboard widget edit 12345 --index 0 --from-json widget.json\n" +
      "  sentry dashboard widget edit 12345 --title 'Error Rate' --from-json widget.json",
  },
  output: {
    json: true,
    human: formatWidgetEdited,
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
    aliases: { o: "org", i: "index", t: "title" },
  },
  async func(this: SentryContext, flags: EditFlags, dashboardId: number) {
    const { cwd } = this;

    if (flags.index === undefined && !flags.title) {
      throw new ValidationError(
        "Specify --index or --title to identify the widget to edit.",
        "index"
      );
    }

    const resolved = await resolveOrg({ org: flags.org, cwd });
    if (!resolved) {
      throw new ContextError(
        "Organization",
        "sentry dashboard widget edit <id> --from-json <path> --org <org>"
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
    const replacement = widgetResult.data;

    // GET current dashboard → find widget → replace → PUT
    const current = await getDashboard(orgSlug, String(dashboardId));
    const widgets = current.widgets ?? [];

    let widgetIndex: number;
    if (flags.index !== undefined) {
      if (flags.index < 0 || flags.index >= widgets.length) {
        throw new ValidationError(
          `Widget index ${flags.index} out of range (dashboard has ${widgets.length} widgets).`,
          "index"
        );
      }
      widgetIndex = flags.index;
    } else {
      // Find by title
      const matchIndex = widgets.findIndex((w) => w.title === flags.title);
      if (matchIndex === -1) {
        throw new ValidationError(
          `No widget with title '${flags.title}' found in dashboard.`,
          "title"
        );
      }
      widgetIndex = matchIndex;
    }

    const updateBody = prepareDashboardForUpdate(current);
    updateBody.widgets[widgetIndex] = replacement;

    const updated = await updateDashboard(
      orgSlug,
      String(dashboardId),
      updateBody
    );
    const url = buildDashboardUrl(orgSlug, String(dashboardId));

    return {
      data: { dashboard: updated, widget: replacement, url } as EditResult,
    };
  },
});
