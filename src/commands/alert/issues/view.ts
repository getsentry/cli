import type { SentryContext } from "../../../context.js";
import { MAX_PAGINATION_PAGES } from "../../../lib/api/infrastructure.js";
import {
  API_MAX_PER_PAGE,
  getIssueAlertRule,
  type IssueAlertRule,
  listIssueAlertsPaginated,
} from "../../../lib/api-client.js";
import { parseOrgProjectArg } from "../../../lib/arg-parsing.js";
import { openInBrowser } from "../../../lib/browser.js";
import { buildCommand } from "../../../lib/command.js";
import {
  ApiError,
  ContextError,
  ResolutionError,
  ValidationError,
} from "../../../lib/errors.js";
import { CommandOutput } from "../../../lib/formatters/output.js";
import { fuzzyMatch } from "../../../lib/fuzzy.js";
import {
  type ResolvedTarget,
  resolveTargetsFromParsedArg,
} from "../../../lib/resolve-target.js";
import { buildIssueAlertsUrl } from "../../../lib/sentry-urls.js";
import { isAllDigits } from "../../../lib/utils.js";

const USAGE_HINT = "sentry alert issues view <org>/<project>/<rule-id-or-name>";

type ViewFlags = {
  readonly web: boolean;
  readonly json: boolean;
  readonly fields?: string[];
};

type IssueAlertViewResult = {
  target: ResolvedTarget;
  rule: IssueAlertRule;
};

/**
 * Parse `org/project/<rule-id-or-name>` (two+ slashes) or a bare `rule-id-or-name` (no slashes).
 * A single `org/project` (exactly one slash) is invalid — the rule id or name is required.
 */
function parseIssueViewArg(arg: string): {
  ref: string;
  targetArg: string | undefined;
} {
  const trimmed = arg.trim();
  if (!trimmed) {
    throw new ValidationError(
      `Rule id or name is required.\nUse: ${USAGE_HINT}`,
      "rule"
    );
  }

  const slashCount = [...trimmed].filter((c) => c === "/").length;
  if (slashCount === 0) {
    return { ref: trimmed, targetArg: undefined };
  }
  if (slashCount === 1) {
    throw new ValidationError(
      `Missing rule id or name after the project (got '${trimmed}').\n` +
        `Use: ${USAGE_HINT}\n` +
        `Example: ${trimmed}/<rule-id-or-name>`,
      "rule"
    );
  }

  const lastSlash = trimmed.lastIndexOf("/");
  const targetPart = trimmed.slice(0, lastSlash).trim();
  const ref = trimmed.slice(lastSlash + 1).trim();
  if (!ref) {
    throw new ValidationError(
      `Invalid rule reference '${arg}'.\nUse: ${USAGE_HINT}`,
      "rule"
    );
  }
  return { ref, targetArg: targetPart || undefined };
}

/** List all issue alert rules for a project (paginated). */
async function listAllIssueRulesForTarget(
  target: ResolvedTarget
): Promise<IssueAlertRule[]> {
  const all: IssueAlertRule[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGINATION_PAGES; page++) {
    const { data, nextCursor } = await listIssueAlertsPaginated(
      target.org,
      target.project,
      { perPage: API_MAX_PER_PAGE, cursor }
    );
    all.push(...data);
    if (!nextCursor) {
      break;
    }
    cursor = nextCursor;
  }
  return all;
}

function isNotFoundApiError(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: per-target list + name resolution + disambiguation (same as metrics view)
async function resolveIssueAlertRule(
  targets: ResolvedTarget[],
  ref: string
): Promise<IssueAlertViewResult> {
  if (isAllDigits(ref)) {
    const hits: IssueAlertViewResult[] = [];
    for (const target of targets) {
      try {
        const rule = await getIssueAlertRule(target.org, target.project, ref);
        hits.push({ target, rule });
      } catch (e) {
        if (isNotFoundApiError(e)) {
          continue;
        }
        throw e;
      }
    }

    if (hits.length === 1) {
      return hits[0] as IssueAlertViewResult;
    }
    if (hits.length > 1) {
      throw new ValidationError(
        `Alert rule ID '${ref}' matched multiple projects.\n` +
          "Use an explicit target: sentry alert issues view <org>/<project>/<rule-id>"
      );
    }
    throw new ResolutionError(
      `Issue alert rule '${ref}'`,
      "not found",
      USAGE_HINT
    );
  }

  const hits: IssueAlertViewResult[] = [];
  const allRuleNames: string[] = [];

  for (const target of targets) {
    const rules = await listAllIssueRulesForTarget(target);
    for (const r of rules) {
      allRuleNames.push(r.name);
    }
    const exact = rules.find(
      (rule) => rule.name.toLowerCase() === ref.toLowerCase()
    );
    if (exact) {
      hits.push({ target, rule: exact });
    }
  }

  if (hits.length === 1) {
    return hits[0] as IssueAlertViewResult;
  }
  if (hits.length > 1) {
    throw new ValidationError(
      `Alert rule name '${ref}' matched multiple projects.\n` +
        "Use an explicit target: sentry alert issues view <org>/<project>/<rule-id-or-name>"
    );
  }

  const uniqueNames = [...new Set(allRuleNames)];
  const similar = fuzzyMatch(ref, uniqueNames, { maxResults: 5 });
  if (similar.length > 0) {
    const lines = similar.map((n) => `  ${n}`).join("\n");
    throw new ValidationError(
      `No issue alert rule named '${ref}' in the selected project(s).\n\n` +
        `Did you mean:\n${lines}`,
      "rule"
    );
  }

  throw new ResolutionError(
    `Issue alert rule '${ref}'`,
    "not found",
    USAGE_HINT
  );
}

function formatIssueAlertView(data: IssueAlertViewResult): string {
  const { target, rule } = data;
  return [
    `Issue alert rule in ${target.org}/${target.project}:`,
    "",
    `ID:           ${rule.id}`,
    `Name:         ${rule.name}`,
    `Status:       ${rule.status}`,
    `Action Match: ${rule.actionMatch}`,
    `Frequency:    ${rule.frequency}m`,
    `Conditions:   ${rule.conditions.length}`,
    `Actions:      ${rule.actions.length}`,
    `Environment:  ${rule.environment ?? "all"}`,
    `Owner:        ${rule.owner ?? "none"}`,
  ].join("\n");
}

export const viewCommand = buildCommand({
  docs: {
    brief: "View an issue alert rule",
    fullDescription:
      "View a single issue alert rule by ID or name.\n\n" +
      "Examples:\n" +
      "  sentry alert issues view 12345\n" +
      "  sentry alert issues view my-org/my-project/12345\n" +
      "  sentry alert issues view my-org/my-project/'Error Spike'",
  },
  output: {
    human: formatIssueAlertView,
    jsonTransform: (data: IssueAlertViewResult) => ({
      ...data.rule,
      org: data.target.org,
      project: data.target.project,
    }),
  },
  parameters: {
    positional: {
      kind: "tuple",
      parameters: [
        {
          placeholder: "org/project/rule-id-or-name",
          brief: "Issue alert rule ID or name",
          parse: String,
        },
      ],
    },
    flags: {
      web: {
        kind: "boolean",
        brief: "Open issue alert rules page in browser",
        default: false,
      },
    },
    aliases: { w: "web" },
  },
  async *func(this: SentryContext, flags: ViewFlags, arg: string) {
    const { cwd } = this;
    const { ref, targetArg } = parseIssueViewArg(arg);
    const parsed = parseOrgProjectArg(targetArg);

    const { targets } = await resolveTargetsFromParsedArg(parsed, {
      cwd,
      usageHint: "sentry alert issues view <org>/<project>/<rule-id-or-name>",
    });
    if (targets.length === 0) {
      throw new ContextError("Organization and project", USAGE_HINT);
    }

    const result = await resolveIssueAlertRule(targets, ref);

    if (flags.web) {
      await openInBrowser(
        buildIssueAlertsUrl(result.target.org, result.target.project),
        "issue alert rules"
      );
      return;
    }

    yield new CommandOutput(result);
  },
});
