/**
 * Argv preprocessor that moves global flags to the end of the argument list.
 *
 * Stricli only parses flags at the leaf command level, so flags like
 * `--verbose` placed before the subcommand (`sentry --verbose issue list`)
 * fail route resolution. This module relocates known global flags from any
 * position to the tail of argv where Stricli's leaf-command parser can
 * find them.
 *
 * Flag metadata is derived from the shared {@link GLOBAL_FLAGS} definition
 * in `global-flags.ts` so both the hoisting preprocessor and the
 * `buildCommand` injection stay in sync automatically.
 */

import { GLOBAL_FLAGS } from "./global-flags.js";

/** Resolved flag metadata used by the hoisting algorithm. */
type HoistableFlag = {
  /** Long flag name without `--` prefix (e.g., `"verbose"`) */
  readonly name: string;
  /** Single-char short alias without `-` prefix, or `null` if none */
  readonly short: string | null;
  /** Whether the flag consumes the next token as its value */
  readonly takesValue: boolean;
  /** Whether `--no-<name>` is recognized as the negation form */
  readonly negatable: boolean;
};

/** Derive hoisting metadata from the shared flag definitions. */
const HOISTABLE_FLAGS: readonly HoistableFlag[] = GLOBAL_FLAGS.map((f) => ({
  name: f.name,
  short: f.short,
  takesValue: f.kind === "value",
  negatable: f.kind === "boolean",
}));

/** Pre-built lookup: long name → flag definition */
const FLAG_BY_NAME = new Map(HOISTABLE_FLAGS.map((f) => [f.name, f]));

/** Pre-built lookup: short alias → flag definition */
const FLAG_BY_SHORT = new Map(
  HOISTABLE_FLAGS.filter(
    (f): f is HoistableFlag & { short: string } => f.short !== null
  ).map((f) => [f.short, f])
);

/** Names that support `--no-<name>` negation */
const NEGATABLE_NAMES = new Set(
  HOISTABLE_FLAGS.filter((f) => f.negatable).map((f) => f.name)
);

/**
 * Match result from {@link matchHoistable}.
 *
 * - `"plain"`: `--flag` (boolean) or `--flag` (value-taking, value is next token)
 * - `"eq"`: `--flag=value` (value embedded in token)
 * - `"negated"`: `--no-flag`
 * - `"short"`: `-v` (single-char alias)
 */
type MatchForm = "plain" | "eq" | "negated" | "short";

/** Try matching a `--no-<name>` negation form. */
function matchNegated(
  name: string
): { flag: HoistableFlag; form: MatchForm } | null {
  if (!name.startsWith("no-")) {
    return null;
  }
  const baseName = name.slice(3);
  if (!NEGATABLE_NAMES.has(baseName)) {
    return null;
  }
  const flag = FLAG_BY_NAME.get(baseName);
  return flag ? { flag, form: "negated" } : null;
}

/**
 * Match a token against the hoistable flag registry.
 *
 * @returns The matched flag and form, or `null` if not hoistable.
 */
function matchHoistable(
  token: string
): { flag: HoistableFlag; form: MatchForm } | null {
  // Short alias: -v (exactly two chars, dash + letter)
  if (token.length === 2 && token[0] === "-" && token[1] !== "-") {
    const flag = FLAG_BY_SHORT.get(token[1] ?? "");
    return flag ? { flag, form: "short" } : null;
  }

  if (!token.startsWith("--")) {
    return null;
  }

  // --flag=value form
  const eqIdx = token.indexOf("=");
  if (eqIdx !== -1) {
    const name = token.slice(2, eqIdx);
    const flag = FLAG_BY_NAME.get(name);
    return flag?.takesValue ? { flag, form: "eq" } : null;
  }

  const name = token.slice(2);
  const negated = matchNegated(name);
  if (negated) {
    return negated;
  }
  const flag = FLAG_BY_NAME.get(name);
  return flag ? { flag, form: "plain" } : null;
}

/**
 * Hoist a single matched flag token (and its value if applicable) into the
 * `hoisted` array, advancing the index past the consumed tokens.
 *
 * Extracted from the main loop to keep {@link hoistGlobalFlags} under
 * Biome's cognitive complexity limit.
 */
function consumeFlag(
  argv: readonly string[],
  index: number,
  match: { flag: HoistableFlag; form: MatchForm },
  hoisted: string[]
): number {
  const token = argv[index] ?? "";

  // --flag=value or --no-flag: always a single token
  if (match.form === "eq" || match.form === "negated") {
    hoisted.push(token);
    return index + 1;
  }

  // --flag or -v: may consume a following value token
  if (match.flag.takesValue) {
    hoisted.push(token);
    const next = index + 1;
    if (next < argv.length) {
      hoisted.push(argv[next] ?? "");
      return next + 1;
    }
    // No value follows — the bare flag is still hoisted;
    // Stricli will report the missing value at parse time.
    return next;
  }

  // Boolean flag (--flag or -v): single token
  hoisted.push(token);
  return index + 1;
}

/**
 * Move global flags from any position in argv to the end.
 *
 * Tokens after `--` are never touched. The relative order of both
 * hoisted and non-hoisted tokens is preserved.
 *
 * @param argv - Raw CLI arguments (e.g., `process.argv.slice(2)`)
 * @returns New array with global flags relocated to the tail
 */
export function hoistGlobalFlags(argv: readonly string[]): string[] {
  const remaining: string[] = [];
  const hoisted: string[] = [];
  /** Tokens from `--` onward (positional-only region). */
  const positionalTail: string[] = [];

  let i = 0;
  while (i < argv.length) {
    const token = argv[i] ?? "";

    // Stop scanning at -- separator; pass everything through verbatim.
    // Hoisted flags must appear BEFORE -- so Stricli parses them as flags.
    if (token === "--") {
      for (let j = i; j < argv.length; j += 1) {
        positionalTail.push(argv[j] ?? "");
      }
      break;
    }

    const match = matchHoistable(token);
    if (match) {
      i = consumeFlag(argv, i, match, hoisted);
    } else {
      remaining.push(token);
      i += 1;
    }
  }

  return [...remaining, ...hoisted, ...positionalTail];
}
