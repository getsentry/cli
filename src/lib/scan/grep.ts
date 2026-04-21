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
import { extractInnerLiteral } from "./literal-extract.js";
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
  /**
   * Optional literal prefilter — when set, the per-file path runs
   * a cheap `indexOf(literal)` gate before invoking the regex
   * engine. Files that don't contain the literal are skipped
   * entirely. Computed once per `collectGrep`/`grepFiles` call via
   * `extractInnerLiteral`.
   *
   * NOTE: the gate is file-level only. We intentionally do NOT use
   * the literal to locate individual matches — patterns that can
   * span newlines (e.g., `foo\sbar` where `\s` matches `\n`) and
   * patterns whose literal differs from the compiled form (e.g.,
   * `\x41foo` matches `Afoo`, not `\x41foo`) would both produce
   * silent misses under per-line verify.
   */
  literal: string | null;
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

  // File-level prefilter gate. If the pattern has an extractable
  // literal, skip the regex engine entirely on files that don't
  // contain the literal — ripgrep's central optimization, adapted.
  //
  // Important: this is a FILE-level gate only. We deliberately do
  // NOT attempt to use the literal to find/verify matches line-by-
  // line. That approach has subtle correctness failures for patterns
  // that can match across newlines (e.g., `foo\sbar` where `\s`
  // matches `\n`) and for patterns whose literal isn't what the
  // regex engine actually matches (e.g., `\x41foo` matches `Afoo`,
  // not the literal string `\x41foo`; and `(?i:foo|bar)baz` compiles
  // to `foo|barbaz` with different alternation structure).
  //
  // Keeping the gate at file-level sidesteps all of that: we only
  // use `indexOf(literal)` to quickly reject files that can't match,
  // and let V8's regex engine handle the actual matching. The perf
  // win is still substantial because most files in a large tree
  // contain zero instances of the literal, and `indexOf` is much
  // cheaper than constructing the regex engine's NFA state.
  //
  // Preconditions for the gate:
  // - Literal must be extractable AND not case-sensitivity-altered
  //   in a way that breaks indexOf (so: either case-sensitive search,
  //   OR content.toLowerCase() preserves length).
  // - The literal must actually be something the compiled regex MUST
  //   match — guaranteed by `extractInnerLiteral` operating on the
  //   compiled regex source (see `setupGrepPipeline`).
  if (opts.literal !== null) {
    const isCaseInsensitive = opts.regex.flags.includes("i");
    // Note: for case-insensitive search, `content.toLowerCase()` may
    // be LONGER than `content` (e.g., Turkish `İ` → `i` + U+0307).
    // That's fine because we only use the result as a boolean gate:
    // "does the literal exist anywhere in this file?" The returned
    // position is never used as a `content` offset — the whole-buffer
    // regex engine does the actual match localization.
    const haystack = isCaseInsensitive ? content.toLowerCase() : content;
    if (haystack.indexOf(opts.literal) === -1) {
      return [];
    }
    // File contains the literal — fall through to the whole-buffer
    // matcher. The regex engine handles the actual matching; the
    // literal gate only ruled out files that can't possibly match.
  }

  return grepByWholeBuffer(content, entry, opts);
}

/**
 * Whole-buffer grep — runs the compiled regex across the full file
 * content, emitting one `GrepMatch` per match's enclosing line.
 *
 * This is the primary matching implementation. The file-level
 * literal gate in `readAndGrep` may skip files that have no chance
 * of matching, but once a file reaches this function the regex
 * engine does the actual work.
 */
function grepByWholeBuffer(
  content: string,
  entry: WalkEntry,
  opts: PerFileOptions
): GrepMatch[] {
  // Whole-buffer iteration requires `/g`. `/m` (line-boundary
  // anchoring) is applied when the caller opts into grep-like
  // semantics via `opts.multiline` (the default — see `GrepOptions`
  // docstring). If the caller explicitly set `multiline: false`,
  // anchor `^/$` to the buffer boundaries like raw JS semantics.
  //
  // We clone the regex per file so each invocation has its own
  // `lastIndex`. Today the exec/loop block runs synchronously with
  // no `await`, so concurrent `readAndGrep` workers can't actually
  // observe each other's `lastIndex` mutations (JS is single-threaded;
  // microtasks only yield at `await`). But the clone is still worth
  // paying — ~1µs per file — to eliminate the foot-gun if anyone
  // ever introduces an `await` inside the match loop.
  const ensured = opts.multiline
    ? ensureGlobalMultilineFlags(opts.regex)
    : ensureGlobalFlag(opts.regex);
  const regex = new RegExp(ensured.source, ensured.flags);
  const ctx: MatchContext = { entry, opts, content };

  const matches: GrepMatch[] = [];
  // Advance `cursor` to each match index using `indexOf("\n", cursor)`
  // in a loop — skipping newline-to-newline instead of walking char-
  // by-char via `charCodeAt`. 2-5× faster because V8 implements
  // `indexOf` in optimized C++ with no per-iteration JS interop.
  let lineNum = 1;
  let cursor = 0;
  let match = regex.exec(content);
  while (match !== null) {
    const matchIndex = match.index;
    let nl = content.indexOf("\n", cursor);
    while (nl !== -1 && nl < matchIndex) {
      lineNum += 1;
      nl = content.indexOf("\n", nl + 1);
    }
    cursor = matchIndex;
    const lineStart = content.lastIndexOf("\n", matchIndex) + 1;
    const lineEndRaw = content.indexOf("\n", matchIndex);
    const lineEnd = lineEndRaw === -1 ? content.length : lineEndRaw;
    matches.push(buildMatch(ctx, { lineNum, lineStart, lineEnd }));
    if (matches.length >= opts.maxMatchesPerFile) {
      break;
    }
    if (lineEndRaw === -1) {
      break;
    }
    regex.lastIndex = lineEnd + 1;
    match = regex.exec(content);
  }
  return matches;
}

/**
 * Per-call context for `buildMatch` — bundles args that stay
 * constant for the duration of a file's scan (entry, opts, content)
 * separately from args that change per match (lineNum, lineStart,
 * lineEnd). Keeps Biome's useMaxParams under the 4-param ceiling.
 */
type MatchContext = {
  entry: WalkEntry;
  opts: PerFileOptions;
  content: string;
};

type LineBounds = {
  lineNum: number;
  lineStart: number;
  lineEnd: number;
};

/** Build a `GrepMatch` record for one line. Shared by all grep paths. */
function buildMatch(ctx: MatchContext, bounds: LineBounds): GrepMatch {
  const rawLine = ctx.content.slice(bounds.lineStart, bounds.lineEnd);
  const line =
    rawLine.length > ctx.opts.maxLineLength
      ? `${rawLine.slice(0, ctx.opts.maxLineLength - 1)}…`
      : rawLine;
  return {
    path: ctx.opts.pathPrefix
      ? joinPosix(ctx.opts.pathPrefix, ctx.entry.relativePath)
      : ctx.entry.relativePath,
    absolutePath: ctx.entry.absolutePath,
    lineNum: bounds.lineNum,
    line,
  };
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
    async (entry) => {
      const matches = await readAndGrep(entry, opts.perFile);
      // `filesRead` is documented as "files whose content was read
      // and tested against the pattern" — only increment when
      // `readAndGrep` actually succeeded (returned a non-null array).
      // A null return means the open failed; we don't count those.
      if (matches !== null) {
        opts.stats.filesRead += 1;
      }
      return matches;
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
 * Resolved pipeline inputs shared by `grepFiles` and `collectGrep`.
 * Extracted so both entry points get the same default-resolution,
 * pattern compilation, matcher compilation, walker construction, and
 * filter wiring — a divergence between the two would be a silent
 * correctness bug.
 */
type GrepPipelineSetup = {
  regex: RegExp;
  multiline: boolean;
  /**
   * Pre-extracted literal prefilter (see `extractInnerLiteral`). Null
   * when the pattern has no safe extractable literal (top-level
   * alternation, all-metachar, etc.). When set, `readAndGrep` uses
   * it as a file-level gate via `indexOf` — files without the literal
   * are skipped entirely.
   */
  literal: string | null;
  stats: GrepStats;
  walkSource: AsyncIterable<WalkEntry>;
  maxResults: number;
  stopOnFirst: boolean;
  maxLineLength: number;
  maxMatchesPerFile: number;
  pathPrefix: string;
  concurrency: number | undefined;
  signal: AbortSignal | undefined;
};

/**
 * Resolve all defaults + compile + wire the walker. Both `grepFiles`
 * and `collectGrep` consume this — keeps defaults in one place.
 *
 * Extracts a literal prefix/substring from the compiled regex (if
 * possible) so the per-file path can use `indexOf` as a file-level
 * gate. The gate is conservative: we only use it to skip files that
 * can't possibly contain a match; the whole-buffer matcher handles
 * the actual matching.
 */
function setupGrepPipeline(opts: GrepOptions): GrepPipelineSetup {
  // Default `multiline: true` — matches grep/rg's line-boundary
  // anchoring semantics. Callers opt out with `multiline: false` for
  // buffer-boundary JS semantics.
  const multiline = opts.multiline ?? true;
  const regex = compilePattern(opts.pattern, {
    caseSensitive: opts.caseSensitive,
    multiline,
  });

  // Literal extraction runs on the COMPILED regex's source, not the
  // raw user input. `compilePattern` rewrites scoped inline flags
  // like `(?i:foo|bar)baz` — strip the group and widen the flag,
  // which yields `foo|barbaz` (source) + `i` (flag). The rewritten
  // source has top-level alternation the original lacked. If we
  // extracted from the original, `hasTopLevelAlternation` would miss
  // it and we'd extract `"baz"` as a "required" literal — but the
  // compiled regex can match `foo` alone, silently dropping lines
  // that match the first branch of the alternation.
  //
  // Always extract from `regex.source` so the extractor sees what
  // the regex engine will actually run. `regex.flags` is authoritative
  // for case-sensitivity either way.
  const literal = extractInnerLiteral(regex.source, regex.flags);

  const includes = compileMatchers(opts.include);
  const excludes = compileMatchers(opts.exclude);
  const includeBinary = opts.includeBinary ?? false;

  const root = walkerRoot(opts.cwd, opts.path);
  const walkOpts = buildWalkOptions(opts, root);

  const stats = createStats();
  const walkSource = applyGrepFilters(
    tapWalkerStats(walkFiles(walkOpts), stats),
    { includes, excludes, includeBinary, stats }
  );

  return {
    regex,
    multiline,
    literal,
    stats,
    walkSource,
    maxResults: opts.maxResults ?? Number.POSITIVE_INFINITY,
    stopOnFirst: opts.stopOnFirst ?? false,
    maxLineLength: opts.maxLineLength ?? DEFAULT_MAX_LINE_LENGTH,
    maxMatchesPerFile: opts.maxMatchesPerFile ?? Number.POSITIVE_INFINITY,
    pathPrefix: opts.path ?? "",
    concurrency: opts.concurrency,
    signal: opts.signal,
  };
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
  const setup = setupGrepPipeline(opts);

  yield* grepFilesInternal({
    regex: setup.regex,
    perFile: {
      regex: setup.regex,
      multiline: setup.multiline,
      maxLineLength: setup.maxLineLength,
      maxMatchesPerFile: setup.maxMatchesPerFile,
      pathPrefix: setup.pathPrefix,
      literal: setup.literal,
    },
    walkSource: setup.walkSource,
    stats: setup.stats,
    concurrent: {
      concurrency: setup.concurrency,
      signal: setup.signal,
    },
    maxResults: setup.maxResults,
    stopOnFirst: setup.stopOnFirst,
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
  const setup = setupGrepPipeline(opts);

  // Ask the iterator for one extra match past `maxResults` so we can
  // distinguish "exactly maxResults matches existed" from "more
  // existed but we stopped". Without this +1 probe, the iterator
  // would flip `stats.truncated = true` the moment it emits the
  // N-th match, regardless of whether an (N+1)-th was available.
  // Same pattern as `collectGlob`; see the lore entry on
  // `collectGlob/collectGrep truncation flag`.
  const probeLimit = Number.isFinite(setup.maxResults)
    ? Math.min(Number.MAX_SAFE_INTEGER, setup.maxResults + 1)
    : Number.POSITIVE_INFINITY;

  const matches: GrepMatch[] = [];
  let truncated = false;
  for await (const match of grepFilesInternal({
    regex: setup.regex,
    perFile: {
      regex: setup.regex,
      multiline: setup.multiline,
      maxLineLength: setup.maxLineLength,
      maxMatchesPerFile: setup.maxMatchesPerFile,
      pathPrefix: setup.pathPrefix,
      literal: setup.literal,
    },
    walkSource: setup.walkSource,
    stats: setup.stats,
    concurrent: {
      concurrency: setup.concurrency,
      signal: setup.signal,
    },
    maxResults: probeLimit,
    stopOnFirst: setup.stopOnFirst,
  })) {
    if (matches.length >= setup.maxResults) {
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
    setup.stats.truncated = true;
  }
  return { matches, stats: setup.stats };
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
