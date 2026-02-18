/**
 * Shared infrastructure for org-scoped list commands (team, repo, etc.).
 *
 * Provides a config-driven framework that eliminates the duplicated patterns
 * across `team/list`, `repo/list`, and partially `project/list`.
 *
 * Each command defines an {@link OrgListConfig} describing how to fetch,
 * augment, and display its entities, then delegates to the shared dispatch
 * and handler functions.
 */

import type { Writer } from "../types/index.js";
import { listOrganizations, type PaginatedResponse } from "./api-client.js";
import type { ParsedOrgProject } from "./arg-parsing.js";
import {
  buildOrgContextKey,
  clearPaginationCursor,
  resolveOrgCursor,
  setPaginationCursor,
} from "./db/pagination.js";
import { AuthError, ValidationError } from "./errors.js";
import { writeFooter, writeJson } from "./formatters/index.js";
import { resolveOrgsForListing } from "./resolve-target.js";

// ---------------------------------------------------------------------------
// Config types
// ---------------------------------------------------------------------------

/** Minimal flags required by the shared infrastructure. */
export type BaseListFlags = {
  readonly limit: number;
  readonly json: boolean;
  readonly cursor?: string;
};

/**
 * Configuration for an org-scoped list command.
 *
 * @template TEntity - Raw entity type from the API (e.g., SentryTeam)
 * @template TWithOrg - Entity with orgSlug attached for display
 */
export type OrgListConfig<TEntity, TWithOrg> = {
  /** Key stored in the pagination cursor table (e.g., "team-list") */
  paginationKey: string;
  /** Singular entity name for messages (e.g., "team") */
  entityName: string;
  /** Plural entity name for messages (e.g., "teams") */
  entityPlural: string;
  /** CLI command prefix for hints (e.g., "sentry team list") */
  commandPrefix: string;

  /**
   * Fetch all entities for one org (non-paginated).
   * @returns Raw entities from the API
   */
  listForOrg: (orgSlug: string) => Promise<TEntity[]>;

  /**
   * Fetch one page of entities for an org (paginated).
   * @returns Paginated response with cursor info
   */
  listPaginated: (
    orgSlug: string,
    opts: { cursor?: string; perPage: number }
  ) => Promise<PaginatedResponse<TEntity[]>>;

  /**
   * Attach org context to a raw entity for display.
   * Typically `{ ...entity, orgSlug }`.
   */
  withOrg: (entity: TEntity, orgSlug: string) => TWithOrg;

  /**
   * Render a list of entities as a formatted table.
   * Called by all human-output paths.
   */
  displayTable: (stdout: Writer, items: TWithOrg[]) => void;
};

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------

/**
 * Fetch entities for a single org, returning empty array on non-auth errors.
 * Auth errors propagate so the user sees "please log in".
 */
export async function fetchOrgSafe<TEntity, TWithOrg>(
  config: OrgListConfig<TEntity, TWithOrg>,
  orgSlug: string
): Promise<TWithOrg[]> {
  try {
    const items = await config.listForOrg(orgSlug);
    return items.map((item) => config.withOrg(item, orgSlug));
  } catch (error) {
    if (error instanceof AuthError) {
      throw error;
    }
    return [];
  }
}

/**
 * Fetch entities from all accessible organizations.
 * Skips orgs where the user lacks access.
 */
export async function fetchAllOrgs<TEntity, TWithOrg>(
  config: OrgListConfig<TEntity, TWithOrg>
): Promise<TWithOrg[]> {
  const orgs = await listOrganizations();
  const results: TWithOrg[] = [];

  for (const org of orgs) {
    try {
      const items = await config.listForOrg(org.slug);
      results.push(...items.map((item) => config.withOrg(item, org.slug)));
    } catch (error) {
      if (error instanceof AuthError) {
        throw error;
      }
      // User may lack access to some orgs
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/** Build the CLI hint for fetching the next page. */
function nextPageHint(commandPrefix: string, org: string): string {
  return `${commandPrefix} ${org}/ -c last`;
}

type OrgAllOptions<TEntity, TWithOrg> = {
  config: OrgListConfig<TEntity, TWithOrg>;
  stdout: Writer;
  org: string;
  flags: BaseListFlags;
  contextKey: string;
  cursor: string | undefined;
};

/**
 * Handle org-all mode (e.g., `sentry team list sentry/`).
 * Uses cursor pagination for efficient page-by-page listing.
 */
export async function handleOrgAll<TEntity, TWithOrg>(
  options: OrgAllOptions<TEntity, TWithOrg>
): Promise<void> {
  const { config, stdout, org, flags, contextKey, cursor } = options;
  const response = await config.listPaginated(org, {
    cursor,
    perPage: flags.limit,
  });

  const items: TWithOrg[] = response.data.map((item) =>
    config.withOrg(item, org)
  );
  const hasMore = !!response.nextCursor;

  // Update cursor cache for `--cursor last` support
  if (response.nextCursor) {
    setPaginationCursor(config.paginationKey, contextKey, response.nextCursor);
  } else {
    clearPaginationCursor(config.paginationKey, contextKey);
  }

  if (flags.json) {
    const output = hasMore
      ? { data: items, nextCursor: response.nextCursor, hasMore: true }
      : { data: items, hasMore: false };
    writeJson(stdout, output);
    return;
  }

  if (items.length === 0) {
    if (hasMore) {
      stdout.write(
        `No ${config.entityPlural} on this page. Try the next page: ${nextPageHint(config.commandPrefix, org)}\n`
      );
    } else {
      stdout.write(
        `No ${config.entityPlural} found in organization '${org}'.\n`
      );
    }
    return;
  }

  config.displayTable(stdout, items);

  if (hasMore) {
    stdout.write(
      `\nShowing ${items.length} ${config.entityPlural} (more available)\n`
    );
    stdout.write(`Next page: ${nextPageHint(config.commandPrefix, org)}\n`);
  } else {
    stdout.write(`\nShowing ${items.length} ${config.entityPlural}\n`);
  }
}

/**
 * Handle auto-detect mode: resolve orgs from config/DSN, fetch all entities.
 */
export async function handleAutoDetect<TEntity, TWithOrg>(
  config: OrgListConfig<TEntity, TWithOrg>,
  stdout: Writer,
  cwd: string,
  flags: BaseListFlags
): Promise<void> {
  const {
    orgs: orgsToFetch,
    footer,
    skippedSelfHosted,
  } = await resolveOrgsForListing(undefined, cwd);

  let allItems: TWithOrg[];
  if (orgsToFetch.length > 0) {
    const results = await Promise.all(
      orgsToFetch.map((org) => fetchOrgSafe(config, org))
    );
    allItems = results.flat();
  } else {
    allItems = await fetchAllOrgs(config);
  }

  const limitCount =
    orgsToFetch.length > 1 ? flags.limit * orgsToFetch.length : flags.limit;
  const limited = allItems.slice(0, limitCount);

  if (flags.json) {
    writeJson(stdout, limited);
    return;
  }

  if (limited.length === 0) {
    const msg =
      orgsToFetch.length === 1
        ? `No ${config.entityPlural} found in organization '${orgsToFetch[0]}'.\n`
        : `No ${config.entityPlural} found.\n`;
    stdout.write(msg);
    return;
  }

  config.displayTable(stdout, limited);

  if (allItems.length > limited.length) {
    stdout.write(
      `\nShowing ${limited.length} of ${allItems.length} ${config.entityPlural}\n`
    );
  }

  if (footer) {
    stdout.write(`\n${footer}\n`);
  }

  if (skippedSelfHosted) {
    stdout.write(
      `\nNote: ${skippedSelfHosted} DSN(s) could not be resolved. ` +
        `Specify the organization explicitly: ${config.commandPrefix} <org>/\n`
    );
  }

  writeFooter(
    stdout,
    `Tip: Use '${config.commandPrefix} <org>/' to filter by organization`
  );
}

/**
 * Handle a single explicit org (non-paginated fetch).
 */
export async function handleExplicitOrg<TEntity, TWithOrg>(
  config: OrgListConfig<TEntity, TWithOrg>,
  stdout: Writer,
  org: string,
  flags: BaseListFlags
): Promise<void> {
  const items = await fetchOrgSafe(config, org);
  const limited = items.slice(0, flags.limit);

  if (flags.json) {
    writeJson(stdout, limited);
    return;
  }

  if (limited.length === 0) {
    stdout.write(`No ${config.entityPlural} found in organization '${org}'.\n`);
    return;
  }

  config.displayTable(stdout, limited);

  if (items.length > limited.length) {
    stdout.write(
      `\nShowing ${limited.length} of ${items.length} ${config.entityPlural}. ` +
        `Use '${config.commandPrefix} ${org}/' for paginated results.\n`
    );
  } else {
    stdout.write(`\nShowing ${limited.length} ${config.entityPlural}\n`);
  }

  writeFooter(
    stdout,
    `Tip: Use '${config.commandPrefix} ${org}/' for paginated results`
  );
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

/** Options for {@link dispatchOrgScopedList}. */
export type DispatchOptions<TEntity, TWithOrg> = {
  config: OrgListConfig<TEntity, TWithOrg>;
  stdout: Writer;
  cwd: string;
  flags: BaseListFlags;
  parsed: ParsedOrgProject;
};

/**
 * Validate cursor flag and dispatch to the correct handler based on the
 * parsed target type. This is the single entry point for org-scoped list
 * commands that follow the standard pattern.
 */
export async function dispatchOrgScopedList<TEntity, TWithOrg>(
  options: DispatchOptions<TEntity, TWithOrg>
): Promise<void> {
  const { config, stdout, cwd, flags, parsed } = options;
  // Cursor pagination is only supported in org-all mode
  if (flags.cursor && parsed.type !== "org-all") {
    throw new ValidationError(
      `The --cursor flag is only supported when listing ${config.entityPlural} for a specific organization ` +
        `(e.g., ${config.commandPrefix} <org>/). ` +
        `Use '${config.commandPrefix} <org>/' for paginated results.`,
      "cursor"
    );
  }

  switch (parsed.type) {
    case "auto-detect":
      await handleAutoDetect(config, stdout, cwd, flags);
      break;

    case "explicit":
      // Use the org context; project part is ignored for this entity listing
      await handleExplicitOrg(config, stdout, parsed.org, flags);
      break;

    case "project-search":
      // Bare slug treated as org slug
      await handleExplicitOrg(config, stdout, parsed.projectSlug, flags);
      break;

    case "org-all": {
      const contextKey = buildOrgContextKey(parsed.org);
      const cursor = resolveOrgCursor(
        flags.cursor,
        config.paginationKey,
        contextKey
      );
      await handleOrgAll({
        config,
        stdout,
        org: parsed.org,
        flags,
        contextKey,
        cursor,
      });
      break;
    }

    default: {
      const _exhaustiveCheck: never = parsed;
      throw new Error(`Unexpected parsed type: ${_exhaustiveCheck}`);
    }
  }
}
