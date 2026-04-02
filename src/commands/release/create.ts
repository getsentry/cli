/**
 * sentry release create
 *
 * Create a new Sentry release.
 */

import type { OrgReleaseResponse } from "@sentry/api";
import type { SentryContext } from "../../context.js";
import { createRelease } from "../../lib/api-client.js";
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

function formatReleaseCreated(release: OrgReleaseResponse): string {
  const lines: string[] = [];
  lines.push(`## Release Created: ${escapeMarkdownInline(release.version)}`);
  lines.push("");
  const kvRows: [string, string][] = [];
  kvRows.push(["Version", safeCodeSpan(release.version)]);
  kvRows.push([
    "Status",
    release.dateReleased
      ? colorTag("green", "Finalized")
      : colorTag("yellow", "Unreleased"),
  ]);
  if (release.projects?.length) {
    kvRows.push(["Projects", release.projects.map((p) => p.slug).join(", ")]);
  }
  lines.push(mdKvTable(kvRows));
  return renderMarkdown(lines.join("\n"));
}

export const createCommand = buildCommand({
  docs: {
    brief: "Create a release",
    fullDescription:
      "Create a new Sentry release.\n\n" +
      "The version must match the `release` value in Sentry.init().\n" +
      "Use `org/version` to specify the org — the `org/` prefix is the org slug, not\n" +
      "part of the version. E.g., `sentry/1.0.0` means org=sentry, version=1.0.0.\n\n" +
      "Examples:\n" +
      "  sentry release create 1.0.0\n" +
      "  sentry release create my-org/1.0.0\n" +
      "  sentry release create 1.0.0 --project my-project\n" +
      "  sentry release create 1.0.0 --project proj-a,proj-b\n" +
      "  sentry release create 1.0.0 --finalize\n" +
      "  sentry release create 1.0.0 --ref main\n" +
      "  sentry release create 1.0.0 --url https://github.com/org/repo/releases/tag/1.0.0\n" +
      "  sentry release create 1.0.0 --dry-run",
  },
  output: {
    human: (data: Record<string, unknown>) => {
      if (data.dryRun) {
        const projects = (data.projects as string[]) || [];
        return renderMarkdown(
          `Would create release ${safeCodeSpan(String(data.version))}` +
            (projects.length > 0
              ? ` in projects: ${projects.join(", ")}`
              : "") +
            (data.finalize ? " (finalized)" : "") +
            " (dry run)"
        );
      }
      return formatReleaseCreated(data as OrgReleaseResponse);
    },
  },
  parameters: {
    positional: {
      kind: "array",
      parameter: {
        placeholder: "org/version",
        brief: "[<org>/]<version> - Release version to create",
        parse: String,
      },
    },
    flags: {
      project: {
        kind: "parsed",
        parse: String,
        brief: "Associate with project(s), comma-separated",
        optional: true,
      },
      finalize: {
        kind: "boolean",
        brief: "Immediately finalize the release (set dateReleased)",
        default: false,
      },
      ref: {
        kind: "parsed",
        parse: String,
        brief: "Git ref (branch or tag name)",
        optional: true,
      },
      url: {
        kind: "parsed",
        parse: String,
        brief: "URL to the release source",
        optional: true,
      },
      "dry-run": DRY_RUN_FLAG,
    },
    aliases: { ...DRY_RUN_ALIASES, p: "project" },
  },
  async *func(
    this: SentryContext,
    flags: {
      readonly project?: string;
      readonly finalize: boolean;
      readonly ref?: string;
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
        "sentry release create [<org>/]<version>",
        []
      );
    }

    const { version, orgSlug } = parseReleaseArg(
      joined,
      "sentry release create [<org>/]<version>"
    );
    const resolved = await resolveOrg({ org: orgSlug, cwd });
    if (!resolved) {
      throw new ContextError(
        "Organization",
        "sentry release create [<org>/]<version>"
      );
    }

    const body: Parameters<typeof createRelease>[1] = { version };
    if (flags.project) {
      body.projects = flags.project.split(",").map((p) => p.trim());
    }
    if (flags.ref) {
      body.ref = flags.ref;
    }
    if (flags.url) {
      body.url = flags.url;
    }
    if (flags.finalize) {
      body.dateReleased = new Date().toISOString();
    }

    // Dry-run mode: show what would be created without calling the API
    if (flags["dry-run"]) {
      yield new CommandOutput({
        dryRun: true,
        version,
        projects: flags.project
          ? flags.project.split(",").map((p) => p.trim())
          : [],
        finalize: flags.finalize,
        ref: flags.ref,
        url: flags.url,
      });
      return { hint: "Dry run — no release was created." };
    }

    const release = await createRelease(resolved.org, body);
    yield new CommandOutput(release);

    const hint = flags.finalize
      ? "Release created and finalized."
      : `Release created. Finalize with: sentry release finalize ${version}`;
    return { hint };
  },
});
