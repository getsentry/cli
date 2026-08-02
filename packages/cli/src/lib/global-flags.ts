/**
 * Single source of truth for global CLI flags.
 *
 * Global flags are injected into every leaf command by {@link buildCommand}
 * and recognized at any argv position by Stricli's patched route scanner (a
 * top-level-flags allow-list) plus the app-boundary glue in `argv-glue.ts`.
 * This module defines the metadata once so those systems stay in sync
 * automatically — adding a flag here is all that's needed.
 *
 * The Stricli flag *shapes* (kind, brief, default, etc.) remain in
 * `command.ts` because they depend on Stricli types and runtime values.
 * This module only stores the identity and argv-level behavior of each flag.
 */

/**
 * Behavior category for a global flag.
 *
 * - `"boolean"` — standalone toggle, supports `--no-<name>` negation
 * - `"value"` — consumes the next token (or `=`-joined value)
 */
type GlobalFlagKind = "boolean" | "value";

/** Metadata for a single global CLI flag. */
type GlobalFlagDef = {
  /** Long flag name without `--` prefix (e.g., `"verbose"`) */
  readonly name: string;
  /** Single-char short alias without `-` prefix, or `null` if none */
  readonly short: string | null;
  /** Whether this is a boolean toggle or a value-taking flag */
  readonly kind: GlobalFlagKind;
};

/**
 * All global flags that are injected into every leaf command.
 *
 * Order doesn't matter — both the `buildCommand` wrapper and the app-boundary
 * glue build lookup structures from this list.
 *
 * IMPORTANT: the set of flag tokens recognized *before the subcommand* also
 * lives, hardcoded, in the `@stricli/core` route-scanner patch
 * (`packages/cli/patches/@stricli%2Fcore@1.2.8.patch`,
 * `SENTRY_TOP_LEVEL_*_FLAGS`). Patching minified `dist` code can't import this
 * list, so adding/removing a global flag here means updating that patch too, or
 * the flag won't be accepted when placed before the subcommand.
 */
export const GLOBAL_FLAGS: readonly GlobalFlagDef[] = [
  { name: "verbose", short: "v", kind: "boolean" },
  { name: "log-level", short: null, kind: "value" },
  { name: "json", short: null, kind: "boolean" },
  { name: "fields", short: null, kind: "value" },
  // Hidden compat shims: LLMs trained on the older sentry-cli generate
  // `--org` and `--project` flags. We silently accept them and map to
  // SENTRY_ORG / SENTRY_PROJECT env vars so the resolution chain handles them.
  // No short aliases: -p conflicts with release create's -p (--project).
  { name: "org", short: null, kind: "value" },
  { name: "project", short: null, kind: "value" },
];
