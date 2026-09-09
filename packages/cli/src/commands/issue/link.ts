/** Associate an existing tracker issue with a Sentry issue. */

import type { SentryContext } from "../../context.js";
import { buildCommand } from "../../lib/command.js";
import { ContextError } from "../../lib/errors.js";
import { formatIssueLinkResult } from "../../lib/formatters/issue-links.js";
import { CommandOutput } from "../../lib/formatters/output.js";
import { linkExternalIssue } from "../../lib/issue-links.js";
import { DRY_RUN_ALIASES, DRY_RUN_FLAG } from "../../lib/mutate-command.js";
import {
  EXTERNAL_ISSUE_FLAGS,
  EXTERNAL_ISSUE_POSITIONALS,
  parseIssueLinkFields,
} from "./link-utils.js";
import { resolveIssue } from "./utils.js";

type LinkFlags = {
  readonly integration?: string;
  readonly app?: string;
  readonly field?: string[];
  readonly "dry-run": boolean;
};

export const linkCommand = buildCommand({
  docs: {
    brief: "Link an existing external issue",
    fullDescription:
      "Link an existing tracker issue or GitHub pull request as an external reference.\n" +
      "The integration must be installed in your Sentry organization.\n" +
      "This does not create a remote issue or resolve the Sentry issue.\n\n" +
      "Requires event:write and access to the Sentry project.\n\n" +
      "Examples:\n" +
      "  sentry issue link FRONT-123 https://github.com/example/app/issues/42\n" +
      "  sentry issue link FRONT-123 https://github.com/example/app/pull/43\n" +
      "  sentry issue link my-org/FRONT-123 https://example.atlassian.net/browse/APP-42\n" +
      "  sentry issue link FRONT-123 https://linear.app/example/issue/APP-42/fix-error\n" +
      "  sentry issue link FRONT-123 https://github.com/example/app/issues/42 --dry-run",
  },
  output: { human: formatIssueLinkResult },
  parameters: {
    positional: EXTERNAL_ISSUE_POSITIONALS,
    flags: {
      ...EXTERNAL_ISSUE_FLAGS,
      "dry-run": DRY_RUN_FLAG,
      field: {
        kind: "parsed",
        parse: String,
        brief: "Additional Sentry App link form field (name=value, repeatable)",
        variadic: true,
        optional: true,
      },
    },
    aliases: DRY_RUN_ALIASES,
  },
  async *func(
    this: SentryContext,
    flags: LinkFlags,
    issueArg: string,
    url: string
  ) {
    const fields = parseIssueLinkFields(flags.field);
    const { org, issue } = await resolveIssue({
      issueArg,
      cwd: this.cwd,
      command: "link",
    });
    if (!org) {
      throw new ContextError(
        "Organization",
        "sentry issue link <org>/ISSUE <url>"
      );
    }
    const result = await linkExternalIssue({
      orgSlug: org,
      issueId: issue.id,
      projectId: issue.project?.id,
      url,
      integrationId: flags.integration,
      appSlug: flags.app,
      fields,
      dryRun: flags["dry-run"],
    });
    yield new CommandOutput(result);
  },
});
