/**
 * sentry project create
 *
 * Create a new Sentry project.
 * Supports org/name positional syntax (like `gh repo create owner/repo`).
 */

import type { SentryContext } from "../../context.js";
import {
  createProject,
  getProjectKeys,
  listOrganizations,
  listTeams,
} from "../../lib/api-client.js";
import { buildCommand } from "../../lib/command.js";
import { ApiError, CliError, ContextError } from "../../lib/errors.js";
import { writeFooter, writeJson } from "../../lib/formatters/index.js";
import { resolveOrg } from "../../lib/resolve-target.js";
import { buildProjectUrl, getSentryBaseUrl } from "../../lib/sentry-urls.js";
import type { SentryProject, SentryTeam } from "../../types/index.js";

type CreateFlags = {
  readonly team?: string;
  readonly json: boolean;
};

/** Common Sentry platform strings, shown when platform arg is missing */
const PLATFORMS = [
  "javascript",
  "javascript-react",
  "javascript-nextjs",
  "javascript-vue",
  "javascript-angular",
  "javascript-svelte",
  "javascript-remix",
  "javascript-astro",
  "node",
  "node-express",
  "python",
  "python-django",
  "python-flask",
  "python-fastapi",
  "go",
  "ruby",
  "ruby-rails",
  "php",
  "php-laravel",
  "java",
  "android",
  "dotnet",
  "react-native",
  "apple-ios",
  "rust",
  "elixir",
] as const;

/**
 * Parse the name positional argument.
 * Supports `org/name` syntax for explicit org, or bare `name` for auto-detect.
 *
 * @returns Parsed org (if explicit) and project name
 */
function parseNameArg(arg: string): { org?: string; name: string } {
  if (arg.includes("/")) {
    const slashIndex = arg.indexOf("/");
    const org = arg.slice(0, slashIndex);
    const name = arg.slice(slashIndex + 1);

    if (!(org && name)) {
      throw new ContextError(
        "Project name",
        "sentry project create <org>/<name> <platform>\n\n" +
          'Both org and name are required when using "/" syntax.'
      );
    }

    return { org, name };
  }

  return { name: arg };
}

/**
 * Resolve which team to create the project under.
 *
 * Priority:
 * 1. Explicit --team flag
 * 2. Auto-detect: if org has exactly one team, use it
 * 3. Error with list of available teams
 *
 * @param orgSlug - Organization to list teams from
 * @param teamFlag - Explicit team slug from --team flag
 * @param detectedFrom - Source of auto-detected org (shown in error messages)
 * @returns Team slug to use
 */
async function resolveTeam(
  orgSlug: string,
  teamFlag?: string,
  detectedFrom?: string
): Promise<string> {
  if (teamFlag) {
    return teamFlag;
  }

  let teams: SentryTeam[];
  try {
    teams = await listTeams(orgSlug);
  } catch (error) {
    if (error instanceof ApiError) {
      // Try to list the user's actual orgs to help them fix the command
      let orgHint =
        "Specify org explicitly: sentry project create <org>/<name> <platform>";
      try {
        const orgs = await listOrganizations();
        if (orgs.length > 0) {
          const orgList = orgs.map((o) => `  ${o.slug}`).join("\n");
          orgHint = `Your organizations:\n\n${orgList}`;
        }
      } catch {
        // Best-effort — if this also fails, use the generic hint
      }

      const alternatives = [
        `Could not list teams for org '${orgSlug}' (${error.status})`,
      ];
      if (detectedFrom) {
        alternatives.push(
          `Org '${orgSlug}' was auto-detected from ${detectedFrom}`
        );
      }
      alternatives.push(orgHint);
      throw new ContextError(
        "Organization",
        "sentry project create <org>/<name> <platform> --team <team-slug>",
        alternatives
      );
    }
    throw error;
  }

  if (teams.length === 0) {
    const teamsUrl = `${getSentryBaseUrl()}/settings/${orgSlug}/teams/`;
    throw new ContextError(
      "Team",
      `sentry project create ${orgSlug}/<name> <platform> --team <team-slug>`,
      [`No teams found in org '${orgSlug}'`, `Create a team at ${teamsUrl}`]
    );
  }

  if (teams.length === 1) {
    return (teams[0] as SentryTeam).slug;
  }

  // Multiple teams — user must specify
  const teamList = teams.map((t) => `  ${t.slug}`).join("\n");
  throw new ContextError(
    "Team",
    `sentry project create <name> <platform> --team ${(teams[0] as SentryTeam).slug}`,
    [
      `Multiple teams found in ${orgSlug}. Specify one with --team:\n\n${teamList}`,
    ]
  );
}

/**
 * Create a project with user-friendly error handling.
 * Wraps API errors with actionable messages instead of raw HTTP status codes.
 */
async function createProjectWithErrors(
  orgSlug: string,
  teamSlug: string,
  name: string,
  platform: string
): Promise<SentryProject> {
  try {
    return await createProject(orgSlug, teamSlug, { name, platform });
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.status === 409) {
        throw new CliError(
          `A project named '${name}' already exists in ${orgSlug}.\n\n` +
            `View it: sentry project view ${orgSlug}/${name}`
        );
      }
      if (error.status === 404) {
        throw new CliError(
          `Team '${teamSlug}' not found in ${orgSlug}.\n\n` +
            "Check the team slug and try again:\n" +
            `  sentry project create ${orgSlug}/${name} ${platform} --team <team-slug>`
        );
      }
      throw new CliError(
        `Failed to create project '${name}' in ${orgSlug}.\n\n` +
          `API error (${error.status}): ${error.detail ?? error.message}`
      );
    }
    throw error;
  }
}

/**
 * Try to fetch the primary DSN for a newly created project.
 * Returns null on any error — DSN display is best-effort.
 */
async function tryGetPrimaryDsn(
  orgSlug: string,
  projectSlug: string
): Promise<string | null> {
  try {
    const keys = await getProjectKeys(orgSlug, projectSlug);
    const activeKey = keys.find((k) => k.isActive);
    return activeKey?.dsn.public ?? keys[0]?.dsn.public ?? null;
  } catch {
    return null;
  }
}

export const createCommand = buildCommand({
  docs: {
    brief: "Create a new project",
    fullDescription:
      "Create a new Sentry project in an organization.\n\n" +
      "The name supports org/name syntax to specify the organization explicitly.\n" +
      "If omitted, the org is auto-detected from config defaults or DSN.\n\n" +
      "Projects are created under a team. If the org has one team, it is used\n" +
      "automatically. Otherwise, specify --team.\n\n" +
      "Examples:\n" +
      "  sentry project create my-app node\n" +
      "  sentry project create acme-corp/my-app javascript-nextjs\n" +
      "  sentry project create my-app python-django --team backend\n" +
      "  sentry project create my-app go --json",
  },
  parameters: {
    positional: {
      kind: "tuple",
      parameters: [
        {
          placeholder: "name",
          brief: "Project name (supports org/name syntax)",
          parse: String,
          optional: true,
        },
        {
          placeholder: "platform",
          brief: "Project platform (e.g., node, python, javascript-nextjs)",
          parse: String,
          optional: true,
        },
      ],
    },
    flags: {
      team: {
        kind: "parsed",
        parse: String,
        brief: "Team to create the project under",
        optional: true,
      },
      json: {
        kind: "boolean",
        brief: "Output as JSON",
        default: false,
      },
    },
    aliases: { t: "team" },
  },
  async func(
    this: SentryContext,
    flags: CreateFlags,
    nameArg?: string,
    platformArg?: string
  ): Promise<void> {
    const { stdout, cwd } = this;

    if (!nameArg) {
      throw new ContextError(
        "Project name",
        "sentry project create <name> <platform>",
        [
          "Use org/name syntax: sentry project create <org>/<name> <platform>",
          "Specify team: sentry project create <name> <platform> --team <slug>",
        ]
      );
    }

    if (!platformArg) {
      const list = PLATFORMS.map((p) => `  ${p}`).join("\n");
      throw new ContextError(
        "Platform",
        `sentry project create ${nameArg} <platform>`,
        [
          `Available platforms:\n\n${list}`,
          "Full list: https://docs.sentry.io/platforms/",
        ]
      );
    }

    // Parse name (may include org/ prefix)
    const { org: explicitOrg, name } = parseNameArg(nameArg);

    // Resolve organization
    const resolved = await resolveOrg({ org: explicitOrg, cwd });
    if (!resolved) {
      throw new ContextError(
        "Organization",
        "sentry project create <org>/<name> <platform>",
        [
          "Include org in name: sentry project create <org>/<name> <platform>",
          "Set a default: sentry org view <org>",
          "Run from a directory with a Sentry DSN configured",
        ]
      );
    }
    const orgSlug = resolved.org;

    // Resolve team
    const teamSlug = await resolveTeam(
      orgSlug,
      flags.team,
      resolved.detectedFrom
    );

    // Create the project
    const project = await createProjectWithErrors(
      orgSlug,
      teamSlug,
      name,
      platformArg
    );

    // Fetch DSN (best-effort, non-blocking for output)
    const dsn = await tryGetPrimaryDsn(orgSlug, project.slug);

    // JSON output
    if (flags.json) {
      writeJson(stdout, { ...project, dsn });
      return;
    }

    // Human-readable output
    const url = buildProjectUrl(orgSlug, project.slug);

    stdout.write(`\nCreated project '${project.name}' in ${orgSlug}\n\n`);
    stdout.write(`  Project   ${project.name}\n`);
    stdout.write(`  Slug      ${project.slug}\n`);
    stdout.write(`  Org       ${orgSlug}\n`);
    stdout.write(`  Team      ${teamSlug}\n`);
    stdout.write(`  Platform  ${project.platform || platformArg}\n`);
    if (dsn) {
      stdout.write(`  DSN       ${dsn}\n`);
    }
    stdout.write(`  URL       ${url}\n`);

    writeFooter(
      stdout,
      `Tip: Use 'sentry project view ${orgSlug}/${project.slug}' for details`
    );
  },
});
