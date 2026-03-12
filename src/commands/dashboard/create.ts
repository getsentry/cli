/**
 * sentry dashboard create
 *
 * Create a new dashboard in a Sentry organization.
 */

import type { SentryContext } from "../../context.js";
import { createDashboard } from "../../lib/api-client.js";
import { buildCommand } from "../../lib/command.js";
import { ContextError, ValidationError } from "../../lib/errors.js";
import { formatDashboardCreated } from "../../lib/formatters/human.js";
import { resolveOrg } from "../../lib/resolve-target.js";
import { buildDashboardUrl } from "../../lib/sentry-urls.js";
import {
  type DashboardDetail,
  type DashboardWidget,
  DashboardWidgetSchema,
} from "../../types/dashboard.js";

type CreateFlags = {
  readonly org?: string;
  readonly "widget-json"?: string;
  readonly json: boolean;
  readonly fields?: string[];
};

type CreateResult = DashboardDetail & { url: string };

export const createCommand = buildCommand({
  docs: {
    brief: "Create a dashboard",
    fullDescription:
      "Create a new Sentry dashboard.\n\n" +
      "Examples:\n" +
      "  sentry dashboard create 'My Dashboard'\n" +
      "  sentry dashboard create 'My Dashboard' --org my-org\n" +
      "  sentry dashboard create 'My Dashboard' --widget-json widgets.json",
  },
  output: {
    json: true,
    human: formatDashboardCreated,
  },
  parameters: {
    positional: {
      kind: "tuple",
      parameters: [
        {
          brief: "Dashboard title",
          parse: String,
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
      "widget-json": {
        kind: "parsed",
        parse: String,
        brief: "Path to JSON file containing widget definitions",
        optional: true,
      },
    },
    aliases: { o: "org" },
  },
  async func(this: SentryContext, flags: CreateFlags, title: string) {
    const { cwd } = this;

    const resolved = await resolveOrg({ org: flags.org, cwd });
    if (!resolved) {
      throw new ContextError(
        "Organization",
        "sentry dashboard create <title> --org <org>"
      );
    }
    const { org: orgSlug } = resolved;

    const widgets: DashboardWidget[] = [];
    const widgetJsonPath = flags["widget-json"];
    if (widgetJsonPath) {
      const file = Bun.file(widgetJsonPath);
      if (!(await file.exists())) {
        throw new ValidationError(
          `Widget JSON file not found: ${widgetJsonPath}`,
          "widget-json"
        );
      }
      const raw = await file.text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new ValidationError(
          `Invalid JSON in widget file: ${widgetJsonPath}`,
          "widget-json"
        );
      }

      const arr = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of arr) {
        const result = DashboardWidgetSchema.safeParse(item);
        if (!result.success) {
          throw new ValidationError(
            `Invalid widget definition: ${result.error.message}`,
            "widget-json"
          );
        }
        widgets.push(result.data);
      }
    }

    const dashboard = await createDashboard(orgSlug, { title, widgets });
    const url = buildDashboardUrl(orgSlug, dashboard.id);

    return {
      data: { ...dashboard, url } as CreateResult,
    };
  },
});
