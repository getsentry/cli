/** Remove an external issue association without deleting the external issue. */

import type { SentryContext } from "../../context.js";
import { formatIssueLinkResult } from "../../lib/formatters/issue-links.js";
import { CommandOutput } from "../../lib/formatters/output.js";
import { unlinkExternalIssue } from "../../lib/issue-links.js";
import {
  buildDeleteCommand,
  confirmByTyping,
  isConfirmationBypassed,
} from "../../lib/mutate-command.js";
import { EXTERNAL_ISSUE_FLAGS } from "./link-utils.js";
import { issueIdPositional, resolveOrgAndIssueId } from "./utils.js";

type UnlinkFlags = {
  readonly "external-issue": string;
  readonly integration?: string;
  readonly app?: string;
  readonly "dry-run": boolean;
  readonly yes: boolean;
  readonly force: boolean;
};

export const unlinkCommand = buildDeleteCommand({
  docs: {
    brief: "Unlink an external issue",
    fullDescription:
      "Remove an external tracker issue or GitHub pull request reference from a Sentry issue.\n" +
      "This does not delete the external issue or change the Sentry issue's status.\n\n" +
      "Requires event:admin and access to the Sentry project.\n" +
      "Your token must include event:admin even if your project role grants it.\n\n" +
      "Examples:\n" +
      "  sentry issue unlink FRONT-123 --external-issue https://github.com/example/app/issues/42\n" +
      "  sentry issue unlink FRONT-123 --external-issue https://github.com/example/app/pull/43 --yes\n" +
      "  sentry issue unlink my-org/FRONT-123 --external-issue https://example.atlassian.net/browse/APP-42 --yes\n" +
      "  sentry issue unlink FRONT-123 --external-issue https://linear.app/example/issue/APP-42/fix-error --dry-run",
  },
  output: { human: formatIssueLinkResult },
  parameters: {
    positional: issueIdPositional,
    flags: EXTERNAL_ISSUE_FLAGS,
  },
  async *func(this: SentryContext, flags: UnlinkFlags, issueArg: string) {
    const { org, issueId } = await resolveOrgAndIssueId({
      issueArg,
      cwd: this.cwd,
      command: "unlink",
    });
    if (!(flags["dry-run"] || isConfirmationBypassed(flags))) {
      const confirmed = await confirmByTyping(
        issueArg,
        `Type '${issueArg}' to unlink ${flags["external-issue"]}:`
      );
      if (!confirmed) {
        return { hint: "Cancelled." };
      }
    }
    const result = await unlinkExternalIssue({
      orgSlug: org,
      issueId,
      url: flags["external-issue"],
      integrationId: flags.integration,
      appSlug: flags.app,
      dryRun: flags["dry-run"],
    });
    yield new CommandOutput(result);
  },
});
