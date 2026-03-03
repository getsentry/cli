/**
 * Team Resolution
 *
 * Resolves which team to use for operations that require one (e.g., project creation).
 * Shared across create commands that need a team in the API path.
 *
 * ## Resolution flow
 *
 * 1. Explicit `--team` flag → use as-is, no validation
 * 2. Fetch org teams via `listTeams`
 *    - On 404: org doesn't exist → resolve effective org via cache, show org list
 *    - On other errors: surface status + generic hint
 * 3. If zero teams → auto-create a team named after the project (slug-based)
 * 4. If exactly one team → auto-select it
 * 5. Filter to teams the user belongs to (`isMember === true`)
 *    - If exactly one member team → auto-select it
 * 6. Multiple candidate teams → error with team list and `--team` hint
 *
 * The auto-created team (step 3) mirrors the Sentry UI behavior where new
 * organizations always have at least one team.
 */

import type { SentryTeam } from "../types/index.js";
import { createTeam, listOrganizations, listTeams } from "./api-client.js";
import {
  ApiError,
  AuthError,
  CliError,
  ContextError,
  ResolutionError,
} from "./errors.js";
import { resolveEffectiveOrg } from "./region.js";
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
  /**
   * Slug to use when auto-creating a team in an empty org.
   * If not provided and the org has zero teams, an error is thrown instead.
   */
  autoCreateSlug?: string;
};

/** Result of team resolution, including how the team was determined */
export type ResolvedTeam = {
  /** The resolved team slug */
  slug: string;
  /** How the team was determined */
  source: "explicit" | "auto-selected" | "auto-created";
};

/**
 * Resolve which team to use for an operation.
 *
 * @param orgSlug - Organization to list teams from
 * @param options - Resolution options (team flag, usage hint, detection source)
 * @returns Resolved team slug with source info
 * @throws {ContextError} When team cannot be resolved
 * @throws {ResolutionError} When org slug returns 404
 */
export async function resolveOrCreateTeam(
  orgSlug: string,
  options: ResolveTeamOptions
): Promise<ResolvedTeam> {
  if (options.team) {
    return { slug: options.team, source: "explicit" };
  }

  let teams: SentryTeam[];
  try {
    teams = await listTeams(orgSlug);
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.status === 404) {
        return await buildOrgFailureError(orgSlug, error, options);
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

  // No teams — auto-create one if a slug was provided
  if (teams.length === 0) {
    if (options.autoCreateSlug) {
      return await autoCreateTeam(orgSlug, options.autoCreateSlug);
    }
    const teamsUrl = `${getSentryBaseUrl()}/settings/${orgSlug}/teams/`;
    throw new ContextError("Team", `${options.usageHint} --team <team-slug>`, [
      `No teams found in org '${orgSlug}'`,
      `Create a team at ${teamsUrl}`,
    ]);
  }

  // Single team — auto-select
  if (teams.length === 1) {
    return { slug: (teams[0] as SentryTeam).slug, source: "auto-selected" };
  }

  // Multiple teams — prefer teams the user belongs to
  const memberTeams = teams.filter((t) => t.isMember === true);
  const candidates = memberTeams.length > 0 ? memberTeams : teams;

  if (candidates.length === 1) {
    return {
      slug: (candidates[0] as SentryTeam).slug,
      source: "auto-selected",
    };
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
 * Auto-create a team in an org that has no teams.
 * Uses the provided slug as the team name.
 */
async function autoCreateTeam(
  orgSlug: string,
  slug: string
): Promise<ResolvedTeam> {
  try {
    const team = await createTeam(orgSlug, slug);
    return { slug: team.slug, source: "auto-created" };
  } catch (error) {
    // Let auth errors propagate so the central handler can trigger auto-login
    if (error instanceof AuthError) {
      throw error;
    }
    // Other failures (permissions, network, etc.) — surface with manual fallback
    throw new CliError(
      `No teams found in org '${orgSlug}' and automatic team creation failed.\n\n` +
        `Create a team manually at ${getSentryBaseUrl()}/settings/${orgSlug}/teams/` +
        (error instanceof ApiError
          ? `\n\nAPI error (${error.status}): ${error.detail ?? error.message}`
          : "")
    );
  }
}

/**
 * Build an error for when listTeams fails (usually a bad org slug).
 * Uses resolveEffectiveOrg for offline validation of DSN org prefixes,
 * then best-effort fetches the user's actual organizations to help them fix it.
 */
async function buildOrgFailureError(
  orgSlug: string,
  _error: ApiError,
  options: ResolveTeamOptions
): Promise<never> {
  // Try resolving DSN-style org IDs (e.g., o1081365 → actual slug)
  const effectiveOrg = await resolveEffectiveOrg(orgSlug);
  if (effectiveOrg !== orgSlug) {
    throw new ResolutionError(
      `Organization '${orgSlug}'`,
      `not found (did you mean '${effectiveOrg}'?)`,
      `${options.usageHint} --team <team-slug>`,
      [`Try using '${effectiveOrg}' as the org slug instead of '${orgSlug}'`]
    );
  }

  const orgHint = await fetchOrgListHint(
    `Specify org explicitly: ${options.usageHint}`
  );

  const suggestions: string[] = [];
  if (options.detectedFrom) {
    suggestions.push(
      `Org '${orgSlug}' was auto-detected from ${options.detectedFrom}`
    );
  }
  suggestions.push(orgHint);

  throw new ResolutionError(
    `Organization '${orgSlug}'`,
    "not found",
    `${options.usageHint} --team <team-slug>`,
    suggestions
  );
}
