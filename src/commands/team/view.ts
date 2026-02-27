/**
 * sentry team view
 *
 * View detailed information about a Sentry team.
 */

import type { SentryContext } from "../../context.js";
import { getTeam } from "../../lib/api-client.js";
import {
  type ParsedOrgProject,
  ProjectSpecificationType,
  parseOrgProjectArg,
} from "../../lib/arg-parsing.js";
import { openInBrowser } from "../../lib/browser.js";
import { buildCommand } from "../../lib/command.js";
import { getDefaultOrganization } from "../../lib/db/defaults.js";
import { ApiError, ContextError } from "../../lib/errors.js";
import {
  writeFooter,
  writeJson,
  writeKeyValue,
} from "../../lib/formatters/index.js";
import { resolveAllTargets } from "../../lib/resolve-target.js";
import { buildTeamUrl } from "../../lib/sentry-urls.js";
import type { SentryTeam } from "../../types/index.js";

type ViewFlags = {
  readonly json: boolean;
  readonly web: boolean;
};

/** Usage hint for ContextError messages */
const USAGE_HINT = "sentry team view <org>/<team>";

/**
 * Resolve org and team slugs from the positional argument.
 *
 * Supports:
 * - `<org>/<team>` — explicit org and team
 * - `<team>` — resolve org from config defaults or DSN auto-detection
 *
 * @param parsed - Parsed positional argument
 * @param cwd - Current working directory (for DSN auto-detection)
 * @returns Resolved org slug and team slug
 */
/** Whether the org was explicitly provided or auto-resolved */
type ResolvedOrgAndTeam = {
  orgSlug: string;
  teamSlug: string;
  /** True when org was inferred from DSN/config, not user input */
  orgAutoResolved: boolean;
};

/**
 * Resolve the organization slug when only a team slug is provided.
 *
 * Uses config defaults first (fast), then falls back to DSN auto-detection
 * via `resolveAllTargets` (same approach as `team list`).
 */
async function resolveOrgForTeam(cwd: string): Promise<string | null> {
  // 1. Config defaults (fast, no file scanning)
  const defaultOrg = await getDefaultOrganization();
  if (defaultOrg) {
    return defaultOrg;
  }

  // 2. DSN auto-detection (same as team list)
  try {
    const { targets } = await resolveAllTargets({ cwd });
    if (targets.length > 0 && targets[0]) {
      return targets[0].org;
    }
  } catch {
    // Fall through — DSN detection is best-effort
  }

  return null;
}

async function resolveOrgAndTeam(
  parsed: ParsedOrgProject,
  cwd: string
): Promise<ResolvedOrgAndTeam> {
  switch (parsed.type) {
    case ProjectSpecificationType.Explicit:
      return {
        orgSlug: parsed.org,
        teamSlug: parsed.project,
        orgAutoResolved: false,
      };

    case ProjectSpecificationType.ProjectSearch: {
      const orgSlug = await resolveOrgForTeam(cwd);
      if (!orgSlug) {
        throw new ContextError("Organization", USAGE_HINT, [
          "Specify the org explicitly: sentry team view <org>/<team>",
        ]);
      }
      return {
        orgSlug,
        teamSlug: parsed.projectSlug,
        orgAutoResolved: true,
      };
    }

    case ProjectSpecificationType.OrgAll:
      throw new ContextError("Team slug", USAGE_HINT, [
        "Specify the team: sentry team view <org>/<team>",
      ]);

    case ProjectSpecificationType.AutoDetect:
      throw new ContextError("Team slug", USAGE_HINT);

    default:
      throw new ContextError("Team slug", USAGE_HINT);
  }
}

export const viewCommand = buildCommand({
  docs: {
    brief: "View details of a team",
    fullDescription:
      "View detailed information about a Sentry team, including associated projects.\n\n" +
      "Target specification:\n" +
      "  sentry team view <org>/<team>   # explicit org and team\n" +
      "  sentry team view <team>         # auto-detect org from config or DSN",
  },
  parameters: {
    positional: {
      kind: "tuple",
      parameters: [
        {
          placeholder: "team",
          brief: "Target: <org>/<team> or <team> (if org is auto-detected)",
          parse: String,
          optional: true,
        },
      ],
    },
    flags: {
      json: {
        kind: "boolean",
        brief: "Output as JSON",
        default: false,
      },
      web: {
        kind: "boolean",
        brief: "Open in browser",
        default: false,
      },
    },
    aliases: { w: "web" },
  },
  async func(
    this: SentryContext,
    flags: ViewFlags,
    teamArg?: string
  ): Promise<void> {
    const { stdout, cwd } = this;

    const parsed = parseOrgProjectArg(teamArg);
    const { orgSlug, teamSlug, orgAutoResolved } = await resolveOrgAndTeam(
      parsed,
      cwd
    );

    if (flags.web) {
      await openInBrowser(stdout, buildTeamUrl(orgSlug, teamSlug), "team");
      return;
    }

    let team: SentryTeam;
    try {
      team = await getTeam(orgSlug, teamSlug);
    } catch (error: unknown) {
      // When org was auto-resolved, any API failure likely means wrong org
      if (orgAutoResolved) {
        throw new ContextError(`Team "${teamSlug}"`, USAGE_HINT, [
          `Auto-detected organization "${orgSlug}" may be incorrect`,
          "Specify the org explicitly: sentry team view <org>/<team>",
        ]);
      }
      if (error instanceof ApiError && error.status === 404) {
        throw new ContextError(
          `Team "${teamSlug}" in organization "${orgSlug}"`,
          USAGE_HINT,
          [
            "Check that the team slug is correct",
            "Check that you have access to this team",
            `Try: sentry team list ${orgSlug}`,
          ]
        );
      }
      throw error;
    }

    // JSON output
    if (flags.json) {
      writeJson(stdout, team);
      return;
    }

    // Human-readable output
    stdout.write(`\n${team.name}\n\n`);

    const fields: [string, string][] = [
      ["Slug:", team.slug],
      ["ID:", team.id],
    ];
    if (team.memberCount !== undefined) {
      fields.push(["Members:", String(team.memberCount)]);
    }
    if (team.teamRole) {
      fields.push(["Role:", team.teamRole]);
    }
    writeKeyValue(stdout, fields);

    // Projects section (only when present)
    const projects = (team as Record<string, unknown>).projects as
      | { slug: string; platform?: string }[]
      | undefined;
    if (projects && projects.length > 0) {
      stdout.write("\nProjects:\n");
      const projectPairs: [string, string][] = projects.map((p) => [
        p.slug,
        p.platform || "",
      ]);
      writeKeyValue(stdout, projectPairs);
    }

    writeFooter(
      stdout,
      `Tip: Use 'sentry team list ${orgSlug}' to see all teams`
    );
  },
});
