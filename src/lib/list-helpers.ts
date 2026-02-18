/**
 * List Command Helpers
 *
 * Shared factory and utilities for all `sentry * list` commands.
 *
 * The main export is `listCommand`, a factory that wraps Stricli's `buildCommand`
 * and injects common flags (--limit, --json, optionally --query/--sort/--cursor/--follow),
 * manages the output pipeline (JSON vs human), and handles cursor pagination storage.
 *
 * Supporting helpers:
 * - `fetchFromOrgs`          — parallel multi-org fetch with graceful per-org error handling
 * - `resolveOrgsForList`     — org resolution chain: explicit → config default → DSN auto-detect
 * - `resolveSingleTarget`    — single org+project resolution for commands like trace/log list
 * - `makeValidateLimit`      — range-checked limit parser for commands that need min/max
 * - `writeSelfHostedWarning` — standard warning for unresolvable self-hosted DSNs
 * - `resolveCursorFlag`      — resolve "--cursor last" from SQLite cache
 * - `updateCursorCache`      — store/clear next-page cursor after each paginated fetch
 */

import type { Command } from "@stricli/core";
import type { SentryContext } from "../context.js";
import type { Writer } from "../types/index.js";
import { findProjectsBySlug, listOrganizations } from "./api-client.js";
import { parseOrgProjectArg } from "./arg-parsing.js";
import { buildCommand, numberParser } from "./command.js";
import { getDefaultOrganization } from "./db/defaults.js";
import {
  clearPaginationCursor,
  getPaginationCursor,
  setPaginationCursor,
} from "./db/pagination.js";
import { AuthError, ContextError } from "./errors.js";
import { writeFooter, writeJson } from "./formatters/index.js";
import { resolveAllTargets, resolveOrgAndProject } from "./resolve-target.js";

// ─── Multi-org fetch helpers ──────────────────────────────────────────────────

/** Result of resolving orgs for a list command */
export type OrgResolution = {
  /** Org slugs to fetch from. Empty means "fetch all accessible orgs". */
  orgSlugs: string[];
  /** DSN detection footer (e.g. "Detected from .env.local") */
  footer?: string;
  /** Number of self-hosted DSNs that couldn't be resolved */
  skippedSelfHosted?: number;
};

/**
 * Resolve which organizations to fetch from.
 *
 * Resolution priority:
 * 1. Explicit org slug from positional arg
 * 2. Config default org
 * 3. DSN auto-detection (may yield multiple orgs in monorepos)
 * 4. Empty list → caller should list all accessible orgs
 *
 * @param explicitOrg - Org slug from CLI positional arg (optional)
 * @param cwd - Current working directory for DSN detection
 */
export async function resolveOrgsForList(
  explicitOrg: string | undefined,
  cwd: string
): Promise<OrgResolution> {
  if (explicitOrg) {
    return { orgSlugs: [explicitOrg] };
  }

  const defaultOrg = await getDefaultOrganization();
  if (defaultOrg) {
    return { orgSlugs: [defaultOrg] };
  }

  try {
    const { targets, footer, skippedSelfHosted } = await resolveAllTargets({
      cwd,
    });

    if (targets.length > 0) {
      const uniqueOrgs = [...new Set(targets.map((t) => t.org))];
      return { orgSlugs: uniqueOrgs, footer, skippedSelfHosted };
    }

    return { orgSlugs: [], skippedSelfHosted };
  } catch (error) {
    if (error instanceof AuthError) {
      throw error;
    }
  }

  return { orgSlugs: [] };
}

type FetchFromOrgsOptions<T> = {
  /**
   * Org slugs to fetch from, or `"all"` to list every accessible org first.
   * When `"all"`, calls `listOrganizations()` then fetches from each in parallel.
   */
  orgSlugs: string[] | "all";
  /**
   * Fetch items for a single org.
   * The returned items will have `orgSlug` merged in by the caller.
   */
  fetcher: (orgSlug: string) => Promise<T[]>;
};

/**
 * Fetch items from one or more orgs in parallel with graceful per-org error handling.
 *
 * - Re-throws `AuthError` immediately (user must re-login)
 * - Silently swallows other per-org errors (permission denied, 404, etc.)
 * - When `orgSlugs` is `"all"`, lists all accessible orgs first then fetches in parallel
 *
 * This replaces the copy-pasted `fetchOrgXxxSafe` + `fetchAllOrgXxx` families.
 */
export async function fetchFromOrgs<T>(
  options: FetchFromOrgsOptions<T>
): Promise<T[]> {
  const { fetcher } = options;

  let orgSlugs: string[];
  if (options.orgSlugs === "all") {
    const orgs = await listOrganizations();
    orgSlugs = orgs.map((o) => o.slug);
  } else {
    orgSlugs = options.orgSlugs;
  }

  const results = await Promise.all(
    orgSlugs.map(async (orgSlug) => {
      try {
        return await fetcher(orgSlug);
      } catch (error) {
        if (error instanceof AuthError) {
          throw error;
        }
        return [];
      }
    })
  );

  return results.flat();
}

// ─── Single-project target resolution ────────────────────────────────────────

/** Resolved org + project for single-project commands (trace list, log list) */
export type ResolvedSingleTarget = {
  org: string;
  project: string;
};

/**
 * Resolve a single org+project target for commands that operate on exactly one project.
 *
 * Handles all four parsed argument types:
 * - `explicit`: use org/project directly
 * - `org-all`: reject with helpful message
 * - `project-search`: find project across all orgs, reject if ambiguous
 * - `auto-detect`: use DSN detection / config defaults
 *
 * @param target - Raw positional argument (e.g. "my-org/my-project", "my-project")
 * @param cwd - Working directory for DSN auto-detection
 * @param commandName - Used in error messages (e.g. "sentry trace list")
 */
export async function resolveSingleTarget(
  target: string | undefined,
  cwd: string,
  commandName: string
): Promise<ResolvedSingleTarget> {
  const usageHint = `${commandName} <org>/<project>`;
  const parsed = parseOrgProjectArg(target);

  switch (parsed.type) {
    case "explicit": {
      return { org: parsed.org, project: parsed.project };
    }

    case "org-all": {
      throw new ContextError(
        "Project",
        `Please specify a project: ${commandName} ${parsed.org}/<project>`
      );
    }

    case "project-search": {
      const matches = await findProjectsBySlug(parsed.projectSlug);

      if (matches.length === 0) {
        throw new ContextError(
          "Project",
          `No project '${parsed.projectSlug}' found in any accessible organization.\n\n` +
            `Try: ${commandName} <org>/${parsed.projectSlug}`
        );
      }

      if (matches.length > 1) {
        const suggestions = matches
          .map((m) => `  ${commandName} ${m.orgSlug}/${m.slug}`)
          .join("\n");
        throw new ContextError(
          "Project",
          `Found '${parsed.projectSlug}' in ${matches.length} organizations. Please specify:\n${suggestions}`
        );
      }

      // matches.length === 1 checked above
      const match = matches[0] as (typeof matches)[number];
      return { org: match.orgSlug, project: match.slug };
    }

    case "auto-detect": {
      const resolved = await resolveOrgAndProject({ cwd, usageHint });
      if (!resolved) {
        throw new ContextError("Organization and project", usageHint);
      }
      return { org: resolved.org, project: resolved.project };
    }

    default: {
      const _exhaustive: never = parsed;
      throw new Error(`Unexpected parsed type: ${_exhaustive}`);
    }
  }
}

// ─── Limit validation ─────────────────────────────────────────────────────────

/**
 * Build a range-checked limit parser for Stricli `kind: "parsed"` flags.
 *
 * Returns a parse function that validates the raw string input against
 * `[min, max]` and throws a descriptive error if out of range.
 *
 * @param min - Minimum allowed value (inclusive)
 * @param max - Maximum allowed value (inclusive)
 */
export function makeValidateLimit(
  min: number,
  max: number
): (value: string) => number {
  return (value: string): number => {
    const num = Number.parseInt(value, 10);
    if (Number.isNaN(num) || num < min || num > max) {
      throw new Error(`--limit must be between ${min} and ${max}`);
    }
    return num;
  };
}

// ─── Output helpers ───────────────────────────────────────────────────────────

/**
 * Write the standard self-hosted DSN warning to stdout.
 *
 * Shown when DSN auto-detection found self-hosted Sentry DSNs that couldn't be
 * resolved (because the user isn't authenticated against that instance).
 *
 * @param stdout - Output writer
 * @param skippedSelfHosted - Number of unresolvable DSNs (no-op if falsy)
 * @param commandExample - Example command to suggest (e.g. "sentry team list <org>")
 */
export function writeSelfHostedWarning(
  stdout: Writer,
  skippedSelfHosted: number | undefined,
  commandExample: string
): void {
  if (skippedSelfHosted) {
    stdout.write(
      `\nNote: ${skippedSelfHosted} DSN(s) could not be resolved. ` +
        `Specify the organization explicitly: ${commandExample}\n`
    );
  }
}

// ─── Cursor helpers ───────────────────────────────────────────────────────────

/**
 * Resolve the `--cursor` flag value.
 * The magic value `"last"` looks up the cached cursor from the previous page.
 *
 * @param cursorFlag - Raw value from `--cursor` flag
 * @param paginationKey - Command key for SQLite cursor storage (e.g. "project-list")
 * @param contextKey - Serialized query context to namespace cursors per query
 */
export function resolveCursorFlag(
  cursorFlag: string | undefined,
  paginationKey: string,
  contextKey: string
): string | undefined {
  if (!cursorFlag) {
    return;
  }
  if (cursorFlag !== "last") {
    return cursorFlag;
  }

  const cached = getPaginationCursor(paginationKey, contextKey);
  if (!cached) {
    throw new ContextError(
      "Pagination cursor",
      "No saved cursor for this query. Run without --cursor first."
    );
  }
  return cached;
}

/**
 * Update the stored pagination cursor after a paginated fetch.
 * Stores the next cursor if there are more pages, clears it otherwise.
 *
 * @param nextCursor - Cursor returned from API (undefined = no more pages)
 * @param paginationKey - Command key for SQLite cursor storage
 * @param contextKey - Serialized query context
 */
export function updateCursorCache(
  nextCursor: string | undefined,
  paginationKey: string,
  contextKey: string
): void {
  if (nextCursor) {
    setPaginationCursor(paginationKey, contextKey, nextCursor);
  } else {
    clearPaginationCursor(paginationKey, contextKey);
  }
}

// ─── listCommand factory ──────────────────────────────────────────────────────

/**
 * Result returned by a list command's `fetch` callback.
 * The factory uses this to drive the output pipeline.
 */
export type ListResult<T> = {
  /** Items to display */
  items: T[];
  /**
   * Total count before client-side slicing (for "Showing N of M" message).
   * If omitted, no truncation message is shown.
   */
  total?: number;
  /** Whether more items exist beyond the current page (enables cursor hint) */
  hasMore?: boolean;
  /** Next-page cursor returned from the API */
  nextCursor?: string;
  /**
   * DSN detection footer to show after the table
   * (e.g. "Detected from .env.local")
   */
  footer?: string;
  /** Number of self-hosted DSNs that couldn't be resolved */
  skippedSelfHosted?: number;
  /**
   * Optional header line written before render() is called (human mode only).
   * Use this to include dynamic context (e.g., "Recent traces in org/project:").
   */
  header?: string;
};

/** Feature flags that opt a command into optional behaviours */
type ListFeatures = {
  /**
   * Add `--query` / `-q` flag.
   * The parsed value is passed to the `fetch` callback via `flags.query`.
   */
  query?: boolean;
  /**
   * Add `--sort` / `-s` flag.
   * Provide the array of accepted values; the flag validates against them.
   * The first value is used as the default.
   */
  sort?: readonly string[];
  /**
   * Add `--cursor` / `-c` flag for cursor-based pagination.
   * Requires `paginationKey` and `buildContextKey` to be set.
   */
  cursor?: boolean;
  /**
   * Add `--follow` / `-f` flag (streaming mode).
   * The factory performs the initial `fetch`, then calls the `follow` callback.
   */
  follow?: boolean;
};

/**
 * Base flags always present on every list command.
 */
type BaseListFlags = {
  readonly limit: number;
  readonly json: boolean;
};

/**
 * Full resolved flags type including all optional feature flags.
 */
export type FullListFlags = BaseListFlags & {
  readonly query?: string;
  readonly sort?: string;
  readonly cursor?: string;
  readonly follow?: number;
};

/** Extra command-specific flag definition */
type ExtraFlagDef = {
  kind: "boolean" | "parsed" | "counter" | "enum";
  brief: string;
  parse?: (value: string) => unknown;
  default?: string | boolean;
  optional?: boolean;
  inferEmpty?: boolean;
};

/** Map of extra command-specific flags */
type ExtraFlags = Record<string, ExtraFlagDef>;

/**
 * Configuration for `listCommand`.
 *
 * @template T - The item type returned by `fetch` and passed to `render`
 * @template EXTRA - Extra flag names beyond the standard set
 */
type ListCommandConfig<T, EXTRA extends ExtraFlags = ExtraFlags> = {
  /** Stricli docs (brief + optional fullDescription) */
  docs: {
    brief: string;
    fullDescription?: string;
  };

  /**
   * Default `--limit` value.
   * Use a plain number for simple limits (uses `numberParser`).
   * Use `{ min, max, default }` for range-validated limits.
   */
  limit: number | { min: number; max: number; default: number };

  /** Features to opt into (adds flags + wires up behaviour) */
  features?: ListFeatures;

  /**
   * Optional positional argument definition.
   * When provided, the `fetch` callback receives the parsed value as second arg.
   */
  positional?: {
    placeholder: string;
    brief: string;
    optional?: boolean;
  };

  /**
   * Plural noun for items in truncation messages.
   * Defaults to `"items"` (e.g. "Showing 5 of 10 items").
   * Set to e.g. `"teams"` to get "Showing 5 of 10 teams".
   */
  itemName?: string;

  /**
   * Extra command-specific flags (e.g. `--platform` on project list).
   * These are merged into the flags object passed to `fetch` and `render`.
   */
  extraFlags?: EXTRA;

  /**
   * Fetch data for this command invocation.
   * Returns a `ListResult<T>` with items + optional pagination/footer metadata.
   */
  fetch: (
    this: SentryContext,
    flags: FullListFlags & { [K in keyof EXTRA]?: unknown },
    positional?: string
  ) => Promise<ListResult<T>>;

  /**
   * Render the human-readable table (header + rows).
   * Only called when `--json` is NOT set and items is non-empty.
   * May be async (e.g., when rendering requires additional API calls).
   */
  render: (
    items: T[],
    stdout: Writer,
    flags: FullListFlags & { [K in keyof EXTRA]?: unknown }
  ) => void | Promise<void>;

  /**
   * Override JSON output.
   * Default: `writeJson(stdout, result.items)`.
   * Use this when the JSON envelope needs to differ (e.g. `{ data, hasMore }`).
   */
  formatJson?: (
    result: ListResult<T>,
    stdout: Writer,
    flags: FullListFlags & { [K in keyof EXTRA]?: unknown }
  ) => void;

  /**
   * Override the empty-state message.
   * Default: `"No items found."`.
   */
  emptyMessage?:
    | string
    | ((
        flags: FullListFlags & { [K in keyof EXTRA]?: unknown },
        positional?: string
      ) => string);

  /**
   * Footer tip text written via `writeFooter` after the table.
   * Can be a static string or a function of the result + flags.
   * When omitted, no footer is written.
   */
  footerTip?:
    | string
    | ((
        result: ListResult<T>,
        flags: FullListFlags & { [K in keyof EXTRA]?: unknown }
      ) => string);

  /**
   * Key used for SQLite cursor storage (`--cursor last` support).
   * Required when `features.cursor` is true.
   * Example: `"project-list"`, `"team-list"`.
   */
  paginationKey?: string;

  /**
   * Build the pagination context key (namespaces cursors per query).
   * Required when `features.cursor` is true.
   */
  buildContextKey?: (
    flags: FullListFlags & { [K in keyof EXTRA]?: unknown },
    positional?: string
  ) => string;

  /**
   * Called when `--follow` flag is set.
   * The factory calls `fetch` once for the initial batch then delegates here.
   * The follow callback owns the streaming loop entirely.
   */
  follow?: (
    this: SentryContext,
    flags: FullListFlags & { [K in keyof EXTRA]?: unknown },
    positional: string | undefined,
    initialResult: ListResult<T>
  ) => Promise<void>;
};

// ─── Internal helpers for listCommand ────────────────────────────────────────

/** Build the limit flag definition */
function buildLimitFlag(limit: ListCommandConfig<unknown>["limit"]): {
  parse: (v: string) => number;
  brief: string;
  default: string;
} {
  if (typeof limit === "number") {
    return {
      parse: numberParser,
      brief: "Maximum number of items to list",
      default: String(limit),
    };
  }
  return {
    parse: makeValidateLimit(limit.min, limit.max),
    brief: `Number of items (${limit.min}-${limit.max})`,
    default: String(limit.default),
  };
}

/** Build a sort parser that validates against a fixed set of values */
function buildSortParser(
  validValues: readonly string[]
): (value: string) => string {
  return (value: string): string => {
    if (!validValues.includes(value)) {
      throw new Error(
        `Invalid sort value. Must be one of: ${validValues.join(", ")}`
      );
    }
    return value;
  };
}

/** Default follow parser: empty string → 2s interval */
function parseFollowInterval(value: string): number {
  if (value === "") {
    return 2;
  }
  const n = Number.parseInt(value, 10);
  if (Number.isNaN(n) || n < 1) {
    throw new Error("--follow interval must be a positive integer");
  }
  return n;
}

/** Build the full flags record for Stricli from config */
function buildFlagsRecord(
  config: ListCommandConfig<unknown>,
  features: ListFeatures
): Record<string, unknown> {
  const limitDef = buildLimitFlag(config.limit);
  const flags: Record<string, unknown> = {
    limit: {
      kind: "parsed",
      parse: limitDef.parse,
      brief: limitDef.brief,
      default: limitDef.default,
    },
    json: {
      kind: "boolean",
      brief: "Output as JSON",
      default: false,
    },
  };

  if (features.query) {
    flags.query = {
      kind: "parsed",
      parse: String,
      brief: "Filter query (Sentry search syntax)",
      optional: true,
    };
  }

  if (features.sort && features.sort.length > 0) {
    flags.sort = {
      kind: "parsed",
      parse: buildSortParser(features.sort),
      brief: `Sort by: ${features.sort.join(", ")}`,
      default: features.sort[0],
    };
  }

  if (features.cursor) {
    flags.cursor = {
      kind: "parsed",
      parse: String,
      brief: 'Pagination cursor (use "last" to continue from previous page)',
      optional: true,
    };
  }

  if (features.follow) {
    flags.follow = {
      kind: "parsed",
      parse: parseFollowInterval,
      brief: "Stream results (optionally specify poll interval in seconds)",
      optional: true,
      inferEmpty: true,
    };
  }

  for (const [key, def] of Object.entries(config.extraFlags ?? {})) {
    flags[key] = def;
  }

  return flags;
}

/** Build the aliases record from active features */
function buildAliases(features: ListFeatures): Record<string, string> {
  const aliases: Record<string, string> = { n: "limit" };
  if (features.query) {
    aliases.q = "query";
  }
  if (features.sort) {
    aliases.s = "sort";
  }
  if (features.cursor) {
    aliases.c = "cursor";
  }
  if (features.follow) {
    aliases.f = "follow";
  }
  return aliases;
}

type AnyFlags = FullListFlags & Record<string, unknown>;

type ApplyCursorOptions = {
  flags: AnyFlags;
  features: ListFeatures;
  paginationKey: string | undefined;
  buildContextKey: ((f: AnyFlags, p?: string) => string) | undefined;
  positional: string | undefined;
};

/** Handle cursor resolution and cache update for a paginated fetch */
function applyCursorToFlags(options: ApplyCursorOptions): AnyFlags {
  const { flags, features, paginationKey, buildContextKey, positional } =
    options;
  if (!(features.cursor && flags.cursor && paginationKey && buildContextKey)) {
    return flags;
  }
  const contextKey = buildContextKey(flags, positional);
  const resolved = resolveCursorFlag(flags.cursor, paginationKey, contextKey);
  return { ...flags, cursor: resolved };
}

type WriteHumanOutputOptions<T> = {
  result: ListResult<T>;
  stdout: Writer;
  flags: AnyFlags;
  positional: string | undefined;
  config: ListCommandConfig<T>;
};

/** Write empty-state message plus optional footer/self-hosted warning */
function writeEmptyState<T>(options: WriteHumanOutputOptions<T>): void {
  const { result, stdout, flags, positional, config } = options;
  const msg =
    typeof config.emptyMessage === "function"
      ? config.emptyMessage(flags, positional)
      : (config.emptyMessage ?? "No items found.");
  stdout.write(msg.endsWith("\n") ? msg : `${msg}\n`);
  if (result.footer) {
    stdout.write(`\n${result.footer}\n`);
  }
  if (result.skippedSelfHosted) {
    writeSelfHostedWarning(
      stdout,
      result.skippedSelfHosted,
      config.docs.brief.toLowerCase()
    );
  }
}

/** Write truncation notice, DSN footer, self-hosted warning, and footer tip */
function writeResultFooters<T>(options: WriteHumanOutputOptions<T>): void {
  const { result, stdout, flags, config } = options;
  const itemName = config.itemName ?? "items";
  if (result.total !== undefined && result.total > result.items.length) {
    stdout.write(
      `\nShowing ${result.items.length} of ${result.total} ${itemName}\n`
    );
  } else if (result.hasMore) {
    stdout.write(
      `\nShowing ${result.items.length} ${itemName} (more available)\n`
    );
  }
  if (result.footer) {
    stdout.write(`\n${result.footer}\n`);
  }
  if (result.skippedSelfHosted) {
    writeSelfHostedWarning(
      stdout,
      result.skippedSelfHosted,
      config.docs.brief.toLowerCase()
    );
  }
  if (config.footerTip) {
    const tip =
      typeof config.footerTip === "function"
        ? config.footerTip(result, flags)
        : config.footerTip;
    writeFooter(stdout, tip);
  }
}

/** Write the human output pipeline (empty check → header → render → truncation → footer) */
async function writeHumanOutput<T>(
  options: WriteHumanOutputOptions<T>
): Promise<void> {
  const { result, stdout, flags, config } = options;
  if (result.items.length === 0) {
    writeEmptyState(options);
    return;
  }
  if (result.header) {
    stdout.write(`${result.header}\n`);
  }
  await config.render(result.items, stdout, flags);
  writeResultFooters(options);
}

// ─── listCommand ──────────────────────────────────────────────────────────────

/**
 * Factory for list commands.
 *
 * Builds a Stricli `Command<SentryContext>` from a lightweight config object.
 * Handles:
 * - Standard flags: `--limit`, `--json`, plus optional `--query`, `--sort`,
 *   `--cursor`, `--follow`
 * - Output pipeline: JSON → empty state → render → truncation notice → footer tip
 * - Cursor pagination: stores next-page cursor in SQLite, resolves `--cursor last`
 * - Follow mode: delegates to per-command `follow` callback after initial fetch
 *
 * @example
 * ```ts
 * export const listCommand = listCommand({
 *   docs: { brief: "List teams" },
 *   limit: 30,
 *   features: { cursor: true },
 *   positional: { placeholder: "org", brief: "Organization slug", optional: true },
 *   emptyMessage: (_, org) => org ? `No teams found in '${org}'.` : "No teams found.",
 *   footerTip: "Tip: Use 'sentry team list <org>' to filter by organization",
 *   paginationKey: "team-list",
 *   buildContextKey: (_, org) => org ?? "all",
 *   async fetch(flags, org?) { ... },
 *   render(items, stdout) { ... },
 * });
 * ```
 */
export function listCommand<T, EXTRA extends ExtraFlags = ExtraFlags>(
  config: ListCommandConfig<T, EXTRA>
): Command<SentryContext> {
  const features: ListFeatures = config.features ?? {};
  const flagsRecord = buildFlagsRecord(
    config as ListCommandConfig<unknown>,
    features
  );
  const aliases = buildAliases(features);

  const parameters: Record<string, unknown> = {
    flags: flagsRecord,
    aliases,
  };

  if (config.positional) {
    parameters.positional = {
      kind: "tuple",
      parameters: [
        {
          placeholder: config.positional.placeholder,
          brief: config.positional.brief,
          parse: String,
          optional: config.positional.optional ?? false,
        },
      ],
    };
  }

  const func = async function (
    this: SentryContext,
    rawFlags: FullListFlags & { [K in keyof EXTRA]?: unknown },
    positional?: string
  ): Promise<void> {
    const { stdout } = this;

    // Resolve "--cursor last" from SQLite cache
    const flags = applyCursorToFlags({
      flags: rawFlags as AnyFlags,
      features,
      paginationKey: config.paginationKey,
      buildContextKey: config.buildContextKey as
        | ((f: AnyFlags, p?: string) => string)
        | undefined,
      positional,
    }) as FullListFlags & { [K in keyof EXTRA]?: unknown };

    // Initial fetch
    const result = await config.fetch.call(this, flags, positional);

    // Store / clear next-page cursor
    if (features.cursor && config.paginationKey && config.buildContextKey) {
      const contextKey = config.buildContextKey(flags, positional);
      updateCursorCache(result.nextCursor, config.paginationKey, contextKey);
    }

    // Follow mode: delegate to per-command streaming callback
    if (flags.follow !== undefined && features.follow && config.follow) {
      await config.follow.call(this, flags, positional, result);
      return;
    }

    // JSON output
    if (flags.json) {
      if (config.formatJson) {
        config.formatJson(result, stdout, flags);
      } else {
        writeJson(stdout, result.items);
      }
      return;
    }

    // Human output
    await writeHumanOutput({
      result,
      stdout,
      flags: flags as AnyFlags,
      positional,
      config: config as ListCommandConfig<T>,
    });
  };

  return buildCommand({
    docs: config.docs,
    parameters,
    func,
    // biome-ignore lint/suspicious/noExplicitAny: Stricli types require this cast
  } as any);
}
