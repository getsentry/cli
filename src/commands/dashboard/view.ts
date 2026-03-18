/**
 * sentry dashboard view
 *
 * View details of a specific dashboard.
 */

import type { SentryContext } from "../../context.js";
import { getDashboard } from "../../lib/api-client.js";
import { parseOrgProjectArg } from "../../lib/arg-parsing.js";
import { openInBrowser } from "../../lib/browser.js";
import { buildCommand } from "../../lib/command.js";
import { formatDashboardView } from "../../lib/formatters/human.js";
import { CommandOutput } from "../../lib/formatters/output.js";
import {
  applyFreshFlag,
  FRESH_ALIASES,
  FRESH_FLAG,
} from "../../lib/list-command.js";
import { withProgress } from "../../lib/polling.js";
import { buildDashboardUrl } from "../../lib/sentry-urls.js";
import type { DashboardDetail } from "../../types/dashboard.js";
import {
  parseDashboardPositionalArgs,
  resolveDashboardId,
  resolveOrgFromTarget,
} from "./resolve.js";

type ViewFlags = {
  readonly web: boolean;
  readonly fresh: boolean;
  readonly json: boolean;
  readonly fields?: string[];
};

type ViewResult = DashboardDetail & { url: string };

export const viewCommand = buildCommand({
  docs: {
    brief: "View a dashboard",
    fullDescription:
      "View details of a specific Sentry dashboard.\n\n" +
      "The dashboard can be specified by numeric ID or title.\n\n" +
      "Examples:\n" +
      "  sentry dashboard view 12345\n" +
      "  sentry dashboard view 'My Dashboard'\n" +
      "  sentry dashboard view my-org/ 12345\n" +
      "  sentry dashboard view 12345 --json\n" +
      "  sentry dashboard view 12345 --web",
  },
  output: {
    human: formatDashboardView,
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
      web: {
        kind: "boolean",
        brief: "Open in browser",
        default: false,
      },
      fresh: FRESH_FLAG,
    },
    aliases: { ...FRESH_ALIASES, w: "web" },
  },
  async *func(this: SentryContext, flags: ViewFlags, ...args: string[]) {
    applyFreshFlag(flags);
    const { cwd } = this;

    const { dashboardRef, targetArg } = parseDashboardPositionalArgs(args);
    const parsed = parseOrgProjectArg(targetArg);
    const orgSlug = await resolveOrgFromTarget(
      parsed,
      cwd,
      "sentry dashboard view <org>/ <id>"
    );
    const dashboardId = await resolveDashboardId(orgSlug, dashboardRef);

    const url = buildDashboardUrl(orgSlug, dashboardId);

    if (flags.web) {
      await openInBrowser(url, "dashboard");
      return;
    }

    const dashboard = await withProgress(
      { message: "Fetching dashboard..." },
      () => getDashboard(orgSlug, dashboardId)
    );

    yield new CommandOutput({ ...dashboard, url } as ViewResult);
    return { hint: `Dashboard: ${url}` };
  },
});
