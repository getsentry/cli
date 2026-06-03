/**
 * sentry release archive
 *
 * Archive a release by setting its status to "archived". Archived releases are
 * hidden from the default release list but retained; restore with
 * `sentry release restore`.
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
 * Render the human-readable result of archiving a release.
 *
 * @param data - Either the dry-run preview object or the updated release.
 */
function formatReleaseArchived(data: Record<string, unknown>): string {
  if (data.dryRun) {
    return renderMarkdown(
      `Would archive release ${safeCodeSpan(String(data.version))} (dry run)`
    );
  }
  const release = data as unknown as SentryRelease;
  const lines: string[] = [];
  lines.push(`## Release Archived: ${escapeMarkdownInline(release.version)}`);
  lines.push("");
  const kvRows: [string, string][] = [];
  kvRows.push(["Version", safeCodeSpan(release.version)]);
  kvRows.push(["Status", colorTag("muted", "Archived")]);
  lines.push(mdKvTable(kvRows));
  return renderMarkdown(lines.join("\n"));
}

export const archiveCommand = buildCommand({
  docs: {
    brief: "Archive a release",
    fullDescription:
      "Mark a release as archived. Archived releases are hidden from the " +
      "default `sentry release list` but are retained and can be restored " +
      "with `sentry release restore`.\n\n" +
      "Examples:\n" +
      "  sentry release archive 1.0.0\n" +
      "  sentry release archive my-org/1.0.0\n" +
      "  sentry release archive 1.0.0 --dry-run",
  },
  output: {
    human: formatReleaseArchived,
  },
  parameters: {
    positional: {
      kind: "array",
      parameter: {
        placeholder: "org/version",
        brief: "[<org>/]<version> - Release version to archive",
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
        "sentry release archive [<org>/]<version>",
        []
      );
    }

    const { version, orgSlug } = parseReleaseArg(
      joined,
      "sentry release archive [<org>/]<version>"
    );
    const resolved = await resolveOrg({ org: orgSlug, cwd });
    if (!resolved) {
      throw new ContextError(
        "Organization",
        "sentry release archive [<org>/]<version>"
      );
    }
    if (flags["dry-run"]) {
      yield new CommandOutput({ dryRun: true, version, org: resolved.org });
      return { hint: "Dry run — release was not archived." };
    }

    const release = await updateRelease(resolved.org, version, {
      status: "archived",
    });
    yield new CommandOutput(release);
    const hint = resolved.detectedFrom
      ? `Detected from ${resolved.detectedFrom}`
      : undefined;
    return { hint };
  },
});
