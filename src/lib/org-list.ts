/**
 * Shared infrastructure for org-scoped list commands (team, repo, project, issue, …).
 *
 * ## Config types
 *
 * Commands that rely entirely on default handlers supply a full {@link OrgListConfig}.
 * Commands that override every mode only need {@link ListCommandMeta} (metadata used
 * for error messages and cursor keys).
 *
 * ## Dispatch
 *
 * {@link dispatchOrgScopedList} merges a map of default handlers with caller-supplied
 * {@link ModeOverrides} using `{ ...defaults, ...overrides }`, then calls the handler
 * for the current parsed target type. This lets any command replace exactly the modes
 * it needs to customise while inheriting the rest.
 *
 * ## Default handler behaviour
 *
 * | Mode           | Default behaviour                                                        |
 * |----------------|--------------------------------------------------------------------------|
 * | auto-detect    | Resolve orgs from DSN/config; fetch from all, then display table         |
 * | explicit       | If `listForProject` provided, use project-scoped fetch; else org-scoped  |
 * | project-search | Find project via `findProjectsBySlug`; use project or org-scoped fetch   |
 * | org-all        | Cursor-paginated single-org listing                                      |
 */

import type { Writer } from "../types/index.js";
import {
  findProjectsBySlug,
  listOrganizations,
  type PaginatedResponse,
} from "./api-client.js";
import type { ParsedOrgProject } from "./arg-parsing.js";
import {
  buildOrgContextKey,
  clearPaginationCursor,
  resolveOrgCursor,
  setPaginationCursor,
} from "./db/pagination.js";
import { AuthError, ContextError, ValidationError } from "./errors.js";
import { writeFooter, writeJson } from "./formatters/index.js";
import { resolveOrgsForListing } from "./resolve-target.js";

// ---------------------------------------------------------------------------
// Config types
// ---------------------------------------------------------------------------

/**
 * Metadata required by all list commands.
 *
 * Commands that override every dispatch mode can provide just this — the
 * metadata is used for cursor storage keys, error messages, and usage hints.
 */
export type ListCommandMeta = {
  /** Key stored in the pagination cursor table (e.g., "team-list") */
  paginationKey: string;
  /** Singular entity name for messages (e.g., "team") */
  entityName: string;
  /** Plural entity name for messages (e.g., "teams") */
  entityPlural: string;
  /** CLI command prefix for hints (e.g., "sentry team list") */
  commandPrefix: string;
};

/** Minimal flags required by the shared infrastructure. */
export type BaseListFlags = {
  readonly limit: number;
  readonly json: boolean;
  readonly cursor?: string;
};

/**
 * Full configuration for an org-scoped list command using default handlers.
 *
 * @template TEntity   Raw entity type from the API (e.g., SentryTeam)
 * @template TWithOrg  Entity with orgSlug attached for display
 */
export type OrgListConfig<TEntity, TWithOrg> = ListCommandMeta & {
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

  /**
   * Fetch entities scoped to a specific project (optional).
   *
   * When provided:
   * - `explicit` mode (`org/project`) fetches project-scoped entities instead
   *   of all entities in the org.
   * - `project-search` mode fetches project-scoped entities after finding the
   *   project via cross-org search.
   *
   * When absent:
   * - `explicit` mode falls back to org-scoped listing with a note that the
   *   entity type is org-scoped and the project part is ignored.
   * - `project-search` mode falls back to org-scoped listing from the found
   *   project's parent org.
   */
  listForProject?: (orgSlug: string, projectSlug: string) => Promise<TEntity[]>;
};

// ---------------------------------------------------------------------------
// Mode handler types
// ---------------------------------------------------------------------------

/** Extract a specific variant from the {@link ParsedOrgProject} union by its `type` discriminant. */
export type ParsedVariant<T extends ParsedOrgProject["type"]> = Extract<
  ParsedOrgProject,
  { type: T }
>;

/**
 * A dispatch handler that receives the correctly-narrowed parsed variant.
 * The dispatcher guarantees `parsed.type` matches the handler key, so
 * callers can safely access variant-specific fields (e.g. `.org`, `.projectSlug`)
 * without runtime checks or manual casts.
 */
export type ModeHandler<
  T extends ParsedOrgProject["type"] = ParsedOrgProject["type"],
> = (parsed: ParsedVariant<T>) => Promise<void>;

/**
 * Complete handler map — one handler per parsed target type.
 * Each handler receives the corresponding {@link ParsedVariant}.
 */
export type ModeHandlerMap = {
  [K in ParsedOrgProject["type"]]: ModeHandler<K>;
};

/**
 * Partial handler map for overriding specific dispatch modes.
 *
 * Provide only the modes you need to customise; the rest will use
 * the default handlers from {@link buildDefaultHandlers}.
 */
export type ModeOverrides = {
  [K in ParsedOrgProject["type"]]?: ModeHandler<K>;
};

// ---------------------------------------------------------------------------
// Type guard
// ---------------------------------------------------------------------------

/**
 * Narrows `ListCommandMeta | OrgListConfig` to a full `OrgListConfig`.
 * Checks for the presence of `listForOrg` which only the full config has.
 */
export function isOrgListConfig<TEntity, TWithOrg>(
  config: ListCommandMeta | OrgListConfig<TEntity, TWithOrg>
): config is OrgListConfig<TEntity, TWithOrg> {
  return "listForOrg" in config;
}

// ---------------------------------------------------------------------------
// Fetch helpers (exported for direct use in tests and commands)
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
 * Fetch entities from all accessible organisations.
 * Skips orgs where the user lacks access (non-auth errors are swallowed).
 */
export async function fetchAllOrgs<TEntity, TWithOrg>(
  config: OrgListConfig<TEntity, TWithOrg>
): Promise<TWithOrg[]> {
  const orgs = await listOrganizations();
  const results = await Promise.all(
    orgs.map((org) => fetchOrgSafe(config, org.slug))
  );
  return results.flat();
}

// ---------------------------------------------------------------------------
// Default handlers
// ---------------------------------------------------------------------------

/** Formats the "next page" hint used in org-all output. */
function nextPageHint(commandPrefix: string, org: string): string {
  return `${commandPrefix} ${org}/ -c last`;
}

/** Options for {@link handleOrgAll}. */
type OrgAllOptions<TEntity, TWithOrg> = {
  config: OrgListConfig<TEntity, TWithOrg>;
  stdout: Writer;
  org: string;
  flags: BaseListFlags;
  contextKey: string;
  cursor: string | undefined;
};

/**
 * Handle org-all mode: cursor-paginated listing for a single org.
 */
export async function handleOrgAll<TEntity, TWithOrg>(
  options: OrgAllOptions<TEntity, TWithOrg>
): Promise<void> {
  const { config, stdout, org, flags, contextKey, cursor } = options;

  const response = await config.listPaginated(org, {
    cursor,
    perPage: flags.limit,
  });

  const { data: rawItems, nextCursor } = response;
  // Attach org context to each entity so displayTable can show the ORG column
  const items = rawItems.map((entity) => config.withOrg(entity, org));
  const hasMore = !!nextCursor;

  if (nextCursor) {
    setPaginationCursor(config.paginationKey, contextKey, nextCursor);
  } else {
    clearPaginationCursor(config.paginationKey, contextKey);
  }

  if (flags.json) {
    const output = hasMore
      ? { data: items, nextCursor, hasMore: true }
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

/** Options for {@link displayFetchedItems}. */
type DisplayFetchedItemsOptions<TEntity, TWithOrg> = {
  config: OrgListConfig<TEntity, TWithOrg>;
  stdout: Writer;
  items: TWithOrg[];
  flags: BaseListFlags;
  /** Human-readable context for "No X found in <label>" messages (e.g. "organization 'my-org'"). */
  contextLabel: string;
  /**
   * Raw org slug for the pagination hint command (e.g. "my-org").
   * When provided and results are truncated, emits a hint like
   * `sentry team list my-org/ for paginated results`.
   * Omit when there is no meaningful paginated target (e.g. project-scoped fetch).
   */
  orgSlugForHint?: string;
};

/**
 * Display a list of entities fetched for a single org or project scope.
 * Shared by handleExplicitOrg and handleExplicitProject.
 */
function displayFetchedItems<TEntity, TWithOrg>(
  opts: DisplayFetchedItemsOptions<TEntity, TWithOrg>
): void {
  const { config, stdout, items, flags, contextLabel, orgSlugForHint } = opts;
  const limited = items.slice(0, flags.limit);

  if (flags.json) {
    writeJson(stdout, limited);
    return;
  }

  if (limited.length === 0) {
    stdout.write(`No ${config.entityPlural} found in ${contextLabel}.\n`);
    return;
  }

  config.displayTable(stdout, limited);

  if (items.length > limited.length) {
    const hint = orgSlugForHint
      ? ` Use '${config.commandPrefix} ${orgSlugForHint}/' for paginated results.`
      : "";
    stdout.write(
      `\nShowing ${limited.length} of ${items.length} ${config.entityPlural}.${hint}\n`
    );
  } else {
    stdout.write(`\nShowing ${limited.length} ${config.entityPlural}\n`);
  }
}

/** Options for {@link handleExplicitOrg}. */
type ExplicitOrgOptions<TEntity, TWithOrg> = {
  config: OrgListConfig<TEntity, TWithOrg>;
  stdout: Writer;
  org: string;
  flags: BaseListFlags;
  /** When true, write a note that the entity type is org-scoped. */
  noteOrgScoped?: boolean;
};

/**
 * Handle a single explicit org (non-paginated fetch).
 * When the config has no `listForProject`, this is also the fallback for
 * explicit `org/project` mode — a subtle note is written to inform the user
 * that the entity type is org-scoped.
 */
export async function handleExplicitOrg<TEntity, TWithOrg>(
  options: ExplicitOrgOptions<TEntity, TWithOrg>
): Promise<void> {
  const { config, stdout, org, flags, noteOrgScoped = false } = options;
  const items = await fetchOrgSafe(config, org);

  if (noteOrgScoped && !flags.json) {
    stdout.write(
      `Note: ${config.entityPlural} are org-scoped. Showing all ${config.entityPlural} in '${org}'.\n\n`
    );
  }

  displayFetchedItems({
    config,
    stdout,
    items,
    flags,
    contextLabel: `organization '${org}'`,
    orgSlugForHint: org,
  });

  if (!flags.json && items.length > 0) {
    writeFooter(
      stdout,
      `Tip: Use '${config.commandPrefix} ${org}/' for paginated results`
    );
  }
}

/** Options for {@link handleExplicitProject}. */
type ExplicitProjectOptions<TEntity, TWithOrg> = {
  config: OrgListConfig<TEntity, TWithOrg>;
  stdout: Writer;
  org: string;
  project: string;
  flags: BaseListFlags;
};

/**
 * Handle explicit `org/project` mode when `listForProject` is available.
 * Fetches entities scoped to the specific project.
 *
 * `config.listForProject` must be defined — callers must guard before calling.
 */
export async function handleExplicitProject<TEntity, TWithOrg>(
  options: ExplicitProjectOptions<TEntity, TWithOrg>
): Promise<void> {
  const { config, stdout, org, project, flags } = options;
  // listForProject is guaranteed defined — callers must check before invoking
  const listForProject = config.listForProject;
  if (!listForProject) {
    throw new Error(
      "handleExplicitProject called but config.listForProject is not defined"
    );
  }
  const raw = await listForProject(org, project);
  const items = raw.map((entity) => config.withOrg(entity, org));

  displayFetchedItems({
    config,
    stdout,
    items,
    flags,
    contextLabel: `project '${org}/${project}'`,
    // No orgSlugForHint: the footer already points to `${org}/` for pagination
  });

  if (!flags.json && items.length > 0) {
    writeFooter(
      stdout,
      `Tip: Use '${config.commandPrefix} ${org}/' to see all ${config.entityPlural} in the org`
    );
  }
}

/**
 * Handle project-search mode (bare slug, e.g., "cli").
 *
 * Searches for a project matching the slug across all accessible orgs via
 * `findProjectsBySlug`. This gives consistent UX with `project list` and
 * `issue list` where a bare slug is always treated as a project slug, not
 * an org slug.
 *
 * If `config.listForProject` is available, fetches entities scoped to each
 * matched project. Otherwise fetches org-scoped entities from the matched
 * project's parent org (since the entity type is org-scoped).
 */
export async function handleProjectSearch<TEntity, TWithOrg>(
  config: OrgListConfig<TEntity, TWithOrg>,
  stdout: Writer,
  projectSlug: string,
  flags: BaseListFlags
): Promise<void> {
  const matches = await findProjectsBySlug(projectSlug);

  if (matches.length === 0) {
    if (flags.json) {
      writeJson(stdout, []);
      return;
    }
    throw new ContextError(
      "Project",
      `No project '${projectSlug}' found in any accessible organization.\n\n` +
        `Try: ${config.commandPrefix} <org>/${projectSlug}`
    );
  }

  let allItems: TWithOrg[];

  if (config.listForProject) {
    const listForProject = config.listForProject;
    // Fetch entities scoped to each matched project in parallel
    const results = await Promise.all(
      matches.map(async (m) => {
        try {
          const raw = await listForProject(m.orgSlug, m.slug);
          return raw.map((entity) => config.withOrg(entity, m.orgSlug));
        } catch (error) {
          if (error instanceof AuthError) {
            throw error;
          }
          return [] as TWithOrg[];
        }
      })
    );
    allItems = results.flat();
  } else {
    // Entity is org-scoped — fetch from each unique parent org
    const uniqueOrgs = [...new Set(matches.map((m) => m.orgSlug))];
    const results = await Promise.all(
      uniqueOrgs.map((org) => fetchOrgSafe(config, org))
    );
    allItems = results.flat();
  }

  const limited = allItems.slice(0, flags.limit);

  if (flags.json) {
    writeJson(stdout, limited);
    return;
  }

  if (limited.length === 0) {
    stdout.write(
      `No ${config.entityPlural} found for project '${projectSlug}'.\n`
    );
    return;
  }

  config.displayTable(stdout, limited);

  if (allItems.length > limited.length) {
    stdout.write(
      `\nShowing ${limited.length} of ${allItems.length} ${config.entityPlural}. Use --limit to show more.\n`
    );
  } else {
    stdout.write(`\nShowing ${limited.length} ${config.entityPlural}\n`);
  }

  if (matches.length > 1) {
    stdout.write(
      `\nFound '${projectSlug}' in ${matches.length} organizations\n`
    );
  }
}

// ---------------------------------------------------------------------------
// Default handler map builder
// ---------------------------------------------------------------------------

/** Options for {@link buildDefaultHandlers}. */
type DefaultHandlerOptions<TEntity, TWithOrg> = {
  config: ListCommandMeta | OrgListConfig<TEntity, TWithOrg>;
  stdout: Writer;
  cwd: string;
  flags: BaseListFlags;
};

/**
 * Build the default `ModeHandlerMap` for the given config and request context.
 *
 * Each handler receives the correctly-narrowed {@link ParsedVariant} for its mode,
 * so it can access variant-specific fields (`.org`, `.projectSlug`) without casts.
 *
 * If `config` is only {@link ListCommandMeta} (not a full {@link OrgListConfig}),
 * each default handler throws when invoked — this only happens if a mode is not
 * covered by the caller's overrides, which would be a programming error.
 */
function buildDefaultHandlers<TEntity, TWithOrg>(
  options: DefaultHandlerOptions<TEntity, TWithOrg>
): ModeHandlerMap {
  const { config, stdout, cwd, flags } = options;

  function notSupported<T extends ParsedOrgProject["type"]>(
    mode: string
  ): ModeHandler<T> {
    return () =>
      Promise.reject(
        new Error(
          `No handler for '${mode}' mode in '${config.commandPrefix}'. ` +
            "Provide a full OrgListConfig or an override for this mode."
        )
      );
  }

  if (!isOrgListConfig(config)) {
    // Metadata-only config — all modes must be overridden by the caller
    return {
      "auto-detect": notSupported("auto-detect"),
      explicit: notSupported("explicit"),
      "project-search": notSupported("project-search"),
      "org-all": notSupported("org-all"),
    };
  }

  return {
    "auto-detect": () => handleAutoDetect(config, stdout, cwd, flags),

    explicit: (parsed) => {
      if (config.listForProject) {
        return handleExplicitProject({
          config,
          stdout,
          org: parsed.org,
          project: parsed.project,
          flags,
        });
      }
      // No project-scoped API — fall back to org listing with a note
      return handleExplicitOrg({
        config,
        stdout,
        org: parsed.org,
        flags,
        noteOrgScoped: true,
      });
    },

    "project-search": (parsed) =>
      handleProjectSearch(config, stdout, parsed.projectSlug, flags),

    "org-all": (parsed) => {
      const contextKey = buildOrgContextKey(parsed.org);
      const cursor = resolveOrgCursor(
        flags.cursor,
        config.paginationKey,
        contextKey
      );
      return handleOrgAll({
        config,
        stdout,
        org: parsed.org,
        flags,
        contextKey,
        cursor,
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

/** Options for {@link dispatchOrgScopedList}. */
export type DispatchOptions<TEntity = unknown, TWithOrg = unknown> = {
  /** Full config (for default handlers) or just metadata (all modes overridden). */
  config: ListCommandMeta | OrgListConfig<TEntity, TWithOrg>;
  stdout: Writer;
  cwd: string;
  flags: BaseListFlags;
  parsed: ParsedOrgProject;
  /**
   * Per-mode handler overrides. Each key matches a `ParsedOrgProject["type"]`.
   * Provided handlers replace the corresponding default handler; unspecified
   * modes fall back to the defaults from {@link buildDefaultHandlers}.
   */
  overrides?: ModeOverrides;
};

/**
 * Validate the cursor flag and dispatch to the correct mode handler.
 *
 * Merges default handlers with caller-provided overrides using
 * `{ ...defaults, ...overrides }`, then invokes `handlers[parsed.type](parsed)`.
 * Each handler receives the correctly-narrowed {@link ParsedVariant} for its mode,
 * eliminating the need for `Extract<>` casts at call sites.
 *
 * This is the single entry point for all org-scoped list commands.
 */
export async function dispatchOrgScopedList<TEntity, TWithOrg>(
  options: DispatchOptions<TEntity, TWithOrg>
): Promise<void> {
  const { config, stdout, cwd, flags, parsed, overrides } = options;

  // Cursor pagination is only supported in org-all mode
  if (flags.cursor && parsed.type !== "org-all") {
    throw new ValidationError(
      `The --cursor flag is only supported when listing ${config.entityPlural} for a specific organization ` +
        `(e.g., ${config.commandPrefix} <org>/). ` +
        `Use '${config.commandPrefix} <org>/' for paginated results.`,
      "cursor"
    );
  }

  const defaults = buildDefaultHandlers({ config, stdout, cwd, flags });
  const handlers: ModeHandlerMap = { ...defaults, ...overrides };

  // TypeScript cannot prove that `parsed` narrows to `ParsedVariant<typeof parsed.type>`
  // through the indexed access `handlers[parsed.type]`, but the handler map guarantees
  // each key maps to a handler expecting exactly that variant.
  // biome-ignore lint/suspicious/noExplicitAny: safe — dispatch guarantees type match
  await (handlers[parsed.type] as ModeHandler<any>)(parsed);
}
