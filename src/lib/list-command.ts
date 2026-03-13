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

import type { Aliases, Command, CommandContext } from "@stricli/core";
import type { SentryContext } from "../context.js";
import { parseOrgProjectArg } from "./arg-parsing.js";
import { buildCommand, numberParser } from "./command.js";
import { disableDsnCache } from "./dsn/index.js";
import { warning } from "./formatters/colors.js";
import type { CommandOutput, OutputConfig } from "./formatters/output.js";
import {
  dispatchOrgScopedList,
  jsonTransformListResult,
  type ListResult,
  type OrgListConfig,
} from "./org-list.js";
import { disableResponseCache } from "./response-cache.js";

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
 *
 * @deprecated Use `output: "json"` on `buildCommand` instead, which
 * injects `--json` and `--fields` automatically. This constant is kept
 * for commands that define `--json` with custom brief text.
 */
export const LIST_JSON_FLAG = {
  kind: "boolean" as const,
  brief: "Output JSON",
  default: false,
} as const;

/**
 * The `--fresh` / `-f` flag shared by read-only commands.
 * Bypasses the response cache and fetches fresh data from the API.
 *
 * Add to any command's `flags` object, then call `applyFreshFlag(flags)` at
 * the top of `func()` to activate cache bypass when the flag is set.
 *
 * @example
 * ```ts
 * import { applyFreshFlag, FRESH_ALIASES, FRESH_FLAG } from "../lib/list-command.js";
 *
 * // In parameters:
 * flags: { ..., fresh: FRESH_FLAG },
 * aliases: { ...FRESH_ALIASES },
 *
 * // In func():
 * applyFreshFlag(flags);
 * ```
 */
export const FRESH_FLAG = {
  kind: "boolean" as const,
  brief: "Bypass cache, re-detect projects, and fetch fresh data",
  default: false,
} as const;

/**
 * Alias map for the `--fresh` flag: `-f` → `--fresh`.
 *
 * Spread into a command's `aliases` alongside other aliases:
 * ```ts
 * aliases: { ...FRESH_ALIASES, w: "web" }
 * ```
 *
 * **Note**: Commands that use `-f` for a different flag (e.g. `log list`
 * uses `-f` for `--follow`) should NOT spread this constant.
 */
export const FRESH_ALIASES = { f: "fresh" } as const;

/**
 * Apply the `--fresh` flag: disables the response cache for this invocation.
 *
 * Call at the top of a command's `func()` after defining the `fresh` flag:
 * ```ts
 * flags: { fresh: FRESH_FLAG },
 * async func(this: SentryContext, flags) {
 *   applyFreshFlag(flags);
 * ```
 */
export function applyFreshFlag(flags: { readonly fresh: boolean }): void {
  if (flags.fresh) {
    disableResponseCache();
    disableDsnCache();
  }
}

/** Matches strings that are all digits — used to detect invalid cursor values */
const ALL_DIGITS_RE = /^\d+$/;

/**
 * Parse and validate a `--cursor` flag value.
 *
 * Accepts the magic `"last"` keyword (resume from stored cursor) and opaque
 * Sentry cursor strings (e.g. `"1735689600:0:0"`). Rejects bare integers
 * early — they are never valid cursors and would produce a cryptic 400 from
 * the API.
 *
 * Shared by {@link LIST_CURSOR_FLAG} and commands that define their own
 * cursor flag with a custom `brief`.
 *
 * @throws Error when value is a bare integer
 */
export function parseCursorFlag(value: string): string {
  if (value === "last") {
    return value;
  }
  if (ALL_DIGITS_RE.test(value)) {
    throw new Error(
      `'${value}' is not a valid cursor. Cursors look like "1735689600:0:0". Use "last" to continue from the previous page.`
    );
  }
  return value;
}

/**
 * The `--cursor` / `-c` flag shared by all list commands.
 *
 * Accepts an opaque cursor string or the special value `"last"` to continue
 * from the previous page. Only meaningful in `<org>/` (org-all) mode.
 */
export const LIST_CURSOR_FLAG = {
  kind: "parsed" as const,
  parse: parseCursorFlag,
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

/** Base args type (mirrors command.ts) */
type BaseArgs = readonly unknown[];

/**
 * Wider command function type that allows returning `CommandOutput<T>`.
 *
 * Mirrors `SentryCommandFunction` from `command.ts`. The Stricli
 * `CommandFunction` type constrains returns to `void | Error`, which is
 * too narrow for the return-based output pattern. This type adds `unknown`
 * to the return union so `{ data, hint }` objects pass through.
 */
type ListCommandFunction<
  FLAGS extends BaseFlags,
  ARGS extends BaseArgs,
  CONTEXT extends CommandContext,
> = (
  this: CONTEXT,
  flags: FLAGS,
  ...args: ARGS
  // biome-ignore lint/suspicious/noConfusingVoidType: void required to match async functions returning nothing (Promise<void>)
) => void | Error | unknown | Promise<void | Error | unknown>;

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
    readonly func: ListCommandFunction<FLAGS, ARGS, CONTEXT>;
    // biome-ignore lint/suspicious/noExplicitAny: OutputConfig is generic but type is erased at the builder level
    readonly output?: "json" | OutputConfig<any>;
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

  return buildCommand({
    ...builderArgs,
    func: wrappedFunc,
    output: builderArgs.output,
  });
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
 * Format a {@link ListResult} as human-readable output using the config's
 * `displayTable` function. Handles empty results, headers, table body, and hints.
 *
 * @param result - The list result from a dispatch handler
 * @param config - The OrgListConfig providing the `displayTable` renderer
 * @returns Formatted string for terminal output
 */
function formatListHuman<TEntity, TWithOrg>(
  result: ListResult<TWithOrg>,
  config: OrgListConfig<TEntity, TWithOrg>
): string {
  const parts: string[] = [];

  if (result.items.length === 0) {
    // Empty result — show the hint (which contains the "No X found" message)
    if (result.hint) {
      parts.push(result.hint);
    }
    return parts.join("\n");
  }

  // Table body
  parts.push(config.displayTable(result.items));

  // Header contains count info like "Showing N items (more available)"
  if (result.header) {
    parts.push(`\n${result.header}`);
  }

  return parts.join("");
}

// JSON transform is shared via jsonTransformListResult in org-list.ts

/**
 * Build a complete Stricli command whose entire `func` body delegates to
 * `dispatchOrgScopedList`.
 *
 * This covers the team and repo list commands, where all runtime behaviour is
 * encapsulated in the shared org-list framework. The resulting command has:
 * - An optional positional `target` argument
 * - `--limit` / `-n`, `--json`, `--fields`, `--cursor` / `-c` flags
 * - A `func` that calls `parseOrgProjectArg` then `dispatchOrgScopedList`
 *
 * Rendering is handled automatically via `OutputConfig`:
 * - JSON mode produces paginated envelopes or flat arrays
 * - Human mode uses the config's `displayTable` function
 *
 * @param config - The `OrgListConfig` that drives fetching and display
 * @param docs   - Brief and optional full description for `--help`
 * @param routeName - Singular route name for subcommand interception
 */
export function buildOrgListCommand<TEntity, TWithOrg>(
  config: OrgListConfig<TEntity, TWithOrg>,
  docs: OrgListCommandDocs,
  routeName: string
): Command<SentryContext> {
  return buildListCommand(routeName, {
    docs,
    output: {
      json: true,
      human: (result: ListResult<TWithOrg>) => formatListHuman(result, config),
      jsonTransform: (result: ListResult<TWithOrg>, fields?: string[]) =>
        jsonTransformListResult(result, fields),
    } satisfies OutputConfig<ListResult<TWithOrg>>,
    parameters: {
      positional: LIST_TARGET_POSITIONAL,
      flags: {
        limit: buildListLimitFlag(config.entityPlural),
        cursor: LIST_CURSOR_FLAG,
        fresh: FRESH_FLAG,
      },
      aliases: { ...LIST_BASE_ALIASES, ...FRESH_ALIASES },
    },
    async func(
      this: SentryContext,
      flags: {
        readonly limit: number;
        readonly json: boolean;
        readonly cursor?: string;
        readonly fresh: boolean;
        readonly fields?: string[];
      },
      target?: string
    ): Promise<CommandOutput<ListResult<TWithOrg>>> {
      applyFreshFlag(flags);
      const { stdout, cwd } = this;
      const parsed = parseOrgProjectArg(target);
      const result = await dispatchOrgScopedList({
        config,
        stdout,
        cwd,
        flags,
        parsed,
      });
      // Only forward hint to the footer when items exist — empty results
      // already render hint text inside the human formatter.
      const hint = result.items.length > 0 ? result.hint : undefined;
      return { data: result, hint };
    },
  });
}
