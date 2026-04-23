/**
 * sentry alert metrics edit
 *
 * Update a metric alert rule (name and/or enabled status).
 */

import type { SentryContext } from "../../../context.js";
import {
  getMetricAlertRuleDocument,
  putMetricAlertRule,
} from "../../../lib/api-client.js";
import { parseOrgProjectArg } from "../../../lib/arg-parsing.js";
import { buildCommand } from "../../../lib/command.js";
import { ContextError, ValidationError } from "../../../lib/errors.js";
import { CommandOutput } from "../../../lib/formatters/output.js";
import { resolveTargetsFromParsedArg } from "../../../lib/resolve-target.js";
import { parseMetricRuleArg, resolveMetricAlertRule } from "./rule-resolve.js";

const USAGE_HINT =
  "sentry alert metrics edit <org>/<rule-id-or-name> --name <n> | --status active|disabled";

type EditFlags = {
  readonly name?: string;
  readonly status?: "active" | "disabled" | undefined;
  readonly json: boolean;
  readonly fields?: string[];
};

type EditResult = {
  org: string;
  id: string;
  name: string;
  status: "active" | "disabled";
};

function metricStatusParser(
  s: string | undefined
): "active" | "disabled" | undefined {
  if (s === undefined || s === "") {
    return;
  }
  const v = s.toLowerCase().trim();
  if (v === "active" || v === "disabled") {
    return v;
  }
  throw new ValidationError(
    `Status must be 'active' or 'disabled' (got ${JSON.stringify(s)}).`,
    "status"
  );
}

function formatEdited(r: EditResult): string {
  return `Updated metric alert rule ${r.id} in ${r.org}: ${r.name} (${r.status}).`;
}

export const editCommand = buildCommand({
  docs: {
    brief: "Edit a metric alert rule",
    fullDescription:
      "Update a metric alert rule. Pass at least one of --name or --status. " +
      "Status 'active' enables the rule; 'disabled' sets it to disabled (API status 1).\n\n" +
      "Examples:\n" +
      "  sentry alert metrics edit my-org/9 --name 'Error budget'\n" +
      "  sentry alert metrics edit my-org/9 --status disabled",
  },
  output: {
    human: formatEdited,
    jsonTransform: (r: EditResult) => r,
  },
  parameters: {
    positional: {
      kind: "tuple",
      parameters: [
        {
          placeholder: "org/rule-id-or-name",
          brief: "Rule id or name (same as view)",
          parse: String,
        },
      ],
    },
    flags: {
      name: {
        kind: "parsed",
        parse: String,
        optional: true,
        brief: "New rule name",
      },
      status: {
        kind: "parsed",
        parse: metricStatusParser,
        optional: true,
        brief: "active or disabled",
      },
    },
  },
  async *func(this: SentryContext, flags: EditFlags, arg: string) {
    const { cwd } = this;
    if (flags.name === undefined && flags.status === undefined) {
      throw new ValidationError(
        "Pass at least one of --name or --status to edit the rule.",
        "name"
      );
    }
    const { ref, targetArg } = parseMetricRuleArg(arg, USAGE_HINT);
    const parsed = parseOrgProjectArg(targetArg);
    const { targets } = await resolveTargetsFromParsedArg(parsed, {
      cwd,
      usageHint: USAGE_HINT,
    });
    const orgSlugs = [...new Set(targets.map((t) => t.org))];
    if (orgSlugs.length === 0) {
      throw new ContextError("Organization", USAGE_HINT);
    }
    const { orgSlug, rule } = await resolveMetricAlertRule(
      orgSlugs,
      ref,
      USAGE_HINT
    );
    const body = {
      ...(await getMetricAlertRuleDocument(orgSlug, rule.id)),
    };
    if (flags.name !== undefined) {
      body.name = flags.name;
    }
    if (flags.status === "active") {
      body.status = 0;
    } else if (flags.status === "disabled") {
      body.status = 1;
    }
    const updated = await putMetricAlertRule(orgSlug, rule.id, body);
    const name = String(updated.name ?? rule.name);
    const st = updated.status;
    const status: "active" | "disabled" =
      st === 0 || st === "0" ? "active" : "disabled";
    yield new CommandOutput({
      org: orgSlug,
      id: String(updated.id ?? rule.id),
      name,
      status,
    } satisfies EditResult);
  },
});
