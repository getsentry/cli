/**
 * sentry dashboard view
 *
 * View details of a specific dashboard.
 */

import type { SentryContext } from "../../context.js";
import { getDashboard } from "../../lib/api-client.js";
import { openInBrowser } from "../../lib/browser.js";
import { buildCommand, numberParser } from "../../lib/command.js";
import { ContextError } from "../../lib/errors.js";
import { formatDashboardView } from "../../lib/formatters/human.js";
import { resolveOrg } from "../../lib/resolve-target.js";
import { buildDashboardUrl } from "../../lib/sentry-urls.js";
import type { DashboardDetail } from "../../types/dashboard.js";

type ViewFlags = {
  readonly org?: string;
  readonly web: boolean;
  readonly json: boolean;
  readonly fields?: string[];
};

type ViewResult = DashboardDetail & { url: string };

export const viewCommand = buildCommand({
  docs: {
    brief: "View a dashboard",
    fullDescription:
      "View details of a specific Sentry dashboard.\n\n" +
      "Examples:\n" +
      "  sentry dashboard view 12345\n" +
      "  sentry dashboard view 12345 --org my-org\n" +
      "  sentry dashboard view 12345 --json\n" +
      "  sentry dashboard view 12345 --web",
  },
  output: {
    json: true,
    human: formatDashboardView,
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
      web: {
        kind: "boolean",
        brief: "Open in browser",
        default: false,
      },
    },
    aliases: { o: "org", w: "web" },
  },
  async func(this: SentryContext, flags: ViewFlags, dashboardId: number) {
    const { cwd } = this;

    const resolved = await resolveOrg({ org: flags.org, cwd });
    if (!resolved) {
      throw new ContextError(
        "Organization",
        "sentry dashboard view <id> --org <org>"
      );
    }
    const { org: orgSlug } = resolved;

    const url = buildDashboardUrl(orgSlug, String(dashboardId));

    if (flags.web) {
      await openInBrowser(url, "dashboard");
      return;
    }

    const dashboard = await getDashboard(orgSlug, String(dashboardId));

    return {
      data: { ...dashboard, url } as ViewResult,
    };
  },
});
