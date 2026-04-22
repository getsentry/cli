/**
 * Streaming DFS directory walker with time-budgeted exploration.
 *
 * ### Contract
 *
 * `walkFiles(opts)` returns an `AsyncIterable<WalkEntry>` yielding one
 * entry per regular file under `opts.cwd`. Directories are traversed
 * but never yielded. Symbolic links are skipped unless
 * `followSymlinks: true`. Paths are POSIX-normalized.
 *
 * ### Depth + time budget
 *
 * The walker visits every directory at depth ≤ `minDepth` regardless
 * of wall-clock — that's the exhaustive-scan guarantee. Beyond
 * `minDepth`, each candidate descent is gated on
 * `clock() - startedAt ≤ timeBudgetMs`. When the budget is blown,
 * already-queued directories at any depth still drain (their contents
 * are yielded) but no new dirs at `depth > minDepth` are pushed.
 *
 * Traversal is DFS. Entries within a directory are sorted
 * lexicographically so yield order is deterministic across
 * filesystems — tests depend on this.
 *
 * ### Ignore integration
 *
 * The walker consults the provided `IgnoreMatcher` before descending
 * into a directory (so `node_modules` et al. are never opened) and
 * before yielding each file. Nested `.gitignore` files are loaded
 * lazily: after `readdir`, the walker scans the dentry list for a
 * `.gitignore` file and only calls `matcher.loadFromDir(absDir)`
 * when one is present. This avoids a failing `Bun.file(...).text()`
 * on every subdirectory without a `.gitignore` — the dominant cost
 * we found in PR 1's benchmark.
 *
 * ### AbortSignal
 *
 * When `signal.aborted` becomes true, the generator throws a
 * `DOMException("Walk aborted", "AbortError")` on its next advance.
 * Entries already yielded remain valid.
 */

import { type Dirent, readdirSync, statSync } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { handleFileError } from "../dsn/fs-utils.js";
import { logger } from "../logger.js";
import { classifyByExtension, readHeadAndSniff } from "./binary.js";
import {
  DEFAULT_SKIP_DIRS,
  MAX_FILE_SIZE,
  TEXT_EXTENSIONS,
} from "./constants.js";
import { IgnoreStack } from "./ignore.js";
import type { IgnoreMatcher, WalkEntry, WalkOptions } from "./types.js";

const log = logger.withTag("scan-walk");

/**
 * Native path separator cached to avoid `path.sep` property lookup
 * on every entry in the hot loop. `/` on POSIX, `\` on Windows.
 */
const NATIVE_SEP = path.sep;
/** True when the native separator is POSIX (`/`) — skip normalizePath. */
const POSIX_NATIVE = NATIVE_SEP === path.posix.sep;

/** Entry on the walker's DFS stack. */
type DirFrame = {
  absDir: string;
  /** Depth of this directory. Files inside it are at `depth + 1`. */
  depth: number;
};

/** Telemetry-ish counters collected over a single walk. */
type WalkStats = {
  filesYielded: number;
  dirsVisited: number;
  filesSkippedBySize: number;
  filesSkippedByBinary: number;
  hitTimeBudget: boolean;
  maxDepthReached: number;
};

/**
 * Aggregate of everything the per-entry helpers need. Collecting these
 * into one record keeps each helper's arity small — Biome's
 * `useMaxParams` rule caps us at 4 (plus `this`), and individually
 * passing cfg/matcher/stats/stack/budget state would blow past that.
 */
type WalkContext = {
  cfg: NormalizedOptions;
  matcher: IgnoreMatcher;
  stats: WalkStats;
  startedAt: number;
  stack: DirFrame[];
  visitedInodes: Set<string>;
  /**
   * Precomputed `cfg.cwd.length + 1` — used to slice the cwd prefix
   * off absolute paths to produce relative paths. Cached on the
   * context so the hot loop doesn't recompute.
   */
  cwdPrefixLen: number;
};

/**
 * Walk `opts.cwd` recursively and yield every file that passes the
 * extension + size + ignore filters, up to the configured depth / time
 * budget.
 */
export function walkFiles(opts: WalkOptions): AsyncIterable<WalkEntry> {
  return {
    [Symbol.asyncIterator]() {
      return walkFilesImpl(opts);
    },
  };
}

async function* walkFilesImpl(opts: WalkOptions): AsyncGenerator<WalkEntry> {
  const cfg = normalizeOptions(opts);
  const matcher = await buildMatcher(cfg);
  const stats: WalkStats = {
    filesYielded: 0,
    dirsVisited: 0,
    filesSkippedBySize: 0,
    filesSkippedByBinary: 0,
    hitTimeBudget: false,
    maxDepthReached: 0,
  };
  const startedAt = cfg.clock();

  const visitedInodes = new Set<string>();
  const stack: DirFrame[] = [{ absDir: cfg.cwd, depth: 0 }];

  const ctx: WalkContext = {
    cfg,
    matcher,
    stats,
    startedAt,
    stack,
    visitedInodes,
    cwdPrefixLen: cfg.cwd.length + 1,
  };

  try {
    while (stack.length > 0) {
      checkAborted(cfg.signal);
      const frame = stack.pop() as DirFrame;
      stats.dirsVisited += 1;
      stats.maxDepthReached = Math.max(stats.maxDepthReached, frame.depth);

      const entries = listDirEntries(frame.absDir);
      // Dentry-driven nested .gitignore loading: ONLY call loadFromDir
      // when a .gitignore file is actually present in the directory
      // listing we already read. This avoids a failed open + thrown
      // Error on every subdir without a .gitignore — the dominant cost
      // uncovered by PR 1's bench. The root cwd's .gitignore is
      // already loaded by IgnoreStack.create(), so skip it here.
      if (
        cfg.nestedGitignore &&
        frame.absDir !== cfg.cwd &&
        hasGitignore(entries)
      ) {
        await matcher.loadFromDir(frame.absDir);
      }

      // Observer hook for consumers that need per-directory mtimes
      // (primarily the DSN scanner's cache invalidation). Gated on
      // the hook being defined — unset means we skip the extra stat.
      if (cfg.onDirectoryVisit) {
        await notifyDirectoryVisit(frame.absDir, cfg.onDirectoryVisit);
      }

      for (const entry of entries) {
        const result = await processEntry(entry, frame, ctx);
        if (result !== null) {
          yield result;
        }
      }
    }
  } finally {
    log.debug(
      "walk done: yielded=%d dirs=%d hitBudget=%s maxDepth=%d elapsed=%dms",
      stats.filesYielded,
      stats.dirsVisited,
      stats.hitTimeBudget,
      stats.maxDepthReached,
      Math.round(cfg.clock() - startedAt)
    );
  }
}

/**
 * Process a single directory entry: skip / descend / yield.
 *
 * Extracted from the generator body purely to keep cognitive complexity
 * under Biome's ceiling. Mutates `ctx.stats`, pushes directories onto
 * `ctx.stack`, and returns a `WalkEntry` when a file should be yielded.
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: filter cascade (hidden, symlink, dir, file, ignore, ext) is inherently branchy
async function processEntry(
  entry: Dirent,
  frame: DirFrame,
  ctx: WalkContext
): Promise<WalkEntry | null> {
  const { cfg, matcher } = ctx;
  if (!cfg.hidden && entry.name.startsWith(".")) {
    return null;
  }
  if (entry.isSymbolicLink() && !cfg.followSymlinks) {
    return null;
  }
  // String-concat `abs` rather than `path.join` — measured ~10× faster
  // in V8 (no normalization pass on inputs we already know are clean:
  // `frame.absDir` is absolute-and-unslashed, `entry.name` has no
  // separators per POSIX dirent semantics).
  const abs = frame.absDir + NATIVE_SEP + entry.name;
  // Slice under `cwd` rather than `path.relative` — measured ~11×
  // faster. Safe here because every `abs` is guaranteed to be under
  // `cfg.cwd` by construction (we only descend from `cwd`). On
  // Windows, convert native `\` to POSIX `/` for downstream
  // consumers (the `ignore` package requires POSIX paths).
  const relNative = abs.slice(ctx.cwdPrefixLen);
  const rel = POSIX_NATIVE ? relNative : relNative.replaceAll(NATIVE_SEP, "/");

  // For regular dirs/files, the Dirent already tells us the type.
  // For symlinks (when `followSymlinks: true`), we need to `stat()`
  // the target to learn whether it resolves to a file or a directory.
  // `readdir({withFileTypes})` uses lstat semantics: `isSymbolicLink`
  // returns true while `isFile`/`isDirectory` are both false. Without
  // this extra stat, symlinks would fall through `isDirectory()` +
  // `isFile()` and be silently dropped.
  let isDir: boolean;
  let isFile: boolean;
  if (entry.isSymbolicLink() && cfg.followSymlinks) {
    const resolved = await statSymlinkTarget(abs);
    if (!resolved) {
      // Broken symlink or stat error — skip (matches rg's behavior).
      return null;
    }
    isDir = resolved.isDirectory;
    isFile = resolved.isFile;
  } else {
    isDir = entry.isDirectory();
    isFile = entry.isFile();
  }

  if (isDir) {
    await maybeDescend(abs, rel, frame.depth, ctx);
    return null;
  }
  if (!isFile) {
    return null;
  }
  // `maxDepth` controls directory descent, not file yield. Once the
  // walker has entered a dir, every file inside it is eligible —
  // matches Unix `find -maxdepth` semantics.
  const fileDepth = frame.depth + 1;
  if (matcher.isIgnored(rel, false)) {
    return null;
  }
  if (cfg.extensions !== undefined) {
    // Manual extname — `path.extname + toLowerCase` costs ~9ms for
    // 13k calls in V8 (lots of branches checking for . and
    // separator boundaries); `lastIndexOf + slice + toLowerCase`
    // costs ~7ms. Not a huge win per-call but adds up on hot walks.
    const name = entry.name;
    const dot = name.lastIndexOf(".");
    if (dot <= 0) {
      return null;
    }
    const ext = name.slice(dot).toLowerCase();
    if (!cfg.extensions.has(ext)) {
      return null;
    }
  }
  return tryYieldFile(
    { absPath: abs, relPath: rel, fileDepth },
    cfg,
    ctx.stats
  );
}

/** Push a child directory onto the stack if filters allow. */
async function maybeDescend(
  abs: string,
  rel: string,
  parentDepth: number,
  ctx: WalkContext
): Promise<void> {
  const { cfg, matcher } = ctx;
  // Default descent is depth + 1; callers (e.g. DSN scanner) can
  // override via `descentHook` to reset depth at monorepo package
  // boundaries. The hook receives the PARENT's depth, not the child's.
  const nextDepth = cfg.descentHook(rel, parentDepth);
  if (nextDepth > cfg.maxDepth) {
    return;
  }
  if (matcher.isIgnored(rel, true)) {
    return;
  }
  // Time-budget check: the walker guarantees every directory at depth
  // ≤ `minDepth` is fully explored regardless of wall-clock. Beyond
  // that, we skip new descents once the budget is blown. `nextDepth`
  // (not parentDepth) is what matters — we're deciding whether to
  // visit the child at nextDepth.
  if (
    nextDepth > cfg.minDepth &&
    cfg.clock() - ctx.startedAt > cfg.timeBudgetMs
  ) {
    ctx.stats.hitTimeBudget = true;
    return;
  }
  if (cfg.followSymlinks) {
    const key = await inodeKey(abs);
    if (key && ctx.visitedInodes.has(key)) {
      return;
    }
    if (key) {
      ctx.visitedInodes.add(key);
    }
  }
  // Nested-.gitignore loading is now done by the main loop based on
  // the child's dentry list — not here. See `hasGitignore` call in
  // walkFilesImpl.
  ctx.stack.push({ absDir: abs, depth: nextDepth });
}

/**
 * True if the dentry list contains a regular file named `.gitignore`.
 * A cheap dentry scan avoids the failing `Bun.file().text()` attempt
 * on every directory that doesn't have one — the dominant cost in
 * PR 1's benchmark.
 */
function hasGitignore(entries: readonly Dirent[]): boolean {
  for (const entry of entries) {
    if (entry.name === ".gitignore" && entry.isFile()) {
      return true;
    }
  }
  return false;
}

/** Loose bundle of path + depth for `tryYieldFile`. */
type FileCoords = {
  absPath: string;
  relPath: string;
  fileDepth: number;
};

/**
 * Classify, stat, and build a `WalkEntry`. Returns null on fs errors.
 *
 * Uses `statSync` rather than `Bun.file(absPath).size` / `.lastModified`.
 * Measured ~15% faster per call (30ms vs 36ms for 10k files in the
 * synthetic/large fixture) because it avoids the `Bun.file()` handle
 * allocation when we only want stat data. When `recordMtimes: false`
 * (the grep default), the same single `statSync` call serves both
 * the size check and the stat read — no extra syscall needed.
 */
async function tryYieldFile(
  coords: FileCoords,
  cfg: NormalizedOptions,
  stats: WalkStats
): Promise<WalkEntry | null> {
  let statResult: { size: number; mtimeMs: number };
  try {
    const s = statSync(coords.absPath);
    statResult = { size: s.size, mtimeMs: s.mtimeMs };
  } catch (error) {
    handleFileError(error, {
      operation: "scan.walk.stat",
      path: coords.absPath,
    });
    return null;
  }

  if (statResult.size > cfg.maxFileSize) {
    stats.filesSkippedBySize += 1;
    return null;
  }

  try {
    const isBinary = await classifyFile(coords.absPath, statResult.size, cfg);
    stats.filesYielded += 1;
    return {
      absolutePath: coords.absPath,
      relativePath: coords.relPath,
      size: statResult.size,
      // Floor mtimeMs so DSN cache keys (which compare on floored
      // values — see `code-scanner.ts::sourceMtimes` docs) stay
      // stable across invocations. Raw mtimeMs is a float that can
      // differ by ~1e-6 between reads of the same inode.
      mtime: cfg.recordMtimes ? Math.floor(statResult.mtimeMs) : 0,
      isBinary,
      depth: coords.fileDepth,
    };
  } catch (error) {
    handleFileError(error, {
      operation: "scan.walk.readFile",
      path: coords.absPath,
    });
    return null;
  }
}

/**
 * Classify a file as binary via extension fast-path or 8 KB NUL sniff.
 *
 * Skip the sniff for:
 *   (a) callers that provided an `extensions` allowlist — the file
 *       already passed it, so by construction the caller considers
 *       its extension text-bearing;
 *   (b) known text extensions (`TEXT_EXTENSIONS`);
 *   (c) empty files.
 *
 * Ordering matters: (a) runs first so we never re-compute
 * `path.extname` + `Set.has` for the hot DSN-scan path where
 * `processEntry` has already matched the extension.
 */
async function classifyFile(
  absPath: string,
  size: number,
  cfg: NormalizedOptions
): Promise<boolean> {
  if (cfg.extensions !== undefined) {
    // (a) caller filtered — skip re-classification.
    return false;
  }
  const byExt = classifyByExtension(absPath, TEXT_EXTENSIONS);
  if (byExt !== null) {
    return byExt.isBinary;
  }
  if (size === 0) {
    return false;
  }
  try {
    const result = await readHeadAndSniff(absPath);
    return result.isBinary;
  } catch (error) {
    handleFileError(error, {
      operation: "scan.walk.classifyFile",
      path: absPath,
    });
    // Fail closed: treat as binary when we can't read, so callers that
    // ignore binaries won't trip on an unreadable file.
    return true;
  }
}

/** Lexicographic compare on `entry.name` for stable iteration order. */
function compareByName(a: Dirent, b: Dirent): number {
  if (a.name < b.name) {
    return -1;
  }
  if (a.name > b.name) {
    return 1;
  }
  return 0;
}

/**
 * Read all entries in a directory, sorted by name for determinism.
 *
 * Uses synchronous `readdirSync({withFileTypes})` rather than the
 * async variant. Per-call cost is ~11µs p50 / 65µs max on a 10k-file
 * fixture — well below the ~4ms min latency of a microtask tick, so
 * blocking the event loop briefly per directory is cheap AND avoids
 * the ~60µs microtask overhead each async readdir incurs. Net: the
 * sync readdir is 2-3× faster on walks with many small directories,
 * which is every realistic CLI/codebase workload.
 *
 * Sort is retained so yield order is filesystem-independent, which
 * tests rely on.
 */
function listDirEntries(dir: string): Dirent[] {
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    entries.sort(compareByName);
    return entries;
  } catch (error) {
    handleFileError(error, { operation: "scan.walk.readdir", path: dir });
    return [];
  }
}

/**
 * Fire the `onDirectoryVisit` observer with the directory's
 * `Math.floor(stat.mtimeMs)`. Errors are routed through
 * `handleFileError` and swallowed — a stat failure shouldn't abort
 * the walk.
 *
 * Uses `node:fs.stat` because `Bun.file()` doesn't support
 * directories. Flooring matches `src/lib/db/dsn-cache.ts`'s
 * `validateDirMtime`.
 */
async function notifyDirectoryVisit(
  absDir: string,
  hook: (dir: string, mtimeMs: number) => void
): Promise<void> {
  try {
    const s = await stat(absDir);
    hook(absDir, Math.floor(s.mtimeMs));
  } catch (error) {
    handleFileError(error, {
      operation: "scan.walk.dirMtime",
      path: absDir,
    });
  }
}

/** stat-based `dev:ino` key for symlink cycle detection. */
async function inodeKey(absPath: string): Promise<string | null> {
  try {
    const s = await stat(absPath);
    return `${s.dev}:${s.ino}`;
  } catch (error) {
    handleFileError(error, { operation: "scan.walk.inodeKey", path: absPath });
    return null;
  }
}

/**
 * Resolve what a symlink points to. Returns `null` when the target
 * is missing (broken symlink) or the stat otherwise fails — in both
 * cases the caller should skip the entry the way ripgrep does.
 *
 * Uses `stat` (which follows symlinks) rather than `lstat` so we see
 * the target's true kind. Cycle detection happens later in
 * `maybeDescend` via `inodeKey`.
 */
async function statSymlinkTarget(
  absPath: string
): Promise<{ isFile: boolean; isDirectory: boolean } | null> {
  try {
    const s = await stat(absPath);
    return { isFile: s.isFile(), isDirectory: s.isDirectory() };
  } catch (error) {
    // ENOENT (broken symlink) is the expected failure case — swallow.
    // Other errors go through handleFileError so Sentry sees them.
    handleFileError(error, {
      operation: "scan.walk.statSymlinkTarget",
      path: absPath,
    });
    return null;
  }
}

/** Throw an AbortError if the caller's signal has fired. */
function checkAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    // DOMException is available in Bun and Node >= 17.
    throw new DOMException("Walk aborted", "AbortError");
  }
}

type NormalizedOptions = {
  cwd: string;
  extensions: ReadonlySet<string> | undefined;
  alwaysSkipDirs: readonly string[];
  hidden: boolean;
  respectGitignore: boolean;
  nestedGitignore: boolean;
  maxFileSize: number;
  minDepth: number;
  maxDepth: number;
  descentHook: (relPath: string, currentDepth: number) => number;
  followSymlinks: boolean;
  signal: AbortSignal | undefined;
  timeBudgetMs: number;
  clock: () => number;
  recordMtimes: boolean;
  onDirectoryVisit: ((absDir: string, mtimeMs: number) => void) | undefined;
};

/** Default descent: linear depth counting. */
const defaultDescentHook = (_relPath: string, currentDepth: number): number =>
  currentDepth + 1;

function normalizeOptions(opts: WalkOptions): NormalizedOptions {
  if (!path.isAbsolute(opts.cwd)) {
    throw new Error(`walkFiles: cwd must be absolute, got ${opts.cwd}`);
  }
  return {
    cwd: opts.cwd,
    extensions: opts.extensions,
    alwaysSkipDirs: opts.alwaysSkipDirs ?? DEFAULT_SKIP_DIRS,
    hidden: opts.hidden ?? true,
    respectGitignore: opts.respectGitignore ?? true,
    nestedGitignore: opts.nestedGitignore ?? true,
    maxFileSize: opts.maxFileSize ?? MAX_FILE_SIZE,
    minDepth: opts.minDepth ?? 0,
    maxDepth: opts.maxDepth ?? Number.POSITIVE_INFINITY,
    descentHook: opts.descentHook ?? defaultDescentHook,
    followSymlinks: opts.followSymlinks ?? false,
    signal: opts.signal,
    timeBudgetMs: opts.timeBudgetMs ?? Number.POSITIVE_INFINITY,
    clock: opts.clock ?? (() => performance.now()),
    recordMtimes: opts.recordMtimes ?? false,
    onDirectoryVisit: opts.onDirectoryVisit,
  };
}

function buildMatcher(cfg: NormalizedOptions): Promise<IgnoreMatcher> {
  return IgnoreStack.create({
    cwd: cfg.cwd,
    alwaysSkipDirs: cfg.alwaysSkipDirs,
    respectGitignore: cfg.respectGitignore,
    // Only relevant when respectGitignore: true; IgnoreStack handles
    // the gate internally but we pass an explicit value for clarity.
    includeGitInfoExclude: cfg.respectGitignore,
  });
}
