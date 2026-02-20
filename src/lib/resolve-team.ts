/**
 * Team Resolution
 *
 * Resolves which team to use for operations that require one (e.g., project creation).
 * Shared across create commands that need a team in the API path.
 */

import type { SentryTeam } from "../types/index.js";
import { listOrganizations, listTeams } from "./api-client.js";
import { ApiError, CliError, ContextError } from "./errors.js";
import { getSentryBaseUrl } from "./sentry-urls.js";

/**
 * Best-effort fetch the user's organizations and format as a hint string.
 * Returns a fallback hint if the API call fails or no orgs are found.
 *
 * @param fallbackHint - Shown when the org list can't be fetched
 * @returns Formatted org list like "Your organizations:\n\n  acme-corp\n  other-org"
 */
export async function fetchOrgListHint(fallbackHint: string): Promise<string> {
  try {
    const orgs = await listOrganizations();
    if (orgs.length > 0) {
      const orgList = orgs.map((o) => `  ${o.slug}`).join("\n");
      return `Your organizations:\n\n${orgList}`;
    }
  } catch {
    // Best-effort — if this also fails, use the fallback
  }
  return fallbackHint;
}

/** Options for resolving a team within an organization */
export type ResolveTeamOptions = {
  /** Explicit team slug from --team flag */
  team?: string;
  /** Source of the auto-detected org, shown in error messages */
  detectedFrom?: string;
  /** Usage hint shown in error messages (e.g., "sentry project create <org>/<name> <platform>") */
  usageHint: string;
};

/**
 * Resolve which team to use for an operation.
 *
 * Priority:
 * 1. Explicit --team flag — returned as-is, no validation
 * 2. Auto-detect: if org has exactly one team, use it
 * 3. Error with list of available teams
 *
 * When listTeams fails (e.g., bad org slug from auto-detection), the error
 * includes the user's actual organizations so they can fix the command.
 *
 * @param orgSlug - Organization to list teams from
 * @param options - Resolution options (team flag, usage hint, detection source)
 * @returns Team slug to use
 * @throws {ContextError} When team cannot be resolved
 */
export async function resolveTeam(
  orgSlug: string,
  options: ResolveTeamOptions
): Promise<string> {
  if (options.team) {
    return options.team;
  }

  let teams: SentryTeam[];
  try {
    teams = await listTeams(orgSlug);
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.status === 404) {
        await buildOrgFailureError(orgSlug, error, options);
      }
      // 403, 5xx, etc. — can't determine if org is wrong or something else
      throw new CliError(
        `Could not list teams for org '${orgSlug}' (${error.status}).\n\n` +
          "The organization may not exist, or you may lack access.\n\n" +
          `Try: ${options.usageHint} --team <team-slug>`
      );
    }
    throw error;
  }

  if (teams.length === 0) {
    const teamsUrl = `${getSentryBaseUrl()}/settings/${orgSlug}/teams/`;
    throw new ContextError("Team", `${options.usageHint} --team <team-slug>`, [
      `No teams found in org '${orgSlug}'`,
      `Create a team at ${teamsUrl}`,
    ]);
  }

  // Prefer teams the user belongs to — avoids requiring --team in multi-team orgs
  const memberTeams = teams.filter((t) => t.isMember === true);
  const candidates = memberTeams.length > 0 ? memberTeams : teams;

  if (candidates.length === 1) {
    return (candidates[0] as SentryTeam).slug;
  }

  // Multiple candidates — user must specify
  const teamList = candidates.map((t) => `  ${t.slug}`).join("\n");
  const label =
    memberTeams.length > 0
      ? `You belong to ${candidates.length} teams in ${orgSlug}`
      : `Multiple teams found in ${orgSlug}`;
  throw new ContextError(
    "Team",
    `${options.usageHint} --team ${(candidates[0] as SentryTeam).slug}`,
    [`${label}. Specify one with --team:\n\n${teamList}`]
  );
}

/**
 * Build an error for when listTeams fails (usually a bad org slug).
 * Best-effort fetches the user's actual organizations to help them fix it.
 */
async function buildOrgFailureError(
  orgSlug: string,
  error: ApiError,
  options: ResolveTeamOptions
): Promise<never> {
  const orgHint = await fetchOrgListHint(
    `Specify org explicitly: ${options.usageHint}`
  );

  const alternatives = [
    `Could not list teams for org '${orgSlug}' (${error.status})`,
  ];
  if (options.detectedFrom) {
    alternatives.push(
      `Org '${orgSlug}' was auto-detected from ${options.detectedFrom}`
    );
  }
  alternatives.push(orgHint);

  throw new ContextError(
    "Organization",
    `${options.usageHint} --team <team-slug>`,
    alternatives
  );
}
