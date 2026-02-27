/**
 * sentry project create
 *
 * Create a new Sentry project.
 * Supports org/name positional syntax (like `gh repo create owner/repo`).
 */

import type { SentryContext } from "../../context.js";
import {
  createProject,
  listTeams,
  tryGetPrimaryDsn,
} from "../../lib/api-client.js";
import { parseOrgProjectArg } from "../../lib/arg-parsing.js";
import { buildCommand } from "../../lib/command.js";
import { ApiError, CliError, ContextError } from "../../lib/errors.js";
import {
  writeFooter,
  writeJson,
  writeKeyValue,
} from "../../lib/formatters/index.js";
import { resolveOrg } from "../../lib/resolve-target.js";
import { fetchOrgListHint, resolveTeam } from "../../lib/resolve-team.js";
import { buildProjectUrl } from "../../lib/sentry-urls.js";
import type { SentryProject, SentryTeam } from "../../types/index.js";

/** Usage hint template — base command without positionals */
const USAGE_HINT = "sentry project create <org>/<name> <platform>";

type CreateFlags = {
  readonly team?: string;
  readonly json: boolean;
};

/** Common Sentry platform strings, shown when platform arg is missing or invalid */
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
 * Convert a project name to its expected Sentry slug.
 * Aligned with Sentry's canonical implementation:
 * https://github.com/getsentry/sentry/blob/master/static/app/utils/slugify.tsx
 *
 * @example slugify("My Cool App") // "my-cool-app"
 * @example slugify("my-app")      // "my-app"
 * @example slugify("Café Project") // "cafe-project"
 * @example slugify("my_app")      // "my_app"
 */
function slugify(name: string): string {
  return name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9_\s-]/g, "")
    .replace(/[-\s]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Check whether an API error is about an invalid platform value.
 * Relies on Sentry's error message wording — may need updating if the API changes.
 */
function isPlatformError(error: ApiError): boolean {
  const detail = error.detail ?? error.message;
  return detail.includes("platform") && detail.includes("Invalid");
}

/**
 * Build a user-friendly error message for missing or invalid platform.
 *
 * @param nameArg - The name arg (used in the usage example)
 * @param platform - The invalid platform string, if provided
 */
function buildPlatformError(nameArg: string, platform?: string): string {
  const list = PLATFORMS.map((p) => `  ${p}`).join("\n");
  const heading = platform
    ? `Invalid platform '${platform}'.`
    : "Platform is required.";

  return (
    `${heading}\n\n` +
    "Usage:\n" +
    `  sentry project create ${nameArg} <platform>\n\n` +
    `Available platforms:\n\n${list}\n\n` +
    "Full list: https://docs.sentry.io/platforms/"
  );
}

/**
 * Disambiguate a 404 from the create project endpoint.
 *
 * The `/teams/{org}/{team}/projects/` endpoint returns 404 for both
 * a bad org and a bad team. This helper calls `listTeams` to determine
 * which is wrong, then throws an actionable error.
 *
 * Only called on the error path — no cost to the happy path.
 */
async function handleCreateProject404(
  orgSlug: string,
  teamSlug: string,
  name: string,
  platform: string
): Promise<never> {
  let teams: SentryTeam[] | null = null;
  let listTeamsError: unknown = null;

  try {
    teams = await listTeams(orgSlug);
  } catch (error) {
    listTeamsError = error;
  }

  // listTeams succeeded → org is valid, diagnose the team
  if (teams !== null) {
    const teamExists = teams.some((t) => t.slug === teamSlug);
    if (teamExists) {
      // Team is in the list but the create endpoint still returned 404 —
      // likely a permissions issue (rare; Sentry usually returns 403)
      throw new CliError(
        `Failed to create project '${name}' in ${orgSlug}.\n\n` +
          `Team '${teamSlug}' exists but the request was rejected. ` +
          "You may lack permission to create projects in this team."
      );
    }

    if (teams.length > 0) {
      const teamList = teams.map((t) => `  ${t.slug}`).join("\n");
      throw new CliError(
        `Team '${teamSlug}' not found in ${orgSlug}.\n\n` +
          `Available teams:\n\n${teamList}\n\n` +
          "Try:\n" +
          `  sentry project create ${orgSlug}/${name} ${platform} --team <team-slug>`
      );
    }
    throw new CliError(
      `No teams found in ${orgSlug}.\n\n` +
        "Create a team first, then try again."
    );
  }

  // listTeams returned 404 → org doesn't exist
  if (listTeamsError instanceof ApiError && listTeamsError.status === 404) {
    const orgHint = await fetchOrgListHint(
      `Specify org explicitly: ${USAGE_HINT}`
    );
    throw new CliError(`Organization '${orgSlug}' not found.\n\n${orgHint}`);
  }

  // listTeams failed for other reasons (403, 5xx, network) — can't disambiguate
  throw new CliError(
    `Failed to create project '${name}' in ${orgSlug}.\n\n` +
      "The organization or team may not exist, or you may lack access.\n\n" +
      "Try:\n" +
      `  sentry project create ${orgSlug}/${name} ${platform} --team <team-slug>`
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
        const slug = slugify(name);
        throw new CliError(
          `A project named '${name}' already exists in ${orgSlug}.\n\n` +
            `View it: sentry project view ${orgSlug}/${slug}`
        );
      }
      if (error.status === 400 && isPlatformError(error)) {
        throw new CliError(buildPlatformError(`${orgSlug}/${name}`, platform));
      }
      if (error.status === 404) {
        await handleCreateProject404(orgSlug, teamSlug, name, platform);
      }
      throw new CliError(
        `Failed to create project '${name}' in ${orgSlug}.\n\n` +
          `API error (${error.status}): ${error.detail ?? error.message}`
      );
    }
    throw error;
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
          `Use org/name syntax: ${USAGE_HINT}`,
          "Specify team: sentry project create <name> <platform> --team <slug>",
        ]
      );
    }

    if (!platformArg) {
      throw new CliError(buildPlatformError(nameArg));
    }

    const parsed = parseOrgProjectArg(nameArg);

    let explicitOrg: string | undefined;
    let name: string;

    switch (parsed.type) {
      case "explicit":
        explicitOrg = parsed.org;
        name = parsed.project;
        break;
      case "project-search":
        name = parsed.projectSlug;
        break;
      case "org-all":
        throw new ContextError("Project name", USAGE_HINT);
      case "auto-detect":
        // Shouldn't happen — nameArg is a required positional
        throw new ContextError("Project name", USAGE_HINT);
      default: {
        const _exhaustive: never = parsed;
        throw new ContextError("Project name", String(_exhaustive));
      }
    }

    // Resolve organization
    const resolved = await resolveOrg({ org: explicitOrg, cwd });
    if (!resolved) {
      throw new ContextError("Organization", USAGE_HINT, [
        `Include org in name: ${USAGE_HINT}`,
        "Run from a directory with a Sentry DSN configured",
      ]);
    }
    const orgSlug = resolved.org;

    // Resolve team
    const teamSlug = await resolveTeam(orgSlug, {
      team: flags.team,
      detectedFrom: resolved.detectedFrom,
      usageHint: USAGE_HINT,
    });

    // Create the project
    const project = await createProjectWithErrors(
      orgSlug,
      teamSlug,
      name,
      platformArg
    );

    // Fetch DSN (best-effort)
    const dsn = await tryGetPrimaryDsn(orgSlug, project.slug);

    // JSON output
    if (flags.json) {
      writeJson(stdout, { ...project, dsn });
      return;
    }

    // Human-readable output
    const url = buildProjectUrl(orgSlug, project.slug);
    const fields: [string, string][] = [
      ["Project", project.name],
      ["Slug", project.slug],
      ["Org", orgSlug],
      ["Team", teamSlug],
      ["Platform", project.platform || platformArg],
    ];
    if (dsn) {
      fields.push(["DSN", dsn]);
    }
    fields.push(["URL", url]);

    stdout.write(`\nCreated project '${project.name}' in ${orgSlug}\n`);

    // Sentry may adjust the slug to avoid collisions (e.g., "my-app" → "my-app-0g")
    const expectedSlug = slugify(name);
    if (project.slug !== expectedSlug) {
      stdout.write(
        `Note: Slug '${project.slug}' was assigned because '${expectedSlug}' is already taken.\n`
      );
    }

    stdout.write("\n");
    writeKeyValue(stdout, fields);

    writeFooter(
      stdout,
      `Tip: Use 'sentry project view ${orgSlug}/${project.slug}' for details`
    );
  },
});
