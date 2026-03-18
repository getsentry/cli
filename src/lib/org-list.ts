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
 * | auto-detect    | Resolve orgs from DSN/config; fetch from all, return items               |
 * | explicit       | If `listForProject` provided, use project-scoped fetch; else org-scoped  |
 * | project-search | Find project via `findProjectsBySlug`; use project or org-scoped fetch   |
 * | org-all        | Cursor-paginated single-org listing                                      |
 *
 * ## Data flow
 *
 * All handlers return a {@link ListResult} containing items and rendering metadata.
 * The caller (typically {@link buildOrgListCommand} in `list-command.ts`) decides
 * how to render the result — JSON envelope, human table, or custom formatting.
 */

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
import {
  type AuthGuardSuccess,
  ResolutionError,
  ValidationError,
  withAuthGuard,
} from "./errors.js";
import { filterFields } from "./formatters/json.js";
import { logger } from "./logger.js";
import { resolveEffectiveOrg } from "./region.js";
import { resolveOrgsForListing } from "./resolve-target.js";

const log = logger.withTag("org-list");

/**
 * Return type for all org-scoped list handlers.
 *
 * Contains the items plus metadata for rendering (human formatter)
 * and JSON serialization (jsonTransform). The caller decides how to
 * render — handlers never write to stdout directly.
 *
 * @template T - The item type (typically `TWithOrg` with org context)
 */
export type ListResult<T> = {
  /** The items to display */
  items: T[];
  /** Whether more pages are available */
  hasMore?: boolean;
  /** Cursor for fetching the next page (only in paginated modes) */
  nextCursor?: string | null;
  /** Human-readable hint lines (tips, warnings, notes). Suppressed in JSON mode. */
  hint?: string;
  /** Header/title text shown above the table in human mode */
  header?: string;
  /** Fetch errors from partial failures (included in JSON output as `errors` key) */
  errors?: unknown[];
  /** Extra metadata to include in the JSON envelope */
  jsonExtra?: Record<string, unknown>;
};

/**
 * Transform a {@link ListResult} into the standard JSON output format.
 *
 * Paginated responses produce a `{ data, hasMore, nextCursor?, errors?, ... }` envelope.
 * Non-paginated responses produce a flat `[...]` array.
 * Field filtering is applied per-element inside `data`, not to the wrapper.
 *
 * This is the canonical implementation used by all list commands — callers
 * should not duplicate this logic.
 */
export function jsonTransformListResult<T>(
  result: ListResult<T>,
  fields?: string[]
): unknown {
  const items =
    fields && fields.length > 0
      ? result.items.map((item) => filterFields(item, fields))
      : result.items;

  // Paginated mode: wrap in envelope
  if (result.hasMore !== undefined) {
    const envelope: Record<string, unknown> = {
      data: items,
      hasMore: result.hasMore,
    };
    if (
      result.nextCursor !== null &&
      result.nextCursor !== undefined &&
      result.nextCursor !== ""
    ) {
      envelope.nextCursor = result.nextCursor;
    }
    if (result.errors && result.errors.length > 0) {
      envelope.errors = result.errors;
    }
    if (result.jsonExtra) {
      Object.assign(envelope, result.jsonExtra);
    }
    return envelope;
  }

  // Non-paginated: flat array
  return items;
}

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
  /** Pre-parsed field paths from `--fields` (injected by `buildCommand`). */
  readonly fields?: string[];
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
   * Render a list of entities as a formatted table string.
   * Called by the human output path in `buildOrgListCommand`.
   */
  displayTable: (items: TWithOrg[]) => string;

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

/** Extract a specific variant from the {@link ParsedOrgProject} union by its `type` discriminant. */
export type ParsedVariant<T extends ParsedOrgProject["type"]> = Extract<
  ParsedOrgProject,
  { type: T }
>;

/**
 * Context object passed to every mode handler by the dispatcher.
 *
 * Contains the correctly-narrowed parsed variant plus shared I/O and flags,
 * so handlers don't need to close over these values from their parent scope.
 * Commands that need additional fields (e.g. `setContext`, `stderr`) can
 * spread the context and add their own: `(ctx) => handle({ ...ctx, extra })`.
 */
export type HandlerContext<
  T extends ParsedOrgProject["type"] = ParsedOrgProject["type"],
> = {
  /** Correctly-narrowed parsed target for this mode. */
  parsed: ParsedVariant<T>;
  /** Current working directory (for DSN auto-detection). */
  cwd: string;
  /** Shared list command flags (limit, json, cursor). */
  flags: BaseListFlags;
};

/**
 * A dispatch handler that receives a {@link HandlerContext} with the
 * correctly-narrowed parsed variant for its mode.
 *
 * Returns a {@link ListResult} containing items and rendering metadata.
 * The dispatcher guarantees `ctx.parsed.type` matches the handler key, so
 * callers can safely access variant-specific fields (e.g. `.org`, `.projectSlug`)
 * without runtime checks or manual casts.
 */
export type ModeHandler<
  T extends ParsedOrgProject["type"] = ParsedOrgProject["type"],
  TItem = unknown,
> = (ctx: HandlerContext<T>) => Promise<ListResult<TItem>>;

/**
 * Complete handler map — one handler per parsed target type.
 * Each handler receives a {@link HandlerContext} with the corresponding
 * {@link ParsedVariant} and returns a {@link ListResult}.
 */
export type ModeHandlerMap = {
  // biome-ignore lint/suspicious/noExplicitAny: item type varies per command; erased at dispatch
  [K in ParsedOrgProject["type"]]: ModeHandler<K, any>;
};

/**
 * Partial handler map for overriding specific dispatch modes.
 *
 * Provide only the modes you need to customise; the rest will use
 * the default handlers from {@link buildDefaultHandlers}.
 */
export type ModeOverrides = {
  // biome-ignore lint/suspicious/noExplicitAny: item type varies per command; erased at dispatch
  [K in ParsedOrgProject["type"]]?: ModeHandler<K, any>;
};

/**
 * Narrows `ListCommandMeta | OrgListConfig` to a full `OrgListConfig`.
 * Checks for the presence of `listForOrg` which only the full config has.
 */
export function isOrgListConfig<TEntity, TWithOrg>(
  config: ListCommandMeta | OrgListConfig<TEntity, TWithOrg>
): config is OrgListConfig<TEntity, TWithOrg> {
  return "listForOrg" in config;
}

/**
 * Fetch entities for a single org, returning empty array on non-auth errors.
 * Auth errors propagate so the user sees "please log in".
 */
export async function fetchOrgSafe<TEntity, TWithOrg>(
  config: OrgListConfig<TEntity, TWithOrg>,
  orgSlug: string
): Promise<TWithOrg[]> {
  const result = await withAuthGuard(async () => {
    const items = await config.listForOrg(orgSlug);
    return items.map((item) => config.withOrg(item, orgSlug));
  });
  return result.ok ? result.value : [];
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

/** Formats the "next page" hint used in org-all output. */
function nextPageHint(commandPrefix: string, org: string): string {
  return `${commandPrefix} ${org}/ -c last`;
}

/** Options for {@link handleOrgAll}. */
type OrgAllOptions<TEntity, TWithOrg> = {
  config: OrgListConfig<TEntity, TWithOrg>;
  org: string;
  flags: BaseListFlags;
  contextKey: string;
  cursor: string | undefined;
};

/**
 * Run org-all mode for a given org slug.
 *
 * Convenience wrapper around {@link handleOrgAll} used by the project-search
 * fallback when a bare slug turns out to be an organization. Starts a fresh
 * listing (no cursor) for the org.
 */
function runOrgAll<TEntity, TWithOrg>(
  config: OrgListConfig<TEntity, TWithOrg>,
  org: string,
  flags: BaseListFlags
): Promise<ListResult<TWithOrg>> {
  const contextKey = buildOrgContextKey(org);
  return handleOrgAll({ config, org, flags, contextKey, cursor: undefined });
}

/**
 * Handle org-all mode: cursor-paginated listing for a single org.
 *
 * Returns a {@link ListResult} with items, pagination state, and human hints.
 * Cursor side effects (setPaginationCursor/clearPaginationCursor) are performed
 * inside the handler so callers don't need to manage them.
 */
export async function handleOrgAll<TEntity, TWithOrg>(
  options: OrgAllOptions<TEntity, TWithOrg>
): Promise<ListResult<TWithOrg>> {
  const { config, org, flags, contextKey, cursor } = options;

  const response = await config.listPaginated(org, {
    cursor,
    perPage: flags.limit,
  });

  const { data: rawItems, nextCursor } = response;
  const items = rawItems.map((entity) => config.withOrg(entity, org));
  const hasMore = !!nextCursor;

  if (nextCursor) {
    setPaginationCursor(config.paginationKey, contextKey, nextCursor);
  } else {
    clearPaginationCursor(config.paginationKey, contextKey);
  }

  // Empty results use hint (rendered by human formatter directly).
  // Non-empty results use header (rendered inline after the table).
  let hint: string | undefined;
  let header: string | undefined;

  if (items.length === 0) {
    if (hasMore) {
      hint = `No ${config.entityPlural} on this page. Try the next page: ${nextPageHint(config.commandPrefix, org)}`;
    } else {
      hint = `No ${config.entityPlural} found in organization '${org}'.`;
    }
  } else if (hasMore) {
    header = `Showing ${items.length} ${config.entityPlural} (more available)\nNext page: ${nextPageHint(config.commandPrefix, org)}`;
  } else {
    header = `Showing ${items.length} ${config.entityPlural}`;
  }

  return {
    items,
    hasMore,
    nextCursor: nextCursor ?? null,
    hint,
    header,
  };
}

/**
 * Handle auto-detect mode: resolve orgs from config/DSN, fetch all entities.
 *
 * Returns a {@link ListResult} with the merged items from all resolved orgs.
 */
export async function handleAutoDetect<TEntity, TWithOrg>(
  config: OrgListConfig<TEntity, TWithOrg>,
  cwd: string,
  flags: BaseListFlags
): Promise<ListResult<TWithOrg>> {
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

  const hintParts: string[] = [];

  if (limited.length === 0) {
    const msg =
      orgsToFetch.length === 1
        ? `No ${config.entityPlural} found in organization '${orgsToFetch[0]}'.`
        : `No ${config.entityPlural} found.`;
    hintParts.push(msg);
  }

  if (allItems.length > limited.length) {
    hintParts.push(
      `Showing ${limited.length} of ${allItems.length} ${config.entityPlural}`
    );
  }

  if (footer) {
    hintParts.push(footer);
  }

  if (skippedSelfHosted) {
    hintParts.push(
      `Note: ${skippedSelfHosted} DSN(s) could not be resolved. ` +
        `Specify the organization explicitly: ${config.commandPrefix} <org>/`
    );
  }

  if (limited.length > 0) {
    hintParts.push(
      `Tip: Use '${config.commandPrefix} <org>/' to filter by organization`
    );
  }

  return {
    items: limited,
    hint: hintParts.length > 0 ? hintParts.join("\n") : undefined,
  };
}

/** Options for {@link buildFetchedItemsResult}. */
type FetchedItemsOptions<TEntity, TWithOrg> = {
  config: OrgListConfig<TEntity, TWithOrg>;
  items: TWithOrg[];
  flags: BaseListFlags;
  /** Human-readable context for "No X found in <label>" messages. */
  contextLabel: string;
  /**
   * Raw org slug for the pagination hint command (e.g. "my-org").
   * When provided and results are truncated, emits a hint like
   * `sentry team list my-org/ for paginated results`.
   */
  orgSlugForHint?: string;
};

/**
 * Build a {@link ListResult} for entities fetched for a single org or project scope.
 * Shared by handleExplicitOrg and handleExplicitProject.
 */
function buildFetchedItemsResult<TEntity, TWithOrg>(
  opts: FetchedItemsOptions<TEntity, TWithOrg>
): ListResult<TWithOrg> {
  const { config, items, flags, contextLabel, orgSlugForHint } = opts;
  const limited = items.slice(0, flags.limit);

  if (limited.length === 0) {
    return {
      items: [],
      hint: `No ${config.entityPlural} found in ${contextLabel}.`,
    };
  }

  const hintParts: string[] = [];
  if (items.length > limited.length) {
    const paginationHint = orgSlugForHint
      ? ` Use '${config.commandPrefix} ${orgSlugForHint}/' for paginated results.`
      : "";
    hintParts.push(
      `Showing ${limited.length} of ${items.length} ${config.entityPlural}.${paginationHint}`
    );
  } else {
    hintParts.push(`Showing ${limited.length} ${config.entityPlural}`);
  }

  return {
    items: limited,
    hint: hintParts.join("\n"),
  };
}

/** Options for {@link handleExplicitOrg}. */
type ExplicitOrgOptions<TEntity, TWithOrg> = {
  config: OrgListConfig<TEntity, TWithOrg>;
  org: string;
  flags: BaseListFlags;
  /** When true, include a note that the entity type is org-scoped. */
  noteOrgScoped?: boolean;
};

/**
 * Handle a single explicit org (non-paginated fetch).
 *
 * When the config has no `listForProject`, this is also the fallback for
 * explicit `org/project` mode — a note is included to inform the user
 * that the entity type is org-scoped.
 *
 * Returns a {@link ListResult} with items and contextual hints.
 */
export async function handleExplicitOrg<TEntity, TWithOrg>(
  options: ExplicitOrgOptions<TEntity, TWithOrg>
): Promise<ListResult<TWithOrg>> {
  const { config, org, flags, noteOrgScoped = false } = options;
  const items = await fetchOrgSafe(config, org);

  const result = buildFetchedItemsResult({
    config,
    items,
    flags,
    contextLabel: `organization '${org}'`,
  });

  // Org-scoped note goes in header so it renders as plain text (not muted).
  if (noteOrgScoped) {
    const note = `Note: ${config.entityPlural} are org-scoped. Showing all ${config.entityPlural} in '${org}'.`;
    result.header = result.header ? `${note}\n${result.header}` : note;
  }

  if (items.length > 0) {
    const tip = `Tip: Use '${config.commandPrefix} ${org}/' for paginated results`;
    result.hint = result.hint ? `${result.hint}\n${tip}` : tip;
  }

  return result;
}

/** Options for {@link handleExplicitProject}. */
type ExplicitProjectOptions<TEntity, TWithOrg> = {
  config: OrgListConfig<TEntity, TWithOrg>;
  org: string;
  project: string;
  flags: BaseListFlags;
};

/**
 * Handle explicit `org/project` mode when `listForProject` is available.
 * Fetches entities scoped to the specific project.
 *
 * `config.listForProject` must be defined — callers must guard before calling.
 *
 * Returns a {@link ListResult} with items and hint text.
 */
export async function handleExplicitProject<TEntity, TWithOrg>(
  options: ExplicitProjectOptions<TEntity, TWithOrg>
): Promise<ListResult<TWithOrg>> {
  const { config, org, project, flags } = options;
  const listForProject = config.listForProject;
  if (!listForProject) {
    throw new Error(
      "handleExplicitProject called but config.listForProject is not defined"
    );
  }
  const raw = await listForProject(org, project);
  const items = raw.map((entity) => config.withOrg(entity, org));

  const result = buildFetchedItemsResult({
    config,
    items,
    flags,
    contextLabel: `project '${org}/${project}'`,
  });

  if (items.length > 0) {
    const tip = `Tip: Use '${config.commandPrefix} ${org}/' to see all ${config.entityPlural} in the org`;
    result.hint = result.hint ? `${result.hint}\n${tip}` : tip;
  }

  return result;
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
 *
 * @param orgAllFallback - Optional callback invoked when the slug matches
 *   an organization instead of a project. Receives the org slug and should
 *   delegate to the org-all handler. When not provided, a helpful error is
 *   thrown instead.
 *
 * Returns a {@link ListResult} with items and hint text.
 */
export async function handleProjectSearch<TEntity, TWithOrg>(
  config: OrgListConfig<TEntity, TWithOrg>,
  projectSlug: string,
  options: {
    flags: BaseListFlags;
    orgAllFallback?: (orgSlug: string) => Promise<ListResult<TWithOrg>>;
  }
): Promise<ListResult<TWithOrg>> {
  const { flags, orgAllFallback } = options;
  const { projects: matches, orgs } = await findProjectsBySlug(projectSlug);

  if (matches.length === 0) {
    const matchingOrg = orgs.find((o) => o.slug === projectSlug);
    if (matchingOrg) {
      if (orgAllFallback) {
        log.warn(
          `'${projectSlug}' is an organization, not a project. ` +
            `Listing all ${config.entityPlural} in '${projectSlug}'.`
        );
        return orgAllFallback(projectSlug);
      }
      throw new ResolutionError(
        `'${projectSlug}'`,
        "is an organization, not a project",
        `${config.commandPrefix} ${projectSlug}/`,
        [
          `List projects: sentry project list ${projectSlug}/`,
          `Specify a project: ${config.commandPrefix} ${projectSlug}/<project>`,
        ]
      );
    }

    if (flags.json) {
      return { items: [] };
    }
    // Use ResolutionError — the user provided a project slug but it wasn't found.
    throw new ResolutionError(
      `Project '${projectSlug}'`,
      "not found",
      `${config.commandPrefix} <org>/${projectSlug}`,
      ["No project with this slug found in any accessible organization"]
    );
  }

  let allItems: TWithOrg[];

  if (config.listForProject) {
    const listForProject = config.listForProject;
    const results = await Promise.all(
      matches.map((m) =>
        withAuthGuard(async () => {
          const raw = await listForProject(m.orgSlug, m.slug);
          return raw.map((entity) => config.withOrg(entity, m.orgSlug));
        })
      )
    );
    allItems = results
      .filter((r): r is AuthGuardSuccess<TWithOrg[]> => r.ok)
      .flatMap((r) => r.value);
  } else {
    const uniqueOrgs = [...new Set(matches.map((m) => m.orgSlug))];
    const results = await Promise.all(
      uniqueOrgs.map((org) => fetchOrgSafe(config, org))
    );
    allItems = results.flat();
  }

  const limited = allItems.slice(0, flags.limit);

  if (limited.length === 0) {
    return {
      items: [],
      hint: `No ${config.entityPlural} found for project '${projectSlug}'.`,
    };
  }

  const hintParts: string[] = [];
  if (allItems.length > limited.length) {
    hintParts.push(
      `Showing ${limited.length} of ${allItems.length} ${config.entityPlural}. Use --limit to show more.`
    );
  } else {
    hintParts.push(`Showing ${limited.length} ${config.entityPlural}`);
  }

  if (matches.length > 1) {
    hintParts.push(`Found '${projectSlug}' in ${matches.length} organizations`);
  }

  return {
    items: limited,
    hint: hintParts.join("\n"),
  };
}

/**
 * Build the default `ModeHandlerMap` for the given config.
 *
 * Each handler receives a {@link HandlerContext} with the correctly-narrowed
 * parsed variant, so it can access variant-specific fields without casts.
 *
 * If `config` is only {@link ListCommandMeta} (not a full {@link OrgListConfig}),
 * each default handler throws when invoked — this only happens if a mode is not
 * covered by the caller's overrides, which would be a programming error.
 */
function buildDefaultHandlers<TEntity, TWithOrg>(
  config: ListCommandMeta | OrgListConfig<TEntity, TWithOrg>
): ModeHandlerMap {
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
    return {
      "auto-detect": notSupported("auto-detect"),
      explicit: notSupported("explicit"),
      "project-search": notSupported("project-search"),
      "org-all": notSupported("org-all"),
    };
  }

  return {
    "auto-detect": (ctx) => handleAutoDetect(config, ctx.cwd, ctx.flags),

    explicit: (ctx) => {
      if (config.listForProject) {
        return handleExplicitProject({
          config,
          org: ctx.parsed.org,
          project: ctx.parsed.project,
          flags: ctx.flags,
        });
      }
      return handleExplicitOrg({
        config,
        org: ctx.parsed.org,
        flags: ctx.flags,
        noteOrgScoped: true,
      });
    },

    "project-search": (ctx) =>
      handleProjectSearch(config, ctx.parsed.projectSlug, {
        flags: ctx.flags,
        orgAllFallback: (orgSlug) => runOrgAll(config, orgSlug, ctx.flags),
      }),

    "org-all": (ctx) => {
      const contextKey = buildOrgContextKey(ctx.parsed.org);
      const cursor = resolveOrgCursor(
        ctx.flags.cursor,
        config.paginationKey,
        contextKey
      );
      return handleOrgAll({
        config,
        org: ctx.parsed.org,
        flags: ctx.flags,
        contextKey,
        cursor,
      });
    },
  };
}

/** Options for {@link dispatchOrgScopedList}. */
export type DispatchOptions<TEntity = unknown, TWithOrg = unknown> = {
  /** Full config (for default handlers) or just metadata (all modes overridden). */
  config: ListCommandMeta | OrgListConfig<TEntity, TWithOrg>;
  cwd: string;
  flags: BaseListFlags;
  parsed: ParsedOrgProject;
  /**
   * Per-mode handler overrides. Each key matches a `ParsedOrgProject["type"]`.
   * Provided handlers replace the corresponding default handler; unspecified
   * modes fall back to the defaults from {@link buildDefaultHandlers}.
   */
  overrides?: ModeOverrides;
  /**
   * Mode types that support cursor pagination in addition to `"org-all"`.
   *
   * By default, `--cursor` is rejected in all non-`"org-all"` modes. Callers
   * that implement their own cursor handling (e.g. compound cursors in
   * `issue list`) can list those mode types here to bypass the guard.
   */
  allowCursorInModes?: readonly ParsedOrgProject["type"][];
};

/**
 * Validate the cursor flag and dispatch to the correct mode handler.
 *
 * Builds a {@link HandlerContext} from the shared fields (cwd, flags,
 * parsed) and passes it to the resolved handler. Merges default handlers
 * with caller-provided overrides using `{ ...defaults, ...overrides }`.
 *
 * Returns the {@link ListResult} from the resolved handler. The caller is
 * responsible for rendering (JSON or human output).
 *
 * This is the single entry point for all org-scoped list commands.
 */
export async function dispatchOrgScopedList<TEntity, TWithOrg>(
  options: DispatchOptions<TEntity, TWithOrg>
  // biome-ignore lint/suspicious/noExplicitAny: TWithOrg varies per command; callers narrow the return type
): Promise<ListResult<any>> {
  const { config, cwd, flags, parsed, overrides } = options;

  const cursorAllowedModes: readonly ParsedOrgProject["type"][] = [
    "org-all",
    ...(options.allowCursorInModes ?? []),
  ];
  if (flags.cursor && !cursorAllowedModes.includes(parsed.type)) {
    const hint =
      parsed.type === "project-search"
        ? `\n\nDid you mean '${config.commandPrefix} ${parsed.projectSlug}/'? ` +
          `A bare name searches for a project — add a trailing slash to list an org's ${config.entityPlural}.`
        : "";
    throw new ValidationError(
      "The --cursor flag requires the <org>/ pattern " +
        `(e.g., ${config.commandPrefix} my-org/).` +
        hint,
      "cursor"
    );
  }

  let effectiveParsed: ParsedOrgProject = parsed;
  if (parsed.type === "explicit" || parsed.type === "org-all") {
    const effectiveOrg = await resolveEffectiveOrg(parsed.org);
    if (effectiveOrg !== parsed.org) {
      effectiveParsed = { ...parsed, org: effectiveOrg };
    }
  }

  const defaults = buildDefaultHandlers(config);
  const handlers: ModeHandlerMap = { ...defaults, ...overrides };
  const handler = handlers[effectiveParsed.type];

  const ctx: HandlerContext = {
    parsed: effectiveParsed,
    cwd,
    flags,
  };

  // biome-ignore lint/suspicious/noExplicitAny: safe — dispatch guarantees type match
  return (handler as ModeHandler<any>)(ctx);
}
