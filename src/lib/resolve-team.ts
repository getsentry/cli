/**
 * Team Resolution
 *
 * Resolves which team to use for operations that require one (e.g., project creation).
 * Shared across create commands that need a team in the API path.
 */

import type { SentryTeam } from "../types/index.js";
import { listOrganizations, listTeams } from "./api-client.js";
import { ApiError, ContextError } from "./errors.js";
import { getSentryBaseUrl } from "./sentry-urls.js";

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
      await buildOrgFailureError(orgSlug, error, options);
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

  if (teams.length === 1) {
    return (teams[0] as SentryTeam).slug;
  }

  // Multiple teams — user must specify
  const teamList = teams.map((t) => `  ${t.slug}`).join("\n");
  throw new ContextError(
    "Team",
    `${options.usageHint} --team ${(teams[0] as SentryTeam).slug}`,
    [
      `Multiple teams found in ${orgSlug}. Specify one with --team:\n\n${teamList}`,
    ]
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
  let orgHint = `Specify org explicitly: ${options.usageHint}`;
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
