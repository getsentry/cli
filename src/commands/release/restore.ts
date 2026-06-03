/**
 * sentry release restore
 *
 * Restore an archived release by setting its status back to "open", making it
 * visible in the default release list again.
 */

import type { SentryContext } from "../../context.js";
import { updateRelease } from "../../lib/api-client.js";
import { buildCommand } from "../../lib/command.js";
import { ContextError } from "../../lib/errors.js";
import {
  colorTag,
  escapeMarkdownInline,
  mdKvTable,
  renderMarkdown,
  safeCodeSpan,
} from "../../lib/formatters/markdown.js";
import { CommandOutput } from "../../lib/formatters/output.js";
import { DRY_RUN_ALIASES, DRY_RUN_FLAG } from "../../lib/mutate-command.js";
import { resolveOrg } from "../../lib/resolve-target.js";
import type { SentryRelease } from "../../types/index.js";
import { parseReleaseArg } from "./parse.js";

/**
 * Render the human-readable result of restoring a release.
 *
 * @param data - Either the dry-run preview object or the updated release.
 */
function formatReleaseRestored(data: Record<string, unknown>): string {
  if (data.dryRun) {
    return renderMarkdown(
      `Would restore release ${safeCodeSpan(String(data.version))} (dry run)`
    );
  }
  const release = data as unknown as SentryRelease;
  const lines: string[] = [];
  lines.push(`## Release Restored: ${escapeMarkdownInline(release.version)}`);
  lines.push("");
  const kvRows: [string, string][] = [];
  kvRows.push(["Version", safeCodeSpan(release.version)]);
  kvRows.push(["Status", colorTag("green", "Open")]);
  lines.push(mdKvTable(kvRows));
  return renderMarkdown(lines.join("\n"));
}

export const restoreCommand = buildCommand({
  docs: {
    brief: "Restore an archived release",
    fullDescription:
      "Restore an archived release by setting its status back to open, " +
      "making it visible in the default `sentry release list` again.\n\n" +
      "Examples:\n" +
      "  sentry release restore 1.0.0\n" +
      "  sentry release restore my-org/1.0.0\n" +
      "  sentry release restore 1.0.0 --dry-run",
  },
  output: {
    human: formatReleaseRestored,
  },
  parameters: {
    positional: {
      kind: "array",
      parameter: {
        placeholder: "org/version",
        brief: "[<org>/]<version> - Release version to restore",
        parse: String,
      },
    },
    flags: {
      "dry-run": DRY_RUN_FLAG,
    },
    aliases: { ...DRY_RUN_ALIASES },
  },
  async *func(
    this: SentryContext,
    flags: {
      readonly "dry-run": boolean;
      readonly json: boolean;
      readonly fields?: string[];
    },
    ...args: string[]
  ) {
    const { cwd } = this;

    const joined = args.join(" ").trim();
    if (!joined) {
      throw new ContextError(
        "Release version",
        "sentry release restore [<org>/]<version>",
        []
      );
    }

    const { version, orgSlug } = parseReleaseArg(
      joined,
      "sentry release restore [<org>/]<version>"
    );
    const resolved = await resolveOrg({ org: orgSlug, cwd });
    if (!resolved) {
      throw new ContextError(
        "Organization",
        "sentry release restore [<org>/]<version>"
      );
    }
    if (flags["dry-run"]) {
      yield new CommandOutput({ dryRun: true, version, org: resolved.org });
      return { hint: "Dry run — release was not restored." };
    }

    const release = await updateRelease(resolved.org, version, {
      status: "open",
    });
    yield new CommandOutput(release);
    const hint = resolved.detectedFrom
      ? `Detected from ${resolved.detectedFrom}`
      : undefined;
    return { hint };
  },
});
