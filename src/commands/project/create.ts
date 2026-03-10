/**
 * sentry project create
 *
 * Create a new Sentry project.
 * Supports org/name positional syntax (like `gh repo create owner/repo`).
 *
 * ## Flow
 *
 * 1. Parse name arg → extract org prefix if present (e.g., "acme/my-app")
 * 2. Resolve org → CLI flag > env vars > config defaults > DSN auto-detection
 * 3. Resolve team → `--team` flag > auto-select single team > auto-create if empty
 * 4. Call `createProject` API
 * 5. Fetch DSN (best-effort) and display results
 *
 * When the team is auto-selected or auto-created, the output includes a note
 * so the user knows which team was used and how to change it.
 */

import type { SentryContext } from "../../context.js";
import {
  createProject,
  listTeams,
  tryGetPrimaryDsn,
} from "../../lib/api-client.js";
import { parseOrgProjectArg } from "../../lib/arg-parsing.js";
import { buildCommand } from "../../lib/command.js";
import {
  ApiError,
  CliError,
  ContextError,
  withAuthGuard,
} from "../../lib/errors.js";
import { muted } from "../../lib/formatters/colors.js";
import {
  formatProjectCreated,
  type ProjectCreatedResult,
} from "../../lib/formatters/human.js";
import { writeJson } from "../../lib/formatters/json.js";
import { isPlainOutput } from "../../lib/formatters/markdown.js";
import { buildMarkdownTable, type Column } from "../../lib/formatters/table.js";
import { renderTextTable } from "../../lib/formatters/text-table.js";
import { logger } from "../../lib/logger.js";
import {
  COMMON_PLATFORMS,
  isValidPlatform,
  suggestPlatform,
} from "../../lib/platforms.js";
import { resolveOrg } from "../../lib/resolve-target.js";
import {
  buildOrgNotFoundError,
  type ResolvedTeam,
  resolveOrCreateTeam,
} from "../../lib/resolve-team.js";
import { buildProjectUrl } from "../../lib/sentry-urls.js";
import { slugify } from "../../lib/utils.js";
import type { SentryProject } from "../../types/index.js";

const log = logger.withTag("project.create");

/** Usage hint template — base command without positionals */
const USAGE_HINT = "sentry project create <org>/<name> <platform>";

type CreateFlags = {
  readonly team?: string;
  readonly "dry-run": boolean;
  readonly json: boolean;
  readonly fields?: string[];
};

/** Build a 3-column grid string from a flat list of platforms. */
function platformGrid(items: readonly string[]): string {
  const COLS = 3;
  const rows: string[][] = [];
  for (let i = 0; i < items.length; i += COLS) {
    const row = items.slice(i, i + COLS);
    while (row.length < COLS) {
      row.push("");
    }
    rows.push(row);
  }

  if (isPlainOutput()) {
    const columns: Column<string[]>[] = Array.from(
      { length: COLS },
      (_, ci) => ({
        header: " ",
        value: (row: string[]) => row[ci] ?? "",
      })
    );
    return buildMarkdownTable(rows, columns);
  }

  const [first, ...rest] = rows;
  return renderTextTable(first ?? [], rest, {
    headerSeparator: false,
  });
}

/**
 * Normalize common platform format mistakes.
 *
 * Sentry's SDK guide URLs use dots (e.g., `sentry.io/for/javascript.nextjs`)
 * but platform identifiers use hyphens (`javascript-nextjs`). Users often
 * copy the dot-notation directly. This auto-corrects dots to hyphens and
 * warns via consola logger, following the same pattern as `normalizeFields` in `api.ts`.
 *
 * Safe to auto-correct because the input is already invalid (dots are never
 * valid in platform identifiers) and the correction is unambiguous.
 */
function normalizePlatform(platform: string): string {
  if (!platform.includes(".")) {
    return platform;
  }
  const corrected = platform.replace(/\./g, "-");
  log.warn(
    `Platform '${platform}' uses '.' instead of '-' — interpreting as '${corrected}'`
  );
  return corrected;
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
  const heading = platform
    ? `Invalid platform '${platform}'.`
    : "Platform is required.";

  let didYouMean = "";
  if (platform) {
    const suggestions = suggestPlatform(platform);
    if (suggestions.length > 0) {
      didYouMean = `\nDid you mean?\n${platformGrid(suggestions)}`;
    }
  }

  const platformTable = platformGrid([...COMMON_PLATFORMS]);

  return (
    `${heading}\n` +
    didYouMean +
    "\nUsage:\n" +
    `  sentry project create ${nameArg} <platform>\n\n` +
    `Common platforms:\n\n${platformTable}\n` +
    "Run 'sentry project create <name> <platform>' with any valid Sentry platform identifier."
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
async function handleCreateProject404(opts: {
  orgSlug: string;
  teamSlug: string;
  name: string;
  platform: string;
  detectedFrom?: string;
}): Promise<never> {
  const { orgSlug, teamSlug, name, platform, detectedFrom } = opts;

  const teamsResult = await withAuthGuard(() => listTeams(orgSlug));
  const teams = teamsResult.ok ? teamsResult.value : null;
  const listTeamsError = teamsResult.ok ? null : teamsResult.error;

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
  // Delegates to shared helper that handles DSN org ID resolution and org listing
  if (listTeamsError instanceof ApiError && listTeamsError.status === 404) {
    return await buildOrgNotFoundError(orgSlug, USAGE_HINT, detectedFrom);
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
async function createProjectWithErrors(opts: {
  orgSlug: string;
  teamSlug: string;
  name: string;
  platform: string;
  detectedFrom?: string;
}): Promise<SentryProject> {
  const { orgSlug, teamSlug, name, platform } = opts;
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
        return await handleCreateProject404(opts);
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
      "If omitted, the org is auto-detected from config defaults.\n\n" +
      "Projects are created under a team. If the org has one team, it is used\n" +
      "automatically. If no teams exist, one is created. Otherwise, specify --team.\n\n" +
      "Examples:\n" +
      "  sentry project create my-app node\n" +
      "  sentry project create acme-corp/my-app javascript-nextjs\n" +
      "  sentry project create my-app python-django --team backend\n" +
      "  sentry project create my-app go --json",
  },
  output: {
    json: true,
    human: formatProjectCreated,
    jsonExclude: [
      "slugDiverged",
      "expectedSlug",
      "teamSource",
      "requestedPlatform",
    ],
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
      "dry-run": {
        kind: "boolean",
        brief:
          "Validate inputs and show what would be created without creating it",
        default: false,
      },
    },
    aliases: { t: "team", n: "dry-run" },
  },
  async func(
    this: SentryContext,
    flags: CreateFlags,
    nameArg?: string,
    platformArg?: string
  ) {
    const { cwd } = this;

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

    const platform = normalizePlatform(platformArg);

    if (!isValidPlatform(platform)) {
      throw new CliError(buildPlatformError(nameArg, platform));
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
      ]);
    }
    const orgSlug = resolved.org;

    // Resolve team — auto-creates a team if the org has none (skipped in dry-run)
    const team: ResolvedTeam = await resolveOrCreateTeam(orgSlug, {
      team: flags.team,
      detectedFrom: resolved.detectedFrom,
      usageHint: USAGE_HINT,
      autoCreateSlug: flags["dry-run"] ? undefined : slugify(name),
    });

    // Dry-run mode: show what would be created without creating it
    if (flags["dry-run"]) {
      const { stdout } = this;
      const dryRunData = {
        organization: orgSlug,
        team: team.slug,
        teamSource: team.source,
        name,
        slug: slugify(name),
        platform,
      };

      if (flags.json) {
        writeJson(stdout, dryRunData, flags.fields);
      } else {
        stdout.write(`${muted("Dry run — no project created.")}\n\n`);
        stdout.write(`  Organization:  ${orgSlug}\n`);
        stdout.write(`  Team:          ${team.slug}`);
        if (team.source !== "explicit") {
          stdout.write(` (${team.source})`);
        }
        stdout.write("\n");
        stdout.write(`  Name:          ${name}\n`);
        stdout.write(`  Slug:          ${slugify(name)}\n`);
        stdout.write(`  Platform:      ${platform}\n`);
        stdout.write("\n");
      }
      return;
    }

    // Create the project
    const project = await createProjectWithErrors({
      orgSlug,
      teamSlug: team.slug,
      name,
      platform,
      detectedFrom: resolved.detectedFrom,
    });

    // Fetch DSN (best-effort)
    const dsn = await tryGetPrimaryDsn(orgSlug, project.slug);

    const expectedSlug = slugify(name);

    const result: ProjectCreatedResult = {
      project,
      orgSlug,
      teamSlug: team.slug,
      teamSource: team.source,
      requestedPlatform: platform,
      dsn,
      url: buildProjectUrl(orgSlug, project.slug),
      slugDiverged: project.slug !== expectedSlug,
      expectedSlug,
    };

    return { data: result };
  },
});
