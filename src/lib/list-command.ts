/**
 * Shared building blocks for org-scoped list commands.
 *
 * Provides reusable Stricli parameter definitions (target positional, common
 * flags, aliases) and a `buildOrgListCommand` factory for commands whose
 * entire `func` body is handled by `dispatchOrgScopedList`.
 *
 * Level A — shared constants (used by all four list commands):
 *   LIST_TARGET_POSITIONAL, LIST_JSON_FLAG, LIST_CURSOR_FLAG,
 *   buildListLimitFlag, LIST_BASE_ALIASES
 *
 * Level B — full command builder (team / repo only):
 *   buildOrgListCommand
 */

import type { Aliases, Command } from "@stricli/core";
import type { SentryContext } from "../context.js";
import { parseOrgProjectArg } from "./arg-parsing.js";
import { buildCommand, numberParser } from "./command.js";
import { dispatchOrgScopedList, type OrgListConfig } from "./org-list.js";

// ---------------------------------------------------------------------------
// Level A: shared parameter / flag definitions
// ---------------------------------------------------------------------------

/**
 * Positional `org/project` parameter shared by all list commands.
 *
 * Accepts `<org>/`, `<org>/<project>`, or bare `<project>` (search).
 * Marked optional so the command falls back to auto-detection when omitted.
 */
export const LIST_TARGET_POSITIONAL = {
  kind: "tuple" as const,
  parameters: [
    {
      placeholder: "org/project",
      brief: "<org>/ (all projects), <org>/<project>, or <project> (search)",
      parse: String,
      optional: true as const,
    },
  ],
};

/**
 * Short note for commands that accept a bare project name but do not support
 * org-all mode (e.g. trace list, log list, project view).
 *
 * Explains that a bare name triggers project-search, not org-scoped listing.
 */
export const TARGET_PATTERN_NOTE =
  "A bare name (no slash) is treated as a project search. " +
  "Use <org>/<project> for an explicit target.";

/**
 * Full explanation of trailing-slash semantics for commands that support all
 * four target modes including org-all (e.g. issue list, project list).
 *
 * @param cursorNote - Optional sentence appended when the command supports
 *   cursor pagination (e.g. "Cursor pagination (--cursor) requires the <org>/ form.").
 */
export function targetPatternExplanation(cursorNote?: string): string {
  const base =
    "The trailing slash on <org>/ is significant — without it, the argument " +
    "is treated as a project name search (e.g., 'sentry' searches for a " +
    "project named 'sentry', while 'sentry/' lists all projects in the " +
    "'sentry' org).";
  return cursorNote ? `${base} ${cursorNote}` : base;
}

/**
 * The `--json` flag shared by all list commands.
 * Outputs machine-readable JSON instead of a human-readable table.
 */
export const LIST_JSON_FLAG = {
  kind: "boolean" as const,
  brief: "Output JSON",
  default: false,
} as const;

/**
 * The `--cursor` / `-c` flag shared by all list commands.
 *
 * Accepts an opaque cursor string or the special value `"last"` to continue
 * from the previous page. Only meaningful in `<org>/` (org-all) mode.
 */
export const LIST_CURSOR_FLAG = {
  kind: "parsed" as const,
  parse: String,
  brief: 'Pagination cursor (use "last" to continue from previous page)',
  optional: true as const,
};

/**
 * Build the `--limit` / `-n` flag for a list command.
 *
 * @param entityPlural - Plural entity name used in the brief (e.g. "teams")
 * @param defaultValue - Default limit as a string (default: "30")
 */
export function buildListLimitFlag(
  entityPlural: string,
  defaultValue = "30"
): {
  kind: "parsed";
  parse: typeof numberParser;
  brief: string;
  default: string;
} {
  return {
    kind: "parsed",
    parse: numberParser,
    brief: `Maximum number of ${entityPlural} to list`,
    default: defaultValue,
  };
}

/**
 * Alias map shared by all list commands.
 * `-n` → `--limit`, `-c` → `--cursor`.
 *
 * Commands with additional flags should spread this and add their own aliases:
 * ```ts
 * aliases: { ...LIST_BASE_ALIASES, p: "platform" }
 * ```
 */
export const LIST_BASE_ALIASES: Aliases<string> = { n: "limit", c: "cursor" };

// ---------------------------------------------------------------------------
// Level B: full command builder for dispatchOrgScopedList-based commands
// ---------------------------------------------------------------------------

/** Documentation strings for a list command built with `buildOrgListCommand`. */
export type OrgListCommandDocs = {
  /** One-line description shown in `--help` summaries. */
  readonly brief: string;
  /** Multi-line description shown in the command's own `--help` output. */
  readonly fullDescription?: string;
};

/**
 * Build a complete Stricli command whose entire `func` body delegates to
 * `dispatchOrgScopedList`.
 *
 * This covers the team and repo list commands, where all runtime behaviour is
 * encapsulated in the shared org-list framework.  The resulting command has:
 * - An optional positional `target` argument
 * - `--limit` / `-n`, `--json`, `--cursor` / `-c` flags
 * - A `func` that calls `parseOrgProjectArg` then `dispatchOrgScopedList`
 *
 * @param config - The `OrgListConfig` that drives fetching and display
 * @param docs   - Brief and optional full description for `--help`
 */
export function buildOrgListCommand<TEntity, TWithOrg>(
  config: OrgListConfig<TEntity, TWithOrg>,
  docs: OrgListCommandDocs
): Command<SentryContext> {
  return buildCommand({
    docs,
    parameters: {
      positional: LIST_TARGET_POSITIONAL,
      flags: {
        limit: buildListLimitFlag(config.entityPlural),
        json: LIST_JSON_FLAG,
        cursor: LIST_CURSOR_FLAG,
      },
      aliases: LIST_BASE_ALIASES,
    },
    async func(
      this: SentryContext,
      flags: {
        readonly limit: number;
        readonly json: boolean;
        readonly cursor?: string;
      },
      target?: string
    ): Promise<void> {
      const { stdout, cwd } = this;
      const parsed = parseOrgProjectArg(target);
      await dispatchOrgScopedList({ config, stdout, cwd, flags, parsed });
    },
  });
}
