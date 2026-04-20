/**
 * Pure-TS glob engine built on top of `walkFiles`.
 *
 * Accepts one or more glob patterns (picomatch syntax) and yields
 * files under `cwd` matching at least one `patterns` entry and no
 * `exclude` entry. Matching uses the `picomatch` package
 * (already a devDep, already used in `script/node-polyfills.ts`).
 *
 * ### Pattern semantics
 *
 * - Patterns with a `/` are matched against the POSIX-normalized
 *   relative path (e.g., `src/*.ts` only matches files directly in
 *   `src/`).
 * - Patterns without a `/` are matched against just the basename
 *   (e.g., `*.ts` matches `any/dir/x.ts`).
 * - `dot: true` — the matcher accepts dotfiles, matching the
 *   walker's default `hidden: true`.
 * - `**` spans directory boundaries.
 *
 * This mirrors the behavior of the init wizard's existing FS-fallback
 * glob (`src/lib/init/tools/search-utils.ts::matchGlob`) but uses
 * picomatch's full grammar — extglobs (`+(a|b)`), braces (`{a,b}`),
 * negation (`!pattern`), etc.
 *
 * ### Cost model
 *
 * Globs layer onto the walker's output; no new stat calls are made.
 * Compiled matchers are cached per call (single picomatch compile
 * per `patterns`/`exclude` entry) so walking 10k files costs ~2
 * compile calls + 10k `(rel|basename) → bool` invocations.
 */

import picomatch from "picomatch";
import type { GlobOptions, GlobResult, WalkOptions } from "./types.js";
import { walkFiles } from "./walker.js";

/**
 * A precompiled matcher for one pattern. We keep the original pattern
 * around for debug / tests, and cache whether it's "path-mode" or
 * "basename-mode" so the per-file call doesn't do that branch every
 * time.
 */
type CompiledMatcher = {
  pattern: string;
  /** picomatch compiled fn. */
  test: (input: string) => boolean;
  /** When true, test against `rel`; when false, test against basename. */
  pathMode: boolean;
};

function compileMatcher(pattern: string): CompiledMatcher {
  return {
    pattern,
    test: picomatch(pattern, { dot: true }),
    pathMode: pattern.includes("/"),
  };
}

/** Compile an optional single-or-array patterns field into matchers. */
function compileMatchers(
  patterns: string | readonly string[] | undefined
): CompiledMatcher[] {
  if (patterns === undefined) {
    return [];
  }
  const list = typeof patterns === "string" ? [patterns] : patterns;
  return list.map(compileMatcher);
}

/** Test a rel path against any/all of the compiled matchers. */
function matchesAny(
  matchers: readonly CompiledMatcher[],
  relPath: string,
  basename: string
): boolean {
  for (const m of matchers) {
    if (m.test(m.pathMode ? relPath : basename)) {
      return true;
    }
  }
  return false;
}

/** Extract the basename (last `/` segment) from a POSIX path. */
function basenameOf(rel: string): string {
  const slashIdx = rel.lastIndexOf("/");
  return slashIdx === -1 ? rel : rel.slice(slashIdx + 1);
}

/**
 * Narrow the walker's root when `opts.path` is set. We leave the
 * path combination to `walkFiles` — it expects an absolute `cwd`.
 */
function walkerRoot(cwd: string, sub: string | undefined): string {
  if (!sub) {
    return cwd;
  }
  // Use node:path for portability; `path.resolve` handles both
  // absolute and relative sub-paths sanely (absolute wins). Callers
  // that want a sandbox should prevalidate before reaching here.
  const path = require("node:path") as typeof import("node:path");
  return path.resolve(cwd, sub);
}

/**
 * Yield relative paths under `opts.cwd` that match at least one of
 * `opts.patterns` and none of `opts.exclude`.
 *
 * Emits in walker order (lexicographic per-directory; see
 * `walker.ts::compareByName`).
 *
 * The `opts.patterns` field is required — a glob with no patterns
 * returns immediately.
 */
export async function* globFiles(opts: GlobOptions): AsyncGenerator<string> {
  const includes = compileMatchers(opts.patterns);
  if (includes.length === 0) {
    return;
  }
  const excludes = compileMatchers(opts.exclude);

  const root = walkerRoot(opts.cwd, opts.path);
  const walkOpts: WalkOptions = {
    cwd: root,
    alwaysSkipDirs: opts.alwaysSkipDirs,
    respectGitignore: opts.respectGitignore,
    nestedGitignore: opts.nestedGitignore,
    hidden: opts.hidden,
    maxDepth: opts.maxDepth,
    minDepth: opts.minDepth,
    descentHook: opts.descentHook,
    followSymlinks: opts.followSymlinks,
    signal: opts.signal,
    timeBudgetMs: opts.timeBudgetMs,
  };

  const maxResults = opts.maxResults ?? Number.POSITIVE_INFINITY;
  let emitted = 0;

  for await (const entry of walkFiles(walkOpts)) {
    // entry.relativePath is relative to the walker's root, which is
    // `opts.path`-anchored. Convert to a cwd-relative path so the
    // public output is always relative to the caller's cwd.
    const relToRoot = entry.relativePath;
    const basename = basenameOf(relToRoot);
    if (!matchesAny(includes, relToRoot, basename)) {
      continue;
    }
    if (excludes.length > 0 && matchesAny(excludes, relToRoot, basename)) {
      continue;
    }

    const relToCwd = opts.path ? joinPosix(opts.path, relToRoot) : relToRoot;
    yield relToCwd;
    emitted += 1;
    if (emitted >= maxResults) {
      return;
    }
  }
}

/** Join two POSIX-style path segments with a single separator. */
function joinPosix(a: string, b: string): string {
  const left = a.endsWith("/") ? a.slice(0, -1) : a;
  const right = b.startsWith("/") ? b.slice(1) : b;
  return `${left}/${right}`;
}

/**
 * Drain `globFiles` into a sorted array and report whether the walk
 * was truncated by `maxResults`.
 *
 * Sort key: byte-lexicographic on the relative path. This matches
 * `Array.prototype.sort`'s default and is stable across runs.
 *
 * We forward `maxResults + 1` to the iterator so we can distinguish
 * "exactly N matches" from "more than N matches were available".
 */
export async function collectGlob(opts: GlobOptions): Promise<GlobResult> {
  const maxResults = opts.maxResults ?? Number.POSITIVE_INFINITY;
  const probeLimit = Number.isFinite(maxResults)
    ? Math.min(Number.MAX_SAFE_INTEGER, maxResults + 1)
    : Number.POSITIVE_INFINITY;

  const files: string[] = [];
  let truncated = false;
  for await (const file of globFiles({ ...opts, maxResults: probeLimit })) {
    if (files.length >= maxResults) {
      truncated = true;
      break;
    }
    files.push(file);
  }
  files.sort();
  return { files, truncated };
}
