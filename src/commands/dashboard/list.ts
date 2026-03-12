/**
 * sentry dashboard list
 *
 * List dashboards in a Sentry organization.
 */

import type { SentryContext } from "../../context.js";
import { listDashboards } from "../../lib/api-client.js";
import { openInBrowser } from "../../lib/browser.js";
import { buildCommand } from "../../lib/command.js";
import { ContextError } from "../../lib/errors.js";
import { writeFooter, writeJson } from "../../lib/formatters/index.js";
import { escapeMarkdownCell } from "../../lib/formatters/markdown.js";
import { type Column, writeTable } from "../../lib/formatters/table.js";
import { resolveOrg } from "../../lib/resolve-target.js";
import { buildDashboardsListUrl } from "../../lib/sentry-urls.js";
import type { DashboardListItem } from "../../types/dashboard.js";

type ListFlags = {
  readonly org?: string;
  readonly web: boolean;
  readonly json: boolean;
  readonly fields?: string[];
};

export const listCommand = buildCommand({
  docs: {
    brief: "List dashboards",
    fullDescription:
      "List dashboards in a Sentry organization.\n\n" +
      "Examples:\n" +
      "  sentry dashboard list\n" +
      "  sentry dashboard list --org my-org\n" +
      "  sentry dashboard list --json\n" +
      "  sentry dashboard list --web",
  },
  output: "json",
  parameters: {
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
  async func(this: SentryContext, flags: ListFlags): Promise<void> {
    const { stdout, cwd } = this;

    const resolved = await resolveOrg({ org: flags.org, cwd });
    if (!resolved) {
      throw new ContextError(
        "Organization",
        "sentry dashboard list --org <org>"
      );
    }
    const { org: orgSlug } = resolved;

    if (flags.web) {
      await openInBrowser(buildDashboardsListUrl(orgSlug), "dashboards");
      return;
    }

    const dashboards = await listDashboards(orgSlug);

    if (flags.json) {
      writeJson(stdout, dashboards, flags.fields);
      return;
    }

    if (dashboards.length === 0) {
      stdout.write("No dashboards found.\n");
      return;
    }

    type DashboardRow = {
      id: string;
      title: string;
      widgets: string;
    };

    const rows: DashboardRow[] = dashboards.map((d: DashboardListItem) => ({
      id: d.id,
      title: escapeMarkdownCell(d.title),
      widgets: String(d.widgetDisplay?.length ?? 0),
    }));

    const columns: Column<DashboardRow>[] = [
      { header: "ID", value: (r) => r.id },
      { header: "TITLE", value: (r) => r.title },
      { header: "WIDGETS", value: (r) => r.widgets },
    ];

    writeTable(stdout, rows, columns);

    const url = buildDashboardsListUrl(orgSlug);
    writeFooter(stdout, `Dashboards: ${url}`);
  },
});
