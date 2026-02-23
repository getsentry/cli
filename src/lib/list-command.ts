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

import type {
  Aliases,
  Command,
  CommandContext,
  CommandFunction,
} from "@stricli/core";
import type { SentryContext } from "../context.js";
import { parseOrgProjectArg } from "./arg-parsing.js";
import { buildCommand, numberParser } from "./command.js";
import { warning } from "./formatters/colors.js";
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
// Level B: subcommand interception for plural aliases
// ---------------------------------------------------------------------------

let _subcommandsByRoute: Map<string, Set<string>> | undefined;

/**
 * Get the subcommand names for a given singular route (e.g. "project" → {"list", "view"}).
 *
 * Lazily walks the Stricli route map on first call. Uses `require()` to break
 * the circular dependency: list-command → app → commands → list-command.
 */
function getSubcommandsForRoute(routeName: string): Set<string> {
  if (!_subcommandsByRoute) {
    _subcommandsByRoute = new Map();

    const { routes } = require("../app.js") as {
      routes: {
        getAllEntries: () => readonly {
          name: { original: string };
          target: unknown;
        }[];
      };
    };

    for (const entry of routes.getAllEntries()) {
      const target = entry.target as unknown as Record<string, unknown>;
      if (typeof target?.getAllEntries === "function") {
        const children = (
          target.getAllEntries as () => readonly {
            name: { original: string };
          }[]
        )();
        const names = new Set<string>();
        for (const child of children) {
          names.add(child.name.original);
        }
        _subcommandsByRoute.set(entry.name.original, names);
      }
    }
  }

  return _subcommandsByRoute.get(routeName) ?? new Set();
}

/**
 * Check if a positional target is actually a subcommand name passed through
 * a plural alias (e.g. "list" from `sentry projects list`).
 *
 * When a plural alias like `sentry projects` maps directly to the list
 * command, Stricli passes extra tokens as positional args. If the token
 * matches a known subcommand of the singular route, we treat it as if no
 * target was given (auto-detect) and print a command-specific hint.
 *
 * @param target - The raw positional argument
 * @param stderr - Writable stream for the hint message
 * @param routeName - Singular route name (e.g. "project", "issue")
 * @returns The original target, or `undefined` if it was a subcommand name
 */
export function interceptSubcommand(
  target: string | undefined,
  stderr: { write(s: string): void },
  routeName: string
): string | undefined {
  if (!target) {
    return target;
  }
  const trimmed = target.trim();
  if (trimmed && getSubcommandsForRoute(routeName).has(trimmed)) {
    stderr.write(
      warning(
        `Tip: "${trimmed}" is a subcommand. Running: sentry ${routeName} ${trimmed}\n`
      )
    );
    return;
  }
  return target;
}

// ---------------------------------------------------------------------------
// Level C: list command builder with automatic subcommand interception
// ---------------------------------------------------------------------------

/** Base flags type (mirrors command.ts) */
type BaseFlags = Readonly<Partial<Record<string, unknown>>>;

/**
 * Build a Stricli command for a list endpoint with automatic plural-alias
 * interception.
 *
 * This is a drop-in replacement for `buildCommand` that wraps the command
 * function to intercept subcommand names passed through plural aliases.
 * For example, when `sentry projects list` passes "list" as a positional
 * target to the project list command, it is intercepted and treated as
 * auto-detect mode with a command-specific hint on stderr.
 *
 * Usage:
 * ```ts
 * // Before:
 * import { buildCommand } from "../../lib/command.js";
 * export const listCommand = buildCommand({ ... });
 *
 * // After:
 * import { buildListCommand } from "../../lib/list-command.js";
 * export const listCommand = buildListCommand("project", { ... });
 * ```
 *
 * @param routeName - Singular route name (e.g. "project", "issue") for the
 *   hint message and subcommand lookup
 * @param builderArgs - Same arguments as `buildCommand` from `lib/command.js`
 */
export function buildListCommand<
  const FLAGS extends BaseFlags = NonNullable<unknown>,
  const ARGS extends readonly unknown[] = [],
  const CONTEXT extends CommandContext = CommandContext,
>(
  routeName: string,
  builderArgs: {
    readonly parameters?: Record<string, unknown>;
    readonly docs: {
      readonly brief: string;
      readonly fullDescription?: string;
    };
    readonly func: CommandFunction<FLAGS, ARGS, CONTEXT>;
  }
): Command<CONTEXT> {
  const originalFunc = builderArgs.func;

  // biome-ignore lint/suspicious/noExplicitAny: Stricli's CommandFunction type is complex
  const wrappedFunc = function (this: CONTEXT, flags: FLAGS, ...args: any[]) {
    // The first positional arg is always the target (org/project pattern).
    // Intercept it to handle plural alias confusion.
    if (
      args.length > 0 &&
      (typeof args[0] === "string" || args[0] === undefined)
    ) {
      // All list commands use SentryContext which has stderr at top level
      const ctx = this as unknown as { stderr: { write(s: string): void } };
      args[0] = interceptSubcommand(
        args[0] as string | undefined,
        ctx.stderr,
        routeName
      );
    }
    return originalFunc.call(this, flags, ...(args as unknown as ARGS));
  } as typeof originalFunc;

  return buildCommand({ ...builderArgs, func: wrappedFunc });
}

// ---------------------------------------------------------------------------
// Level D: full command builder for dispatchOrgScopedList-based commands
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
  docs: OrgListCommandDocs,
  routeName: string
): Command<SentryContext> {
  return buildListCommand(routeName, {
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
