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

function parseMetricViewArg(arg: string): {
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
  orgSlug: string,
  ref: string
): Promise<MetricAlertRule | null> {
  const all: MetricAlertRule[] = [];
  let cursor: string | undefined;

  for (let page = 0; page < MAX_PAGINATION_PAGES; page++) {
    const { data, nextCursor } = await listMetricAlertsPaginated(orgSlug, {
      perPage: API_MAX_PER_PAGE,
      cursor,
    });
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
      } catch {
        // Continue searching other orgs.
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
  for (const orgSlug of orgSlugs) {
    const rule = await findRuleByName(orgSlug, ref);
    if (rule) {
      hits.push({ orgSlug, rule });
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
