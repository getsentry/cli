import type { SentryContext } from "../../../context.js";
import { MAX_PAGINATION_PAGES } from "../../../lib/api/infrastructure.js";
import {
  API_MAX_PER_PAGE,
  getMetricAlertRule,
  listMetricAlertsPaginated,
  type MetricAlertRule,
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
import { resolveTargetsFromParsedArg } from "../../../lib/resolve-target.js";
import { buildMetricAlertsUrl } from "../../../lib/sentry-urls.js";
import { isAllDigits } from "../../../lib/utils.js";

const USAGE_HINT = "sentry alert metrics view <org>/<rule-id-or-name>";

type ViewFlags = {
  readonly web: boolean;
  readonly json: boolean;
  readonly fields?: string[];
};

type MetricAlertViewResult = {
  orgSlug: string;
  rule: MetricAlertRule;
};

/**
 * Parse `org/<rule-id-or-name>` (one slash), or bare `rule-id-or-name` for auto-detect.
 * Trailing-only org is invalid (empty ref).
 */
function parseMetricViewArg(arg: string): {
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

  if (!trimmed.includes("/")) {
    return { ref: trimmed, targetArg: undefined };
  }

  const lastSlash = trimmed.lastIndexOf("/");
  const targetPart = trimmed.slice(0, lastSlash).trim();
  const ref = trimmed.slice(lastSlash + 1).trim();
  if (!ref) {
    throw new ValidationError(
      `Invalid rule reference '${arg}' (missing id or name after org).\nUse: ${USAGE_HINT}`,
      "rule"
    );
  }
  return { ref, targetArg: targetPart || undefined };
}

function isNotFoundApiError(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404;
}

async function listAllMetricRulesForOrg(
  orgSlug: string
): Promise<MetricAlertRule[]> {
  const all: MetricAlertRule[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGINATION_PAGES; page++) {
    const { data, nextCursor } = await listMetricAlertsPaginated(orgSlug, {
      perPage: API_MAX_PER_PAGE,
      cursor,
    });
    all.push(...data);
    if (!nextCursor) {
      break;
    }
    cursor = nextCursor;
  }
  return all;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: per-org list + name resolution + disambiguation (same as issues view)
async function resolveMetricAlertRule(
  orgSlugs: string[],
  ref: string
): Promise<MetricAlertViewResult> {
  if (isAllDigits(ref)) {
    const hits: MetricAlertViewResult[] = [];
    for (const orgSlug of orgSlugs) {
      try {
        const rule = await getMetricAlertRule(orgSlug, ref);
        hits.push({ orgSlug, rule });
      } catch (e) {
        if (isNotFoundApiError(e)) {
          continue;
        }
        throw e;
      }
    }

    if (hits.length === 1) {
      return hits[0] as MetricAlertViewResult;
    }
    if (hits.length > 1) {
      throw new ValidationError(
        `Alert rule ID '${ref}' matched multiple organizations.\n` +
          "Use an explicit target: sentry alert metrics view <org>/<rule-id>"
      );
    }
    throw new ResolutionError(
      `Metric alert rule '${ref}'`,
      "not found",
      USAGE_HINT
    );
  }

  const hits: MetricAlertViewResult[] = [];
  const allNames: string[] = [];

  for (const orgSlug of orgSlugs) {
    const rules = await listAllMetricRulesForOrg(orgSlug);
    for (const r of rules) {
      allNames.push(r.name);
    }
    const exact = rules.find(
      (rule) => rule.name.toLowerCase() === ref.toLowerCase()
    );
    if (exact) {
      hits.push({ orgSlug, rule: exact });
    }
  }

  if (hits.length === 1) {
    return hits[0] as MetricAlertViewResult;
  }
  if (hits.length > 1) {
    throw new ValidationError(
      `Alert rule name '${ref}' matched multiple organizations.\n` +
        "Use an explicit target: sentry alert metrics view <org>/<rule-id-or-name>"
    );
  }

  const uniqueNames = [...new Set(allNames)];
  const similar = fuzzyMatch(ref, uniqueNames, { maxResults: 5 });
  if (similar.length > 0) {
    const lines = similar.map((n) => `  ${n}`).join("\n");
    throw new ValidationError(
      `No metric alert rule named '${ref}' in the selected organization(s).\n\n` +
        `Did you mean:\n${lines}`,
      "rule"
    );
  }

  throw new ResolutionError(
    `Metric alert rule '${ref}'`,
    "not found",
    USAGE_HINT
  );
}

function formatMetricAlertView(data: MetricAlertViewResult): string {
  const { orgSlug, rule } = data;
  const status = rule.status === 0 ? "active" : "disabled";
  return [
    `Metric alert rule in ${orgSlug}:`,
    "",
    `ID:           ${rule.id}`,
    `Name:         ${rule.name}`,
    `Status:       ${status}`,
    `Dataset:      ${rule.dataset}`,
    `Aggregate:    ${rule.aggregate}`,
    `Query:        ${rule.query || "(none)"}`,
    `Time Window:  ${rule.timeWindow}m`,
    `Projects:     ${rule.projects.join(", ") || "(all)"}`,
    `Environment:  ${rule.environment ?? "all"}`,
    `Owner:        ${rule.owner ?? "none"}`,
  ].join("\n");
}

export const viewCommand = buildCommand({
  docs: {
    brief: "View a metric alert rule",
    fullDescription:
      "View a single metric alert rule by ID or name.\n\n" +
      "Examples:\n" +
      "  sentry alert metrics view 12345\n" +
      "  sentry alert metrics view my-org/12345\n" +
      "  sentry alert metrics view my-org/'p95 latency alert'",
  },
  output: {
    human: formatMetricAlertView,
    jsonTransform: (data: MetricAlertViewResult) => ({
      ...data.rule,
      org: data.orgSlug,
    }),
  },
  parameters: {
    positional: {
      kind: "tuple",
      parameters: [
        {
          placeholder: "org/rule-id-or-name",
          brief: "Metric alert rule ID or name",
          parse: String,
        },
      ],
    },
    flags: {
      web: {
        kind: "boolean",
        brief: "Open metric alert rules page in browser",
        default: false,
      },
    },
    aliases: { w: "web" },
  },
  async *func(this: SentryContext, flags: ViewFlags, arg: string) {
    const { cwd } = this;
    const { ref, targetArg } = parseMetricViewArg(arg);
    const parsed = parseOrgProjectArg(targetArg);
    const { targets } = await resolveTargetsFromParsedArg(parsed, {
      cwd,
      usageHint: USAGE_HINT,
    });
    const orgSlugs = [...new Set(targets.map((target) => target.org))];
    if (orgSlugs.length === 0) {
      throw new ContextError("Organization", USAGE_HINT);
    }

    const result = await resolveMetricAlertRule(orgSlugs, ref);
    if (flags.web) {
      await openInBrowser(
        buildMetricAlertsUrl(result.orgSlug),
        "metric alert rules"
      );
      return;
    }

    yield new CommandOutput(result);
  },
});
