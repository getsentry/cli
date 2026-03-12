/**
 * sentry dashboard list
 *
 * List dashboards in a Sentry organization.
 */

import type { SentryContext } from "../../context.js";
import { listDashboards } from "../../lib/api-client.js";
import { parseOrgProjectArg } from "../../lib/arg-parsing.js";
import { openInBrowser } from "../../lib/browser.js";
import { ContextError } from "../../lib/errors.js";
import { writeFooter, writeJson } from "../../lib/formatters/index.js";
import { escapeMarkdownCell } from "../../lib/formatters/markdown.js";
import { type Column, writeTable } from "../../lib/formatters/table.js";
import {
  buildListCommand,
  LIST_TARGET_POSITIONAL,
} from "../../lib/list-command.js";
import { resolveOrg } from "../../lib/resolve-target.js";
import { buildDashboardsListUrl } from "../../lib/sentry-urls.js";
import type { DashboardListItem } from "../../types/dashboard.js";

type ListFlags = {
  readonly web: boolean;
  readonly json: boolean;
  readonly fields?: string[];
};

/** Resolve org slug from parsed target argument */
async function resolveOrgFromTarget(
  parsed: ReturnType<typeof parseOrgProjectArg>,
  cwd: string
): Promise<string> {
  switch (parsed.type) {
    case "explicit":
    case "org-all":
      return parsed.org;
    case "project-search":
    case "auto-detect": {
      const resolved = await resolveOrg({ cwd });
      if (!resolved) {
        throw new ContextError("Organization", "sentry dashboard list <org>/");
      }
      return resolved.org;
    }
    default: {
      const _exhaustive: never = parsed;
      throw new Error(
        `Unexpected parsed type: ${(_exhaustive as { type: string }).type}`
      );
    }
  }
}

export const listCommand = buildListCommand("dashboard", {
  docs: {
    brief: "List dashboards",
    fullDescription:
      "List dashboards in a Sentry organization.\n\n" +
      "Examples:\n" +
      "  sentry dashboard list\n" +
      "  sentry dashboard list my-org/\n" +
      "  sentry dashboard list --json\n" +
      "  sentry dashboard list --web",
  },
  output: "json",
  parameters: {
    positional: LIST_TARGET_POSITIONAL,
    flags: {
      web: {
        kind: "boolean",
        brief: "Open in browser",
        default: false,
      },
    },
    aliases: { w: "web" },
  },
  async func(
    this: SentryContext,
    flags: ListFlags,
    target?: string
  ): Promise<void> {
    const { stdout, cwd } = this;

    const parsed = parseOrgProjectArg(target);
    const orgSlug = await resolveOrgFromTarget(parsed, cwd);

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
