/**
 * Pure-TS grep engine.
 *
 * Layers regex matching onto `walkFiles`:
 *   1. Walk cwd with the caller's filters (extensions, depth, gitignore).
 *   2. Post-filter yields by `isBinary` + include/exclude globs.
 *   3. Read each surviving file's content and test line-by-line.
 *   4. Emit `GrepMatch` entries as they arrive.
 *
 * ### Primary API
 *
 * `grepFiles(opts)` returns an `AsyncIterable<GrepMatch>` that streams
 * matches as they're discovered. Consumer-initiated `break` halts
 * in-flight work via the shared early-exit flag inside
 * `mapFilesConcurrentStream`.
 *
 * `collectGrep(opts)` drains the iterable into a sorted array +
 * aggregate stats — the Promise-returning variant init-wizard style
 * callers want.
 *
 * ### File-reading strategy
 *
 * Full slurp via `Bun.file(path).text()`. The walker's
 * `maxFileSize` (default 256 KB) caps the blast radius; minified
 * bundles bigger than that never reach us. Line splitting via
 * `content.split("\n")` — fine for utf-8 text, preserves `\r` on
 * CRLF files verbatim.
 *
 * ### Regex strategy
 *
 * `compilePattern` produces a `g`-less RegExp. Each line gets a
 * fresh `regex.test(line)` — no `lastIndex` state to reset. Inline
 * flags `(?i)` / `(?im)` / `(?i:...)` are translated to JS flags.
 */

import picomatch from "picomatch";
import { handleFileError } from "../dsn/fs-utils.js";
import {
  type ConcurrentOptions,
  mapFilesConcurrentStream,
} from "./concurrent.js";
import { compilePattern, ensureGlobalMultilineFlags } from "./regex.js";
import type {
  GrepMatch,
  GrepOptions,
  GrepResult,
  GrepStats,
  WalkEntry,
  WalkOptions,
} from "./types.js";
import { walkFiles } from "./walker.js";

/** Default line-truncation length for the init-wizard wire shape. */
const DEFAULT_MAX_LINE_LENGTH = 2000;

/** Compiled per-pattern glob matcher. See glob.ts for the shape. */
type CompiledMatcher = {
  test: (input: string) => boolean;
  pathMode: boolean;
};

function compileMatchers(
  patterns: string | readonly string[] | undefined
): CompiledMatcher[] {
  if (patterns === undefined) {
    return [];
  }
  const list = typeof patterns === "string" ? [patterns] : patterns;
  return list.map((pattern) => ({
    test: picomatch(pattern, { dot: true }),
    pathMode: pattern.includes("/"),
  }));
}

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

function basenameOf(rel: string): string {
  const slashIdx = rel.lastIndexOf("/");
  return slashIdx === -1 ? rel : rel.slice(slashIdx + 1);
}

/**
 * Resolve `opts.path` against `opts.cwd`. When `opts.path` is set the
 * walker runs against the subdir; we map yielded relative paths back
 * into cwd-relative form at the match boundary.
 */
function walkerRoot(cwd: string, sub: string | undefined): string {
  if (!sub) {
    return cwd;
  }
  const path = require("node:path") as typeof import("node:path");
  return path.resolve(cwd, sub);
}

/**
 * Build a stats object seeded with zeros. Separated so both iterable
 * and collector paths share the init logic.
 */
function createStats(): GrepStats {
  return {
    filesConsidered: 0,
    filesRead: 0,
    filesSkippedBinary: 0,
    matchesEmitted: 0,
    truncated: false,
  };
}

/**
 * Wrap an async iterable to count each yielded entry into `stats`.
 * Lets `grepFiles`' internal pipeline observe the walker's output
 * without re-iterating it.
 */
async function* tapWalkerStats<T extends WalkEntry>(
  source: AsyncIterable<T>,
  stats: GrepStats
): AsyncGenerator<T> {
  for await (const item of source) {
    stats.filesConsidered += 1;
    yield item;
  }
}

/**
 * Filter walker entries by the grep-specific criteria (binary +
 * include/exclude). Files that fail the filter are swallowed; the
 * downstream per-file worker never sees them.
 */
async function* applyGrepFilters(
  source: AsyncIterable<WalkEntry>,
  opts: {
    includes: CompiledMatcher[];
    excludes: CompiledMatcher[];
    includeBinary: boolean;
    stats: GrepStats;
  }
): AsyncGenerator<WalkEntry> {
  for await (const entry of source) {
    if (entry.isBinary && !opts.includeBinary) {
      opts.stats.filesSkippedBinary += 1;
      continue;
    }
    const base = basenameOf(entry.relativePath);
    if (
      opts.includes.length > 0 &&
      !matchesAny(opts.includes, entry.relativePath, base)
    ) {
      continue;
    }
    if (
      opts.excludes.length > 0 &&
      matchesAny(opts.excludes, entry.relativePath, base)
    ) {
      continue;
    }
    yield entry;
  }
}

/**
 * Options bundle for `readAndGrep` — collecting into one param keeps
 * Biome's `useMaxParams` rule happy.
 *
 * The regex is already wrapped with `ensureGlobalFlag` at pipeline
 * entry so `matchAll` works correctly without per-call wrapping.
 */
type PerFileOptions = {
  regex: RegExp;
  maxLineLength: number;
  maxMatchesPerFile: number;
  pathPrefix: string;
};

/**
 * Read one file's content and emit one `GrepMatch` per matching line.
 *
 * ### Implementation note
 *
 * We iterate matches via `content.matchAll(regex)` on the whole
 * buffer rather than `content.split("\n")` + per-line `regex.test`.
 * The split approach allocates one string per line (millions on
 * large repos), which dominates CPU on grep's hot path; whole-buffer
 * matchAll does the same work 10-12× faster because the regex engine
 * already understands `^`/`$`/`\n` and doesn't need a TS-side split.
 *
 * Line numbers are computed by incrementally counting `\n` up to
 * each match's offset with a running cursor — O(content_length) total
 * per file, amortized across all matches. For files with zero matches
 * the line-count work is O(0).
 *
 * Per-line emission: to match the init-wizard / rg contract (one
 * `GrepMatch` per matching line, not per in-line match), we advance
 * the regex's `lastIndex` past the end of the matched line before
 * the next `matchAll` iteration. Without this skip, a regex like
 * `/foo/g` on `"foo foo"` would emit two matches on the same line.
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: per-match cursor + line-number + truncation is inherently branchy
async function readAndGrep(
  entry: WalkEntry,
  opts: PerFileOptions
): Promise<GrepMatch[] | null> {
  let content: string;
  try {
    content = await Bun.file(entry.absolutePath).text();
  } catch (error) {
    handleFileError(error, {
      operation: "scan.grep.readFile",
      path: entry.absolutePath,
    });
    return null;
  }

  const matches: GrepMatch[] = [];
  // Whole-buffer iteration requires `/g`; `/m` makes `^`/`$` match at
  // line boundaries so patterns like `^foo` behave the same way they
  // did under the old split-per-line approach. `ensureGlobalMultilineFlags`
  // returns the input unchanged if both flags are already present.
  const regex = ensureGlobalMultilineFlags(opts.regex);
  // Reset in case the regex is shared across files (it is — one per
  // grep() call). Without this, a `/g` regex's `lastIndex` leaks
  // between files and later files silently skip matches before it.
  regex.lastIndex = 0;

  // Cursor for incremental line-number computation. We walk forward
  // through the buffer, counting `\n` once per match emission. The
  // 10-char constant is `\n`.
  const NEWLINE = 10;
  let lineNum = 1;
  let cursor = 0;
  let match = regex.exec(content);
  while (match !== null) {
    const matchIndex = match.index;
    // Advance line counter to the match position.
    while (cursor < matchIndex) {
      if (content.charCodeAt(cursor) === NEWLINE) {
        lineNum += 1;
      }
      cursor += 1;
    }
    const lineStart = content.lastIndexOf("\n", matchIndex) + 1;
    const lineEnd = content.indexOf("\n", matchIndex);
    const rawLine = content.slice(
      lineStart,
      lineEnd === -1 ? content.length : lineEnd
    );
    const line =
      rawLine.length > opts.maxLineLength
        ? `${rawLine.slice(0, opts.maxLineLength - 1)}…`
        : rawLine;
    matches.push({
      path: opts.pathPrefix
        ? joinPosix(opts.pathPrefix, entry.relativePath)
        : entry.relativePath,
      absolutePath: entry.absolutePath,
      lineNum,
      line,
    });
    if (matches.length >= opts.maxMatchesPerFile) {
      break;
    }
    // Per-line-emission contract: skip past this line's `\n` so the
    // next matchAll iteration starts on a new line. If the match
    // ended the file, we're done.
    if (lineEnd === -1) {
      break;
    }
    regex.lastIndex = lineEnd + 1;
    match = regex.exec(content);
  }

  return matches;
}

/** Join POSIX-style. Local copy to avoid a shared util dependency. */
function joinPosix(a: string, b: string): string {
  const left = a.endsWith("/") ? a.slice(0, -1) : a;
  const right = b.startsWith("/") ? b.slice(1) : b;
  return `${left}/${right}`;
}

/**
 * Build walker options from grep options — the set that `walkFiles`
 * actually consumes. Anything grep-specific stays in grep.
 */
function buildWalkOptions(opts: GrepOptions, root: string): WalkOptions {
  return {
    cwd: root,
    extensions: opts.extensions,
    alwaysSkipDirs: opts.alwaysSkipDirs,
    respectGitignore: opts.respectGitignore,
    nestedGitignore: opts.nestedGitignore,
    hidden: opts.hidden,
    maxDepth: opts.maxDepth,
    minDepth: opts.minDepth,
    maxFileSize: opts.maxFileSize,
    descentHook: opts.descentHook,
    followSymlinks: opts.followSymlinks,
    signal: opts.signal,
    timeBudgetMs: opts.timeBudgetMs,
  };
}

/**
 * Options for `grepFilesInternal` — keeps arity down for Biome.
 */
type GrepPipelineOptions = {
  regex: RegExp;
  perFile: PerFileOptions;
  walkSource: AsyncIterable<WalkEntry>;
  stats: GrepStats;
  concurrent: ConcurrentOptions;
  maxResults: number;
  stopOnFirst: boolean;
};

/**
 * The internal pipeline. Separated from the public entry point so
 * `collectGrep` can share it.
 *
 * `async *` is intentional even though we `yield*` into the
 * `for await` — the whole pipeline is async and callers expect
 * an `AsyncGenerator`.
 */
async function* grepFilesInternal(
  opts: GrepPipelineOptions
): AsyncGenerator<GrepMatch> {
  for await (const match of mapFilesConcurrentStream(
    opts.walkSource,
    (entry) => {
      opts.stats.filesRead += 1;
      return readAndGrep(entry, opts.perFile);
    },
    opts.concurrent
  )) {
    opts.stats.matchesEmitted += 1;
    yield match;
    if (opts.stopOnFirst) {
      opts.stats.truncated = true;
      return;
    }
    if (opts.stats.matchesEmitted >= opts.maxResults) {
      opts.stats.truncated = true;
      return;
    }
  }
}

/**
 * Public entry point — yield one `GrepMatch` per matching line under
 * `opts.cwd`. Consumer `break` halts in-flight work (via the
 * concurrent-stream's internal early-exit flag).
 *
 * Throws `ValidationError` on bad regex input; propagates
 * `AbortError` from the `signal`.
 *
 * The `yield*` delegates to the internal pipeline, which does the
 * actual async work — `async *` is required so callers get an
 * `AsyncGenerator<GrepMatch>`.
 */
// biome-ignore lint/suspicious/useAwait: yield* delegates to async generator
export async function* grepFiles(opts: GrepOptions): AsyncGenerator<GrepMatch> {
  const regex = compilePattern(opts.pattern, {
    caseSensitive: opts.caseSensitive,
    multiline: opts.multiline,
  });
  const includes = compileMatchers(opts.include);
  const excludes = compileMatchers(opts.exclude);
  const includeBinary = opts.includeBinary ?? false;
  const maxResults = opts.maxResults ?? Number.POSITIVE_INFINITY;
  const stopOnFirst = opts.stopOnFirst ?? false;
  const maxLineLength = opts.maxLineLength ?? DEFAULT_MAX_LINE_LENGTH;
  const maxMatchesPerFile = opts.maxMatchesPerFile ?? Number.POSITIVE_INFINITY;

  const root = walkerRoot(opts.cwd, opts.path);
  const walkOpts = buildWalkOptions(opts, root);

  const stats = createStats();
  const walkSource = applyGrepFilters(
    tapWalkerStats(walkFiles(walkOpts), stats),
    { includes, excludes, includeBinary, stats }
  );

  yield* grepFilesInternal({
    regex,
    perFile: {
      regex,
      maxLineLength,
      maxMatchesPerFile,
      pathPrefix: opts.path ?? "",
    },
    walkSource,
    stats,
    concurrent: {
      concurrency: opts.concurrency,
      signal: opts.signal,
    },
    maxResults,
    stopOnFirst,
  });
}

/**
 * Drain `grepFiles` into a sorted-by-[path, lineNum] array alongside
 * aggregate stats. Primary entry point for Promise-returning callers
 * (init wizard, diagnostic scripts).
 *
 * Sort order is stable across runs: byte-lexicographic on `path`,
 * numeric ascending on `lineNum` within a path.
 */
export async function collectGrep(opts: GrepOptions): Promise<GrepResult> {
  // We need visibility into `stats` from the public entry point, so
  // we drive the pipeline ourselves rather than re-awaiting grepFiles.
  const regex = compilePattern(opts.pattern, {
    caseSensitive: opts.caseSensitive,
    multiline: opts.multiline,
  });
  const includes = compileMatchers(opts.include);
  const excludes = compileMatchers(opts.exclude);
  const includeBinary = opts.includeBinary ?? false;
  const maxResults = opts.maxResults ?? Number.POSITIVE_INFINITY;
  const stopOnFirst = opts.stopOnFirst ?? false;
  const maxLineLength = opts.maxLineLength ?? DEFAULT_MAX_LINE_LENGTH;
  const maxMatchesPerFile = opts.maxMatchesPerFile ?? Number.POSITIVE_INFINITY;

  const root = walkerRoot(opts.cwd, opts.path);
  const walkOpts = buildWalkOptions(opts, root);

  const stats = createStats();
  const walkSource = applyGrepFilters(
    tapWalkerStats(walkFiles(walkOpts), stats),
    { includes, excludes, includeBinary, stats }
  );

  const matches: GrepMatch[] = [];
  for await (const match of grepFilesInternal({
    regex,
    perFile: {
      regex,
      maxLineLength,
      maxMatchesPerFile,
      pathPrefix: opts.path ?? "",
    },
    walkSource,
    stats,
    concurrent: {
      concurrency: opts.concurrency,
      signal: opts.signal,
    },
    maxResults,
    stopOnFirst,
  })) {
    matches.push(match);
  }
  matches.sort(compareMatches);
  return { matches, stats };
}

/** [path, lineNum] lexicographic comparator for stable collectGrep output. */
function compareMatches(a: GrepMatch, b: GrepMatch): number {
  if (a.path < b.path) {
    return -1;
  }
  if (a.path > b.path) {
    return 1;
  }
  return a.lineNum - b.lineNum;
}
