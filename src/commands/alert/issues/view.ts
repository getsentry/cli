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

function parseIssueViewArg(arg: string): {
  ref: string;
  targetArg: string | undefined;
} {
  if (!arg.includes("/")) {
    return { ref: arg.trim(), targetArg: undefined };
  }

  const slash = arg.lastIndexOf("/");
  const targetPart = arg.slice(0, slash).trim();
  const ref = arg.slice(slash + 1).trim();
  if (!ref) {
    throw new ValidationError(
      `Invalid rule reference '${arg}'.\nUse: ${USAGE_HINT}`
    );
  }
  return { ref, targetArg: targetPart || undefined };
}

async function findRuleByName(
  target: ResolvedTarget,
  ref: string
): Promise<IssueAlertRule | null> {
  const all: IssueAlertRule[] = [];
  let cursor: string | undefined;

  for (let page = 0; page < MAX_PAGINATION_PAGES; page++) {
    const { data, nextCursor } = await listIssueAlertsPaginated(
      target.org,
      target.project,
      { perPage: API_MAX_PER_PAGE, cursor }
    );
    all.push(...data);

    const exact = data.find(
      (rule) => rule.name.toLowerCase() === ref.toLowerCase()
    );
    if (exact) {
      return exact;
    }

    if (!nextCursor) {
      break;
    }
    cursor = nextCursor;
  }

  if (all.length === 0) {
    return null;
  }

  const names = all.map((rule) => rule.name);
  const [match] = fuzzyMatch(ref, names, { maxResults: 1 });
  if (!match) {
    return null;
  }
  return all.find((rule) => rule.name === match) ?? null;
}

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
      } catch {
        // Best effort across targets.
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
  for (const target of targets) {
    const rule = await findRuleByName(target, ref);
    if (rule) {
      hits.push({ target, rule });
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
