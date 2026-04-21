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

import { handleFileError } from "../dsn/fs-utils.js";
import {
  type ConcurrentOptions,
  mapFilesConcurrentStream,
} from "./concurrent.js";
import {
  basenameOf,
  type CompiledMatcher,
  compileMatchers,
  joinPosix,
  matchesAny,
  walkerRoot,
} from "./path-utils.js";
import {
  compilePattern,
  ensureGlobalFlag,
  ensureGlobalMultilineFlags,
} from "./regex.js";
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
 * The regex is cloned per file at the top of `readAndGrep` so each
 * worker gets its own `lastIndex`. The `multiline` flag controls
 * whether `/m` is applied (line-boundary anchoring on) or not
 * (buffer-boundary anchoring); we can't infer this from `regex.flags`
 * because the caller's intent matters independent of whatever flags
 * `compilePattern` already set.
 */
type PerFileOptions = {
  regex: RegExp;
  multiline: boolean;
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
  // Whole-buffer iteration requires `/g`. `/m` (line-boundary
  // anchoring) is applied when the caller opts into grep-like
  // semantics via `opts.multiline` (the default — see `GrepOptions`
  // docstring). If the caller explicitly set `multiline: false`,
  // anchor `^/$` to the buffer boundaries like raw JS semantics.
  //
  // We clone the regex per file so each invocation has its own
  // `lastIndex`. Today the exec/loop block below runs synchronously
  // with no `await`, so concurrent `readAndGrep` workers can't
  // actually observe each other's `lastIndex` mutations (JS is
  // single-threaded; microtasks only yield at `await`). But the
  // clone is still worth paying — it's ~1µs per file and eliminates
  // the foot-gun if anyone ever introduces an `await` inside the
  // match loop.
  const ensured = opts.multiline
    ? ensureGlobalMultilineFlags(opts.regex)
    : ensureGlobalFlag(opts.regex);
  const regex = new RegExp(ensured.source, ensured.flags);

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
  // Default `multiline: true` — matches grep/rg's line-boundary
  // anchoring semantics. Callers opt out with `multiline: false` for
  // buffer-boundary JS semantics.
  const multiline = opts.multiline ?? true;
  const regex = compilePattern(opts.pattern, {
    caseSensitive: opts.caseSensitive,
    multiline,
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
      multiline,
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
  const multiline = opts.multiline ?? true;
  const regex = compilePattern(opts.pattern, {
    caseSensitive: opts.caseSensitive,
    multiline,
  });
  const includes = compileMatchers(opts.include);
  const excludes = compileMatchers(opts.exclude);
  const includeBinary = opts.includeBinary ?? false;
  const maxResults = opts.maxResults ?? Number.POSITIVE_INFINITY;
  const stopOnFirst = opts.stopOnFirst ?? false;
  const maxLineLength = opts.maxLineLength ?? DEFAULT_MAX_LINE_LENGTH;
  const maxMatchesPerFile = opts.maxMatchesPerFile ?? Number.POSITIVE_INFINITY;

  // Ask the iterator for one extra match past `maxResults` so the
  // collector can distinguish "exactly maxResults matches existed"
  // from "more existed but we stopped". Without this +1 probe, the
  // iterator flips `stats.truncated = true` as soon as it emits the
  // N-th match, whether or not an (N+1)-th match was available.
  // Same pattern as `collectGlob`; see the corresponding lore entry
  // on `collectGlob/collectGrep truncation flag`.
  const probeLimit = Number.isFinite(maxResults)
    ? Math.min(Number.MAX_SAFE_INTEGER, maxResults + 1)
    : Number.POSITIVE_INFINITY;

  const root = walkerRoot(opts.cwd, opts.path);
  const walkOpts = buildWalkOptions(opts, root);

  const stats = createStats();
  const walkSource = applyGrepFilters(
    tapWalkerStats(walkFiles(walkOpts), stats),
    { includes, excludes, includeBinary, stats }
  );

  const matches: GrepMatch[] = [];
  let truncated = false;
  for await (const match of grepFilesInternal({
    regex,
    perFile: {
      regex,
      multiline,
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
    maxResults: probeLimit,
    stopOnFirst,
  })) {
    if (matches.length >= maxResults) {
      // We've got the overshoot match — there ARE more results than
      // the caller asked for. Stop draining, flag truncation.
      truncated = true;
      break;
    }
    matches.push(match);
  }
  matches.sort(compareMatches);
  // Reflect the collector-level truncation in the stats bag the
  // iterator populated. Preserves stopOnFirst-path flag (stats.truncated
  // is already set by the iterator in that case).
  if (truncated) {
    stats.truncated = true;
  }
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
