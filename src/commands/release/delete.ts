/**
 * sentry release delete
 *
 * Permanently delete a Sentry release.
 *
 * Uses `buildDeleteCommand` — auto-injects `--yes`/`--force`/`--dry-run`
 * flags and enforces the non-interactive guard before `func()` runs.
 */

import type { SentryContext } from "../../context.js";
import { deleteRelease, getRelease } from "../../lib/api-client.js";
import { ContextError } from "../../lib/errors.js";
import { renderMarkdown, safeCodeSpan } from "../../lib/formatters/markdown.js";
import { CommandOutput } from "../../lib/formatters/output.js";
import {
  buildDeleteCommand,
  confirmByTyping,
  isConfirmationBypassed,
} from "../../lib/mutate-command.js";
import { resolveOrg } from "../../lib/resolve-target.js";
import { parseReleaseArg } from "./parse.js";

type DeleteResult = {
  deleted: boolean;
  org: string;
  version: string;
  dryRun?: boolean;
};

function formatReleaseDeleted(result: DeleteResult): string {
  if (result.dryRun) {
    return renderMarkdown(
      `Would delete release ${safeCodeSpan(result.version)} from **${result.org}**. (dry run)`
    );
  }
  if (!result.deleted) {
    return "Cancelled.";
  }
  return renderMarkdown(
    `Release ${safeCodeSpan(result.version)} deleted from **${result.org}**.`
  );
}

type DeleteFlags = {
  readonly yes: boolean;
  readonly force: boolean;
  readonly "dry-run": boolean;
  readonly json: boolean;
  readonly fields?: string[];
};

export const deleteCommand = buildDeleteCommand({
  docs: {
    brief: "Delete a release",
    fullDescription:
      "Permanently delete a Sentry release.\n\n" +
      "Examples:\n" +
      "  sentry release delete 1.0.0\n" +
      "  sentry release delete my-org/1.0.0\n" +
      "  sentry release delete 1.0.0 --yes\n" +
      "  sentry release delete 1.0.0 --dry-run",
  },
  output: {
    human: formatReleaseDeleted,
  },
  parameters: {
    positional: {
      kind: "array",
      parameter: {
        placeholder: "org/version",
        brief: "[<org>/]<version> - Release version to delete",
        parse: String,
      },
    },
  },
  async *func(this: SentryContext, flags: DeleteFlags, ...args: string[]) {
    const { cwd } = this;

    const joined = args.join(" ").trim();
    if (!joined) {
      throw new ContextError(
        "Release version",
        "sentry release delete [<org>/]<version>",
        []
      );
    }

    const { version, orgSlug } = parseReleaseArg(
      joined,
      "sentry release delete [<org>/]<version>"
    );
    const resolved = await resolveOrg({ org: orgSlug, cwd });
    if (!resolved) {
      throw new ContextError(
        "Organization",
        "sentry release delete [<org>/]<version>"
      );
    }

    // Verify the release exists before prompting for confirmation
    const release = await getRelease(resolved.org, version);

    // Dry-run mode: show what would be deleted
    if (flags["dry-run"]) {
      yield new CommandOutput({
        deleted: false,
        org: resolved.org,
        version,
        dryRun: true,
      });
      return;
    }

    // Confirmation gate — non-interactive guard is handled by buildDeleteCommand
    if (!isConfirmationBypassed(flags)) {
      const deployInfo =
        release.deployCount && release.deployCount > 0
          ? ` (${release.deployCount} deploy${release.deployCount > 1 ? "s" : ""})`
          : "";
      const confirmed = await confirmByTyping(
        version,
        `Type '${version}' to permanently delete this release${deployInfo}:`
      );
      if (!confirmed) {
        yield new CommandOutput({
          deleted: false,
          org: resolved.org,
          version,
        });
        return { hint: "Cancelled." };
      }
    }

    await deleteRelease(resolved.org, version);
    yield new CommandOutput({ deleted: true, org: resolved.org, version });
  },
});
