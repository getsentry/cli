/**
 * sentry alert issues edit
 *
 * Update an issue alert rule (name and/or status). Fetches the current rule,
 * applies changes, and PUTs the full document to the Sentry API.
 */

import type { SentryContext } from "../../../context.js";
import {
  getIssueAlertRuleDocument,
  putIssueAlertRule,
} from "../../../lib/api-client.js";
import { parseOrgProjectArg } from "../../../lib/arg-parsing.js";
import { buildCommand } from "../../../lib/command.js";
import { ContextError, ValidationError } from "../../../lib/errors.js";
import { CommandOutput } from "../../../lib/formatters/output.js";
import { resolveTargetsFromParsedArg } from "../../../lib/resolve-target.js";
import { parseIssueRuleArg, resolveIssueAlertRule } from "./rule-resolve.js";

const USAGE_HINT =
  "sentry alert issues edit <org>/<project>/<rule-id-or-name> --name <name> | --status active|disabled";

type EditFlags = {
  readonly name?: string;
  /** Present when --status was passed; omitted when the flag is absent. */
  readonly status?: "active" | "disabled" | undefined;
  readonly json: boolean;
  readonly fields?: string[];
};

type EditResult = {
  org: string;
  project: string;
  id: string;
  name: string;
  status: string;
};

function statusParser(
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
  return `Updated issue alert rule ${r.id} in ${r.org}/${r.project}: ${r.name} (${r.status}).`;
}

export const editCommand = buildCommand({
  docs: {
    brief: "Edit an issue alert rule",
    fullDescription:
      "Update an issue alert rule by id or name. You must set at least one of --name or " +
      "--status.\n\n" +
      "The CLI loads the current rule, applies your changes, and updates it via the API.\n\n" +
      "Examples:\n" +
      "  sentry alert issues edit my-org/my-app/12 --name 'Prod errors'\n" +
      "  sentry alert issues edit my-org/my-app/'Old name' --status disabled\n" +
      "  sentry alert issues edit 12 --name 'Renamed' --status active",
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
          placeholder: "org/project/rule-id-or-name",
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
        parse: statusParser,
        optional: true,
        brief: "Rule status: active or disabled",
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

    const { ref, targetArg } = parseIssueRuleArg(arg, USAGE_HINT);
    const parsed = parseOrgProjectArg(targetArg);
    const { targets } = await resolveTargetsFromParsedArg(parsed, {
      cwd,
      usageHint: USAGE_HINT,
    });
    if (targets.length === 0) {
      throw new ContextError("Organization and project", USAGE_HINT);
    }

    const { target, rule } = await resolveIssueAlertRule(
      targets,
      ref,
      USAGE_HINT
    );

    const body = {
      ...(await getIssueAlertRuleDocument(target.org, target.project, rule.id)),
    };
    if (flags.name !== undefined) {
      body.name = flags.name;
    }
    if (flags.status !== undefined) {
      body.status = flags.status;
    }

    const updated = await putIssueAlertRule(
      target.org,
      target.project,
      rule.id,
      body
    );
    const name = String(updated.name ?? rule.name);
    const status = String(updated.status ?? flags.status ?? rule.status);

    yield new CommandOutput({
      org: target.org,
      project: target.project,
      id: String(updated.id ?? rule.id),
      name,
      status,
    } satisfies EditResult);
  },
});
