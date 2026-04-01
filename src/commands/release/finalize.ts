/**
 * sentry release finalize
 *
 * Finalize a release by setting its dateReleased to now.
 */

import type { OrgReleaseResponse } from "@sentry/api";
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
import { parseReleaseArg } from "./parse.js";

function formatReleaseFinalized(data: Record<string, unknown>): string {
  if (data.dryRun) {
    return renderMarkdown(
      `Would finalize release ${safeCodeSpan(String(data.version))} (dry run)`
    );
  }
  const release = data as unknown as OrgReleaseResponse;
  const lines: string[] = [];
  lines.push(`## Release Finalized: ${escapeMarkdownInline(release.version)}`);
  lines.push("");
  const kvRows: [string, string][] = [];
  kvRows.push(["Version", safeCodeSpan(release.version)]);
  kvRows.push(["Status", colorTag("green", "Finalized")]);
  kvRows.push(["Released", release.dateReleased || "—"]);
  lines.push(mdKvTable(kvRows));
  return renderMarkdown(lines.join("\n"));
}

export const finalizeCommand = buildCommand({
  docs: {
    brief: "Finalize a release",
    fullDescription:
      "Mark a release as finalized by setting its release date.\n\n" +
      "Examples:\n" +
      "  sentry release finalize 1.0.0\n" +
      "  sentry release finalize my-org/1.0.0\n" +
      "  sentry release finalize 1.0.0 --released 2025-01-01T00:00:00Z\n" +
      "  sentry release finalize 1.0.0 --dry-run",
  },
  output: {
    human: formatReleaseFinalized,
  },
  parameters: {
    positional: {
      kind: "array",
      parameter: {
        placeholder: "org/version",
        brief: "[<org>/]<version> - Release version to finalize",
        parse: String,
      },
    },
    flags: {
      released: {
        kind: "parsed",
        parse: String,
        brief: "Custom release timestamp (ISO 8601). Defaults to now.",
        optional: true,
      },
      url: {
        kind: "parsed",
        parse: String,
        brief: "URL for the release",
        optional: true,
      },
      "dry-run": DRY_RUN_FLAG,
    },
    aliases: { ...DRY_RUN_ALIASES },
  },
  async *func(
    this: SentryContext,
    flags: {
      readonly released?: string;
      readonly url?: string;
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
        "sentry release finalize [<org>/]<version>",
        []
      );
    }

    const { version, orgSlug } = parseReleaseArg(
      joined,
      "sentry release finalize [<org>/]<version>"
    );
    const resolved = await resolveOrg({ org: orgSlug, cwd });
    if (!resolved) {
      throw new ContextError(
        "Organization",
        "sentry release finalize [<org>/]<version>"
      );
    }
    if (flags["dry-run"]) {
      yield new CommandOutput({
        dryRun: true,
        version,
        org: resolved.org,
        released: flags.released || new Date().toISOString(),
      });
      return { hint: "Dry run — release was not finalized." };
    }

    const body: Record<string, string> = {
      dateReleased: flags.released || new Date().toISOString(),
    };
    if (flags.url) {
      body.url = flags.url;
    }
    const release = await updateRelease(resolved.org, version, body);
    yield new CommandOutput(release);
    const hint = resolved.detectedFrom
      ? `Detected from ${resolved.detectedFrom}`
      : undefined;
    return { hint };
  },
});
