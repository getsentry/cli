/**
 * DSN scanner preset for `src/lib/scan/walkFiles`.
 *
 * Expresses the policy the current DSN scanner
 * (`src/lib/dsn/code-scanner.ts`) applies today: a depth-3 cap, full
 * DSN skip list (including test/fixture dirs), monorepo-boundary
 * depth reset, and the `TEXT_EXTENSIONS` allowlist. PR 3 will consume
 * this to replace `collectFiles` / `processFile` with a walker-backed
 * implementation.
 *
 * Isolated in the `dsn/` package — not `scan/` — so the core scanner
 * module stays policy-free. Other callers (the init wizard, future
 * features) will bring their own presets.
 */

import type { WalkOptions } from "../scan/index.js";
import {
  DEFAULT_SKIP_DIRS,
  DSN_ADDITIONAL_SKIP_DIRS,
  isMonorepoPackageDir,
  TEXT_EXTENSIONS,
} from "../scan/index.js";

/**
 * The DSN scanner's depth limit. Matches
 * `src/lib/dsn/code-scanner.ts::MAX_SCAN_DEPTH` (pre-PR-3).
 *
 * `maxDepth` in the scan module caps **directory descent** — files
 * inside the last-entered directory are still yielded regardless.
 * So with `maxDepth: 3` and the monorepo descent hook, the deepest
 * files yielded inside a package look like
 * `packages/foo/a/b/c/file.ts` — three directory levels past the
 * package boundary.
 */
export const DSN_MAX_DEPTH = 3;

/**
 * Build a `WalkOptions` recipe that produces DSN-scanner-equivalent
 * behavior. Callers provide `cwd` (and optionally `signal`); this
 * helper fills in the rest.
 *
 * Notable choices vs. the current DSN scanner:
 *   - `nestedGitignore: true` — the existing scanner only reads the
 *     root `.gitignore`. Honoring nested ones is a correctness
 *     upgrade; PR 1.5's walker optimization makes the cost tolerable.
 *   - `extensions: TEXT_EXTENSIONS` — matches the existing scanner's
 *     filter; files outside this set are never considered.
 */
export function dsnScanOptions(): Omit<WalkOptions, "cwd"> {
  return {
    extensions: TEXT_EXTENSIONS,
    alwaysSkipDirs: [...DEFAULT_SKIP_DIRS, ...DSN_ADDITIONAL_SKIP_DIRS],
    maxDepth: DSN_MAX_DEPTH,
    descentHook: dsnDescentHook,
    nestedGitignore: true,
    respectGitignore: true,
    hidden: true,
  };
}

/**
 * Exported so tests can exercise the hook in isolation without
 * reaching into the options object.
 */
export function dsnDescentHook(relPath: string, currentDepth: number): number {
  // Entering a monorepo package dir resets the depth counter, giving
  // each package its own depth-3 budget (mirrors the existing DSN
  // scanner's isMonorepoPackageDir-driven reset in code-scanner.ts).
  return isMonorepoPackageDir(relPath) ? 0 : currentDepth + 1;
}
