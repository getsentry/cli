/**
 * sentry release view
 *
 * View details of a specific release.
 */

import type { OrgReleaseResponse } from "@sentry/api";
import type { SentryContext } from "../../context.js";
import { getRelease } from "../../lib/api-client.js";
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
import { formatRelativeTime } from "../../lib/formatters/time-utils.js";
import {
  applyFreshFlag,
  FRESH_ALIASES,
  FRESH_FLAG,
} from "../../lib/list-command.js";
import { resolveOrg } from "../../lib/resolve-target.js";
import { parseReleaseArg } from "./parse.js";

function formatReleaseDetails(release: OrgReleaseResponse): string {
  const lines: string[] = [];

  lines.push(
    `## Release ${escapeMarkdownInline(release.shortVersion || release.version)}`
  );
  lines.push("");

  const kvRows: [string, string][] = [];
  kvRows.push(["Version", safeCodeSpan(release.version)]);
  if (release.shortVersion && release.shortVersion !== release.version) {
    kvRows.push(["Short Version", safeCodeSpan(release.shortVersion)]);
  }
  kvRows.push([
    "Status",
    release.dateReleased
      ? colorTag("green", "Finalized")
      : colorTag("yellow", "Unreleased"),
  ]);
  if (release.dateCreated) {
    kvRows.push(["Created", formatRelativeTime(release.dateCreated)]);
  }
  kvRows.push([
    "Released",
    release.dateReleased ? formatRelativeTime(release.dateReleased) : "—",
  ]);
  kvRows.push([
    "First Event",
    release.firstEvent ? formatRelativeTime(release.firstEvent) : "—",
  ]);
  kvRows.push([
    "Last Event",
    release.lastEvent ? formatRelativeTime(release.lastEvent) : "—",
  ]);
  kvRows.push(["Ref", release.ref || "—"]);
  kvRows.push(["Commits", String(release.commitCount ?? 0)]);
  kvRows.push(["Deploys", String(release.deployCount ?? 0)]);
  kvRows.push(["New Issues", String(release.newGroups ?? 0)]);

  if (release.projects?.length) {
    kvRows.push(["Projects", release.projects.map((p) => p.slug).join(", ")]);
  }

  if (release.lastDeploy) {
    kvRows.push([
      "Last Deploy",
      `${release.lastDeploy.environment} (${formatRelativeTime(release.lastDeploy.dateFinished)})`,
    ]);
  }

  lines.push(mdKvTable(kvRows));
  return renderMarkdown(lines.join("\n"));
}

export const viewCommand = buildCommand({
  docs: {
    brief: "View release details",
    fullDescription:
      "Show detailed information about a Sentry release.\n\n" +
      "Examples:\n" +
      "  sentry release view 1.0.0\n" +
      "  sentry release view my-org/1.0.0\n" +
      '  sentry release view "sentry-cli@0.24.0"\n' +
      "  sentry release view 1.0.0 --json",
  },
  output: {
    human: formatReleaseDetails,
  },
  parameters: {
    positional: {
      kind: "array",
      parameter: {
        placeholder: "org/version",
        brief: "[<org>/]<version> - Release version to view",
        parse: String,
      },
    },
    flags: {
      fresh: FRESH_FLAG,
    },
    aliases: { ...FRESH_ALIASES },
  },
  async *func(
    this: SentryContext,
    flags: {
      readonly fresh: boolean;
      readonly json: boolean;
      readonly fields?: string[];
    },
    ...args: string[]
  ) {
    applyFreshFlag(flags);
    const { cwd } = this;

    const joined = args.join(" ").trim();
    if (!joined) {
      throw new ContextError(
        "Release version",
        "sentry release view [<org>/]<version>",
        []
      );
    }

    const { version, orgSlug } = parseReleaseArg(
      joined,
      "sentry release view [<org>/]<version>"
    );
    const resolved = await resolveOrg({ org: orgSlug, cwd });
    if (!resolved) {
      throw new ContextError(
        "Organization",
        "sentry release view [<org>/]<version>"
      );
    }
    const release = await getRelease(resolved.org, version);
    yield new CommandOutput(release);
    const hint = resolved.detectedFrom
      ? `Detected from ${resolved.detectedFrom}`
      : undefined;
    return { hint };
  },
});
