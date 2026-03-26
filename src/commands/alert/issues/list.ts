/**
 * sentry alert issues list
 *
 * List issue alert rules for one or more Sentry projects.
 *
 * Issue alerts are project-scoped. Supports all four target modes:
 * - auto-detect  → DSN detection / config defaults (may resolve multiple projects)
 * - explicit     → single org/project
 * - org-all      → all projects in an org (all their alert rules combined)
 * - project-search → find project by slug across all orgs
 */

import type { SentryContext } from "../../../context.js";
import type { IssueAlertRule } from "../../../lib/api/alerts.js";
import { MAX_PAGINATION_PAGES } from "../../../lib/api/infrastructure.js";
import {
  API_MAX_PER_PAGE,
  listIssueAlertsPaginated,
} from "../../../lib/api-client.js";
import { parseOrgProjectArg } from "../../../lib/arg-parsing.js";
import { openInBrowser } from "../../../lib/browser.js";
import { ContextError } from "../../../lib/errors.js";
import { filterFields } from "../../../lib/formatters/json.js";
import {
  colorTag,
  escapeMarkdownCell,
} from "../../../lib/formatters/markdown.js";
import { CommandOutput } from "../../../lib/formatters/output.js";
import { type Column, writeTable } from "../../../lib/formatters/table.js";
import {
  buildListCommand,
  buildListLimitFlag,
  targetPatternExplanation,
} from "../../../lib/list-command.js";
import {
  dispatchOrgScopedList,
  type ListCommandMeta,
  type ListResult,
} from "../../../lib/org-list.js";
import { withProgress } from "../../../lib/polling.js";
import {
  type ResolvedTarget,
  resolveTargetsFromParsedArg,
} from "../../../lib/resolve-target.js";
import { buildIssueAlertsUrl } from "../../../lib/sentry-urls.js";
import type { Writer } from "../../../types/index.js";

/** Command key for pagination cursor storage */
export const PAGINATION_KEY = "alert-issues-list";

const USAGE_HINT = "sentry alert issues list <org>/<project>";

type ListFlags = {
  readonly web: boolean;
  readonly fresh: boolean;
  readonly limit: number;
  readonly cursor?: string;
  readonly json: boolean;
  readonly fields?: string[];
};

type AlertRuleWithTarget = {
  rule: IssueAlertRule;
  target: ResolvedTarget;
};

const issueAlertListMeta: ListCommandMeta = {
  paginationKey: PAGINATION_KEY,
  entityName: "issue alert rule",
  entityPlural: "issue alert rules",
  commandPrefix: "sentry alert issues list",
};

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------

/**
 * Fetch all issue alert rules for one project (up to limit), across multiple pages.
 */
async function fetchIssueRulesForTarget(
  target: ResolvedTarget,
  limit: number
): Promise<IssueAlertRule[]> {
  const rules: IssueAlertRule[] = [];
  let serverCursor: string | undefined;

  for (let page = 0; page < MAX_PAGINATION_PAGES; page++) {
    const { data, nextCursor } = await listIssueAlertsPaginated(
      target.org,
      target.project,
      {
        perPage: Math.min(limit - rules.length, API_MAX_PER_PAGE),
        cursor: serverCursor,
      }
    );

    for (const rule of data) {
      rules.push(rule);
      if (rules.length >= limit) {
        return rules;
      }
    }

    if (!nextCursor) {
      break;
    }
    serverCursor = nextCursor;
  }

  return rules;
}

/**
 * Fetch issue alert rules from multiple targets in parallel and combine.
 * Used by auto-detect, org-all, and project-search modes.
 */
async function fetchFromTargets(
  targets: ResolvedTarget[],
  limit: number,
  json: boolean
): Promise<AlertRuleWithTarget[]> {
  const perTargetLimit = Math.max(limit, Math.ceil(limit / targets.length) * 2);
  const results = await withProgress(
    {
      message:
        targets.length > 1
          ? `Fetching issue alert rules from ${targets.length} projects...`
          : `Fetching issue alert rules for ${targets[0]?.org}/${targets[0]?.project}...`,
      json,
    },
    () =>
      Promise.all(
        targets.map(async (target) => {
          const rules = await fetchIssueRulesForTarget(target, perTargetLimit);
          return rules.map((rule) => ({ rule, target }));
        })
      )
  );
  return results.flat().slice(0, limit);
}

// ---------------------------------------------------------------------------
// Mode handlers
// ---------------------------------------------------------------------------

async function handleAutoDetectIssueAlerts(
  cwd: string,
  flags: ListFlags
): Promise<ListResult<AlertRuleWithTarget>> {
  const { targets, footer } = await withProgress(
    { message: "Resolving targets...", json: flags.json },
    () =>
      resolveTargetsFromParsedArg(
        { type: "auto-detect" },
        { cwd, usageHint: USAGE_HINT }
      )
  );
  if (targets.length === 0) {
    throw new ContextError("Organization and project", USAGE_HINT);
  }
  const items = await fetchFromTargets(targets, flags.limit, flags.json);
  return { items, hasMore: false, hint: footer };
}

async function handleExplicitIssueAlerts(
  org: string,
  project: string,
  flags: ListFlags
): Promise<ListResult<AlertRuleWithTarget>> {
  const target: ResolvedTarget = {
    org,
    project,
    orgDisplay: org,
    projectDisplay: project,
  };
  const rules = await withProgress(
    {
      message: `Fetching issue alert rules for ${org}/${project}...`,
      json: flags.json,
    },
    () => fetchIssueRulesForTarget(target, flags.limit)
  );
  return {
    items: rules.map((rule) => ({ rule, target })),
    hasMore: false,
    hint: `Alert rules: ${buildIssueAlertsUrl(org, project)}`,
  };
}

async function handleOrgAllIssueAlerts(
  org: string,
  flags: ListFlags
): Promise<ListResult<AlertRuleWithTarget>> {
  // org-all: list all projects in the org, then fetch alerts for each
  const { targets } = await withProgress(
    { message: `Listing projects in ${org}...`, json: flags.json },
    () =>
      resolveTargetsFromParsedArg(
        { type: "org-all", org },
        { cwd: "", usageHint: USAGE_HINT }
      )
  );
  const items = await fetchFromTargets(targets, flags.limit, flags.json);
  return {
    items,
    hasMore: false,
    hint:
      targets.length > 1
        ? `Showing alert rules from ${targets.length} projects in ${org}.`
        : undefined,
  };
}

async function handleProjectSearchIssueAlerts(
  projectSlug: string,
  cwd: string,
  flags: ListFlags
): Promise<ListResult<AlertRuleWithTarget>> {
  const { targets } = await withProgress(
    { message: `Searching for project '${projectSlug}'...`, json: flags.json },
    () =>
      resolveTargetsFromParsedArg(
        { type: "project-search", projectSlug },
        { cwd, usageHint: USAGE_HINT }
      )
  );
  const items = await fetchFromTargets(targets, flags.limit, flags.json);
  return { items, hasMore: false };
}

// ---------------------------------------------------------------------------
// Human output
// ---------------------------------------------------------------------------

function formatIssueAlertListHuman(
  result: ListResult<AlertRuleWithTarget>
): string {
  if (result.items.length === 0) {
    return result.hint ?? "No issue alert rules found.";
  }

  const uniqueProjects = new Set(
    result.items.map((r) => `${r.target.org}/${r.target.project}`)
  );
  const isMultiProject = uniqueProjects.size > 1;

  type Row = {
    id: string;
    name: string;
    project?: string;
    conditions: string;
    actions: string;
    environment: string;
    status: string;
  };

  const rows: Row[] = result.items.map(({ rule: r, target }) => ({
    id: r.id,
    name: escapeMarkdownCell(r.name),
    ...(isMultiProject && {
      project: `${target.org}/${target.project}`,
    }),
    conditions: String(r.conditions.length),
    actions: String(r.actions.length),
    environment: r.environment ?? "all",
    status:
      r.status === "active"
        ? colorTag("green", "active")
        : colorTag("muted", r.status),
  }));

  const columns: Column<Row>[] = [
    { header: "ID", value: (r) => r.id },
    { header: "NAME", value: (r) => r.name },
    ...(isMultiProject
      ? [{ header: "PROJECT", value: (r: Row) => r.project ?? "" }]
      : []),
    { header: "CONDITIONS", value: (r) => r.conditions },
    { header: "ACTIONS", value: (r) => r.actions },
    { header: "ENVIRONMENT", value: (r) => r.environment },
    { header: "STATUS", value: (r) => r.status },
  ];

  const parts: string[] = [];
  const buffer: Writer = { write: (s) => parts.push(s) };
  writeTable(buffer, rows, columns);

  return parts.join("").trimEnd();
}

// ---------------------------------------------------------------------------
// JSON transform
// ---------------------------------------------------------------------------

function jsonTransformIssueAlertList(
  result: ListResult<AlertRuleWithTarget>,
  fields?: string[]
): unknown {
  const rules = result.items.map(({ rule }) => rule);
  const items =
    fields && fields.length > 0
      ? rules.map((r) => filterFields(r, fields))
      : rules;

  const envelope: Record<string, unknown> = {
    data: items,
    hasMore: !!result.hasMore,
    hasPrev: !!result.hasPrev,
  };
  if (result.nextCursor) {
    envelope.nextCursor = result.nextCursor;
  }
  return envelope;
}

// ---------------------------------------------------------------------------
// Command
// ---------------------------------------------------------------------------

export const listCommand = buildListCommand("alert", {
  docs: {
    brief: "List issue alert rules",
    fullDescription:
      "List issue alert rules for one or more Sentry projects.\n\n" +
      "Issue alerts trigger notifications when error events match conditions.\n\n" +
      "Target patterns:\n" +
      "  sentry alert issues list                     # auto-detect from DSN or config\n" +
      "  sentry alert issues list <org>/<project>     # explicit org and project\n" +
      "  sentry alert issues list <org>/              # all projects in org\n" +
      "  sentry alert issues list <project>           # find project across all orgs\n\n" +
      `${targetPatternExplanation()}\n\n` +
      "In monorepos with multiple Sentry projects, shows alert rules from all detected projects.",
  },
  output: {
    human: formatIssueAlertListHuman,
    jsonTransform: jsonTransformIssueAlertList,
  },
  parameters: {
    positional: {
      kind: "tuple",
      parameters: [
        {
          placeholder: "org/project",
          brief:
            "<org>/<project>, <org>/ (all), <project> (search), or omit to auto-detect",
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
      limit: buildListLimitFlag("issue alert rules"),
    },
    aliases: { w: "web", n: "limit" },
  },
  async *func(this: SentryContext, flags: ListFlags, target?: string) {
    const { cwd } = this;
    const parsed = parseOrgProjectArg(target);

    // --web: open browser when org and project are known from the target arg
    if (flags.web && parsed.type === "explicit") {
      await openInBrowser(
        buildIssueAlertsUrl(parsed.org, parsed.project),
        "issue alert rules"
      );
      return;
    }

    const result = (await dispatchOrgScopedList({
      config: issueAlertListMeta,
      cwd,
      flags,
      parsed,
      orgSlugMatchBehavior: "redirect",
      overrides: {
        "auto-detect": (ctx) => handleAutoDetectIssueAlerts(ctx.cwd, flags),
        explicit: (ctx) =>
          handleExplicitIssueAlerts(ctx.parsed.org, ctx.parsed.project, flags),
        "org-all": (ctx) => handleOrgAllIssueAlerts(ctx.parsed.org, flags),
        "project-search": (ctx) =>
          handleProjectSearchIssueAlerts(
            ctx.parsed.projectSlug,
            ctx.cwd,
            flags
          ),
      },
    })) as ListResult<AlertRuleWithTarget>;

    yield new CommandOutput(result);
    return { hint: result.hint };
  },
});
