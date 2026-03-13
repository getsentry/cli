/**
 * sentry dashboard list
 *
 * List dashboards in a Sentry organization.
 */

import type { SentryContext } from "../../context.js";
import { listDashboards } from "../../lib/api-client.js";
import { parseOrgProjectArg } from "../../lib/arg-parsing.js";
import { openInBrowser } from "../../lib/browser.js";
import { buildCommand } from "../../lib/command.js";
import { escapeMarkdownCell } from "../../lib/formatters/markdown.js";
import { type Column, writeTable } from "../../lib/formatters/table.js";
import {
  applyFreshFlag,
  FRESH_ALIASES,
  FRESH_FLAG,
} from "../../lib/list-command.js";
import { buildDashboardsListUrl } from "../../lib/sentry-urls.js";
import type { DashboardListItem } from "../../types/dashboard.js";
import type { Writer } from "../../types/index.js";
import { resolveOrgFromTarget } from "./resolve.js";

type ListFlags = {
  readonly web: boolean;
  readonly fresh: boolean;
  readonly json: boolean;
  readonly fields?: string[];
};

/**
 * Format dashboard list for human-readable terminal output.
 *
 * Renders a table with ID, title, and widget count columns.
 * Returns "No dashboards found." for empty results.
 */
function formatDashboardListHuman(dashboards: DashboardListItem[]): string {
  if (dashboards.length === 0) {
    return "No dashboards found.";
  }

  type DashboardRow = {
    id: string;
    title: string;
    widgets: string;
  };

  const rows: DashboardRow[] = dashboards.map((d) => ({
    id: d.id,
    title: escapeMarkdownCell(d.title),
    widgets: String(d.widgetDisplay?.length ?? 0),
  }));

  const columns: Column<DashboardRow>[] = [
    { header: "ID", value: (r) => r.id },
    { header: "TITLE", value: (r) => r.title },
    { header: "WIDGETS", value: (r) => r.widgets },
  ];

  const parts: string[] = [];
  const buffer: Writer = { write: (s) => parts.push(s) };
  writeTable(buffer, rows, columns);

  return parts.join("").trimEnd();
}

export const listCommand = buildCommand({
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
  output: { json: true, human: formatDashboardListHuman },
  parameters: {
    positional: {
      kind: "tuple",
      parameters: [
        {
          placeholder: "org/project",
          brief:
            "<org>/ (all projects), <org>/<project>, or <project> (search)",
          parse: String,
          optional: true,
        },
      ],
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
  async func(this: SentryContext, flags: ListFlags, target?: string) {
    applyFreshFlag(flags);
    const { cwd } = this;

    const parsed = parseOrgProjectArg(target);
    const orgSlug = await resolveOrgFromTarget(
      parsed,
      cwd,
      "sentry dashboard list <org>/"
    );

    if (flags.web) {
      await openInBrowser(buildDashboardsListUrl(orgSlug), "dashboards");
      return;
    }

    const dashboards = await listDashboards(orgSlug);
    const url = buildDashboardsListUrl(orgSlug);

    return {
      data: dashboards,
      hint: dashboards.length > 0 ? `Dashboards: ${url}` : undefined,
    };
  },
});
