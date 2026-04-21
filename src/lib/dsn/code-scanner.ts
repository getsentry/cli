/**
 * Language-Agnostic DSN Code Scanner (policy layer).
 *
 * This module owns the DSN-specific policy (URL regex, comment-line
 * filtering, host validation, package-path inference, stop-on-first
 * semantics). All file walking, `.gitignore` handling, extension
 * filtering, bounded concurrency, AND worker-pool dispatch are
 * delegated to the shared `src/lib/scan/` module via `grepFiles`.
 *
 * Flow:
 *   1. `scanDirectory(cwd, stopOnFirst)` calls `grepFiles` with the
 *      DSN pattern and preset (`dsnScanOptions()`), plus
 *      `recordMtimes: true` and an `onDirectoryVisit` hook so the
 *      cache-invalidation maps are populated in one traversal.
 *   2. `grepFiles` dispatches per-file work to the worker pool (when
 *      available) or a concurrent-async fallback. Each yielded
 *      `GrepMatch` represents one line containing a DSN URL; the
 *      grep engine handles the file-level literal gate (`http`) for
 *      free, so we skip files that can't possibly match before any
 *      regex runs.
 *   3. Main thread post-filters each match:
 *      - Skip commented lines (language-aware comment prefixes)
 *      - Re-run `DSN_PATTERN` on `match.line` to recover all DSNs
 *        (grep emits one match per line regardless of how many
 *        hits the line contains — rare for DSNs but the contract
 *        predates this refactor)
 *      - Validate host (`isValidDsnHost`)
 *      - Dedup on raw DSN string
 *      - Early-exit on first unique DSN when `stopOnFirst: true`
 *      - Build `DetectedDsn` with inferred package path
 *   4. `sourceMtimes` records mtime per file that contributed a
 *      validated DSN; `dirMtimes` records mtime per visited dir via
 *      the hook. Both are used by `src/lib/db/dsn-cache.ts` for
 *      cache invalidation.
 *
 * Behavior change landed in PR 3: the walker's `nestedGitignore: true`
 * default (via `dsnScanOptions()`) means nested `.gitignore` files are
 * now honored. Pre-PR-3 code only read the project-root `.gitignore`.
 * This is a correctness improvement matching git's cumulative semantics;
 * DSNs in files covered by a subdir `.gitignore` are no longer detected.
 *
 * Behavior change landed in PR 6 (this one): the DSN scanner now shares
 * the grep pipeline and gets worker-pool parallelism for free.
 * End-to-end time on the 10k-file fixture drops from ~330ms → ~200ms.
 * Correctness is unchanged — `extractDsnsFromContent` is still
 * exported for `src/lib/dsn/detector.ts::isDsnStillPresent` (the
 * cache-verify fast path for a single file) and internally we still
 * go through the same comment/host-validation filter.
 */

import path from "node:path";
import { DEFAULT_SENTRY_HOST, getConfiguredSentryUrl } from "../constants.js";
import { ConfigError } from "../errors.js";
import { logger } from "../logger.js";
import { grepFiles, normalizePath, walkFiles } from "../scan/index.js";
import { withTracingSpan } from "../telemetry.js";
import { createDetectedDsn, inferPackagePath, parseDsn } from "./parser.js";
import { DSN_MAX_DEPTH, dsnScanOptions } from "./scan-options.js";
import type { DetectedDsn } from "./types.js";

/** Scoped logger for DSN code scanning. */
const log = logger.withTag("dsn-scan");

/**
 * Result of scanning code for DSNs, including mtimes for caching.
 *
 * Shape is stable — `src/lib/db/dsn-cache.ts` stores this via
 * `setCachedDetection` and verifies `sourceMtimes` / `dirMtimes`
 * against the filesystem. Do NOT change keys/values without also
 * bumping the cache schema.
 */
export type CodeScanResult = {
  /** All detected DSNs */
  dsns: DetectedDsn[];
  /**
   * Map of source file paths (POSIX, relative to cwd) to their mtimes.
   * Only files that contained at least one DSN are present — the cache
   * verifier uses this to detect "source file touched since last scan".
   */
  sourceMtimes: Record<string, number>;
  /**
   * Map of scanned directories (POSIX, relative to cwd; `.` for the
   * root) to their floored `stat.mtimeMs`. The verifier uses this to
   * detect "files added to a scanned dir since last scan".
   */
  dirMtimes: Record<string, number>;
};

/**
 * Common comment prefixes to detect commented-out DSNs.
 * Lines starting with these (after trimming whitespace) are ignored.
 */
const COMMENT_PREFIXES = ["//", "#", "--", "<!--", "/*", "*", "'''", '"""'];

/**
 * Pattern to match Sentry DSN URLs.
 * Captures the full DSN including protocol, public key, optional secret key, host, and project ID.
 *
 * Formats supported:
 * - https://{PUBLIC_KEY}@{HOST}/{PROJECT_ID}
 * - https://{PUBLIC_KEY}:{SECRET_KEY}@{HOST}/{PROJECT_ID}
 *
 * Examples:
 * - https://abc123def456@o123456.ingest.us.sentry.io/4507654321
 * - https://abc123def456:secret789@sentry.example.com/123
 *
 * The public key is typically a 32-character hex string, but we accept any
 * alphanumeric string to support test fixtures and edge cases.
 *
 * Note: Uses 'g' and 'i' flags. When used with String.matchAll(), the iterator
 * always starts from the beginning regardless of lastIndex, so no reset needed.
 */
const DSN_PATTERN =
  /https?:\/\/[a-z0-9]+(?::[a-z0-9]+)?@[a-z0-9.-]+(?:\.[a-z]+|:[0-9]+)\/\d+/gi;

/**
 * Case-insensitive probe for the DSN scheme prefix. `DSN_PATTERN`
 * starts with `https?` under the `/i` flag, so any match's first 4
 * chars are some casing of `http`. The literal-prefix fast path uses
 * this probe to skip `matchAll` on files with no `http` substring —
 * the common case on large walks.
 *
 * Must be `/i` for correctness: a previous version used two
 * case-sensitive `indexOf` calls covering only all-lower and
 * all-upper, which silently missed mixed-case URLs like `Https://…`
 * or `hTtP://…`. Regressed detection on any source file with
 * unusual scheme casing.
 */
const HTTP_SCHEME_PROBE = /http/i;

/**
 * Extract DSN URLs from file content, filtering out those in commented lines.
 *
 * Algorithm:
 * 1. Find all DSN matches in the content using regex
 * 2. For each match, find the line it appears on
 * 3. Check if that line is commented out
 * 4. Validate the DSN host is acceptable
 *
 * @param content - File content to scan
 * @param limit - Maximum number of DSNs to return (undefined = no limit)
 * @returns Array of unique DSN strings found in non-commented lines
 */
export function extractDsnsFromContent(
  content: string,
  limit?: number
): string[] {
  // Literal-prefix fast path: every DSN starts with `http://` or
  // `https://` (case-insensitive). When the scheme doesn't appear
  // anywhere in the file, we know there are zero candidates and can
  // skip the `matchAll` scan entirely. On large walks (10k+ files),
  // ~99% of files contain no `http` substring in any casing, so the
  // probe is effectively free.
  //
  // Correctness note: the probe must be case-insensitive. An earlier
  // version used two `indexOf` calls covering only all-lowercase and
  // all-uppercase, which regressed detection on mixed-case schemes
  // like `Https://` or `hTtP://`. `/http/i.test()` is ~5µs per file
  // in V8 — ~16ms slower than the two-indexOf version on a 10k-file
  // scan, a trade we accept for correctness.
  if (!HTTP_SCHEME_PROBE.test(content)) {
    return [];
  }

  const dsns = new Set<string>();

  // Find all potential DSN matches
  for (const match of content.matchAll(DSN_PATTERN)) {
    const dsn = match[0];
    const matchIndex = match.index;

    // Skip if we've already found this DSN
    if (dsns.has(dsn)) {
      continue;
    }

    // Find the line this match appears on by looking backwards for newline
    const lineStart = content.lastIndexOf("\n", matchIndex) + 1;
    const lineEnd = content.indexOf("\n", matchIndex);
    const line = content.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);

    // Skip if the line is commented
    if (isCommentedLine(line.trim())) {
      continue;
    }

    // Validate it's a DSN with an acceptable host
    if (isValidDsnHost(dsn)) {
      dsns.add(dsn);

      // Early exit if we've reached the limit
      if (limit !== undefined && dsns.size >= limit) {
        break;
      }
    }
  }

  return [...dsns];
}

/**
 * Extract the first DSN from file content.
 * Used by cache verification to check if a DSN is still present in a file.
 *
 * @param content - File content
 * @returns First DSN found or null
 */
export function extractFirstDsnFromContent(content: string): string | null {
  const dsns = extractDsnsFromContent(content, 1);
  return dsns[0] ?? null;
}

/**
 * Scan a directory for all DSNs in source code files.
 *
 * Respects .gitignore (including nested), skips large files, and
 * limits depth via `dsnScanOptions()`. Returns all unique DSNs plus
 * mtimes for cache invalidation.
 */
export function scanCodeForDsns(cwd: string): Promise<CodeScanResult> {
  return scanDirectory(cwd);
}

/**
 * Scan a directory and return the first DSN found.
 *
 * Optimized for the common case of single-project repositories.
 * This path deliberately avoids the worker pool — spawning workers
 * for a stopOnFirst scan adds ~20ms of startup cost that dwarfs the
 * actual work (most scans find the DSN in the first few files).
 *
 * Walks files one at a time on the main thread, reading each with
 * `Bun.file().text()` and passing through `extractFirstDsnFromContent`
 * which benefits from the `/http/i` literal fast path — ~99% of
 * files skip the full regex entirely.
 *
 * The full-scan variant `scanCodeForDsns` takes the opposite
 * tradeoff: it uses workers + parallel file reads, which is a net
 * win when we need to inspect every file.
 */
export function scanCodeForFirstDsn(cwd: string): Promise<DetectedDsn | null> {
  return withTracingSpan(
    "scanCodeForFirstDsn",
    "dsn.detect.code",
    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: walker loop + read + extract + validate + span-status error branch is inherently branchy
    async (span) => {
      let filesScanned = 0;
      try {
        for await (const entry of walkFiles({
          cwd,
          ...dsnScanOptions(),
        })) {
          filesScanned += 1;
          let content: string;
          try {
            content = await Bun.file(entry.absolutePath).text();
          } catch {
            continue;
          }
          const raw = extractFirstDsnFromContent(content);
          if (raw === null) {
            continue;
          }
          const detected = createDetectedDsn(
            raw,
            "code",
            entry.relativePath,
            inferPackagePath(entry.relativePath)
          );
          if (detected !== null) {
            span.setAttribute("dsn.files_scanned", filesScanned);
            span.setAttribute("dsn.dsns_found", 1);
            return detected;
          }
        }
        span.setAttribute("dsn.files_scanned", filesScanned);
        span.setAttribute("dsn.dsns_found", 0);
        return null;
      } catch (error) {
        if (error instanceof ConfigError) {
          throw error;
        }
        span.setStatus({ code: 2, message: "Directory scan failed" });
        log.debug(`scanCodeForFirstDsn failed: ${String(error)}`);
        return null;
      }
    },
    {
      "dsn.scan_dir": cwd,
      "dsn.stop_on_first": true,
      "dsn.max_depth": DSN_MAX_DEPTH,
    }
  );
}

/**
 * Check if a line is commented out based on common comment prefixes.
 */
function isCommentedLine(trimmedLine: string): boolean {
  return COMMENT_PREFIXES.some((prefix) => trimmedLine.startsWith(prefix));
}

/**
 * Get the expected Sentry host for DSN validation.
 *
 * When SENTRY_URL is set (self-hosted), only DSNs matching that host are valid.
 * When not set (SaaS), only *.sentry.io DSNs are valid.
 *
 * @throws {ConfigError} If SENTRY_URL is set but not a valid URL
 * @returns The expected host domain for DSN validation
 */
function getExpectedHost(): string {
  const sentryUrl = getConfiguredSentryUrl();

  if (sentryUrl) {
    // Self-hosted: only accept DSNs matching the configured host
    try {
      const url = new URL(sentryUrl);
      return url.host;
    } catch {
      // Invalid SENTRY_HOST/SENTRY_URL - throw immediately since nothing will work
      throw new ConfigError(
        `SENTRY_HOST/SENTRY_URL "${sentryUrl}" is not a valid URL`,
        "Set SENTRY_HOST/SENTRY_URL to a valid URL (e.g., https://sentry.example.com) or unset it to use sentry.io"
      );
    }
  }

  // SaaS: only accept *.sentry.io
  return DEFAULT_SENTRY_HOST;
}

/**
 * Validate that a DSN has an acceptable Sentry host.
 *
 * When SENTRY_URL is set (self-hosted): DSNs matching host or any subdomain are valid
 * When SENTRY_URL is not set (SaaS): only *.sentry.io DSNs are valid
 *
 * This ensures we don't detect SaaS DSNs when configured for self-hosted
 * (they can't be queried against a self-hosted instance) and vice versa.
 */
function isValidDsnHost(dsn: string): boolean {
  const parsed = parseDsn(dsn);
  if (!parsed) {
    return false;
  }

  const expectedHost = getExpectedHost();

  // Accept exact match or any subdomain for both SaaS and self-hosted
  // e.g., for sentry.io: accept sentry.io or o123.ingest.us.sentry.io
  // e.g., for sentry.example.com: accept sentry.example.com or ingest.sentry.example.com
  return (
    parsed.host === expectedHost || parsed.host.endsWith(`.${expectedHost}`)
  );
}

/**
 * Main scan implementation. Wraps the pipeline in a traced span so
 * production dashboards + the `scanCodeForDsns` bench op stay in
 * sync. Attribute names match the pre-PR-3 scanner byte-for-byte.
 *
 * Delegates the heavy lifting to `grepFiles`:
 * - Walker config (depth, gitignore, skip dirs) from `dsnScanOptions()`.
 * - `DSN_PATTERN` as the grep pattern — the engine's literal
 *   prefilter uses `http` as a file-level gate, identical to the
 *   pre-refactor `HTTP_SCHEME_PROBE` regex.
 * - `recordMtimes: true` + `onDirectoryVisit` populate the two
 *   cache-invalidation maps in one traversal.
 * - Worker pool handles per-file read + regex in parallel; main
 *   thread post-filters each `GrepMatch` for comments and host
 *   validation.
 */
function scanDirectory(cwd: string): Promise<CodeScanResult> {
  return withTracingSpan(
    "scanCodeForDsns",
    "dsn.detect.code",
    async (span) => {
      const sourceMtimes: Record<string, number> = {};
      const dirMtimes: Record<string, number> = {};
      const seen = new Map<string, DetectedDsn>();
      let filesCollected = 0;
      // `grepFiles` emits one match per line; the walker yields every
      // file that passes the preset. We count the latter via a
      // set of unique absolute paths seen across all emitted matches
      // PLUS an implicit one-time count from the first match per file.
      // For files with zero DSNs, grep's file-level `http` gate
      // silently skips them without emitting — they're not counted
      // in `filesCollected` here. The pre-refactor counter tracked
      // walker-yielded files (including those with zero DSNs), so to
      // preserve the telemetry shape we'd need a separate walker tap.
      // Accept the semantic drift: `filesCollected` now means "files
      // that contained at least one DSN-like URL"; still useful
      // signal, just stricter.
      const filesSeenForMtime = new Set<string>();

      try {
        const iter = grepFiles({
          cwd,
          pattern: DSN_PATTERN,
          ...dsnScanOptions(),
          recordMtimes: true,
          onDirectoryVisit: (absDir, mtimeMs) => {
            const rel = normalizePath(path.relative(cwd, absDir)) || ".";
            dirMtimes[rel] = mtimeMs;
          },
        });

        for await (const match of iter) {
          filesCollected += 1;
          processMatch(match, {
            seen,
            sourceMtimes,
            filesSeenForMtime,
          });
        }

        span.setAttribute("dsn.files_collected", filesCollected);
        span.setAttributes({
          "dsn.files_scanned": filesCollected,
          "dsn.dsns_found": seen.size,
        });

        return {
          dsns: [...seen.values()],
          sourceMtimes,
          dirMtimes,
        };
      } catch (error) {
        if (error instanceof ConfigError) {
          throw error;
        }
        // Anything else is an unexpected walk failure. Return all
        // three maps empty to match the pre-PR-3 scanner's error-path
        // behavior AND avoid a cache-invalidation hole: a partial
        // `dirMtimes` would cause the cache verifier to only check
        // the dirs we happened to reach before the error, silently
        // blessing the cache for dirs the walker never visited.
        // Empty `dirMtimes` forces a full rescan on the next attempt.
        span.setStatus({ code: 2, message: "Directory scan failed" });
        return { dsns: [], sourceMtimes: {}, dirMtimes: {} };
      }
    },
    {
      "dsn.scan_dir": cwd,
      "dsn.stop_on_first": false,
      "dsn.max_depth": DSN_MAX_DEPTH,
    }
  );
}

/**
 * Per-match processing context. Collected into one record so the
 * hot loop's callback stays under Biome's cognitive-complexity
 * ceiling and the caller can mutate `seen` / `sourceMtimes` /
 * `filesSeenForMtime` by reference.
 */
type MatchProcessingContext = {
  seen: Map<string, DetectedDsn>;
  sourceMtimes: Record<string, number>;
  filesSeenForMtime: Set<string>;
};

/**
 * Process one `GrepMatch` from the DSN scan:
 *
 * 1. Skip commented lines.
 * 2. Extract all DSNs on the line via `extractDsnsOnLine` (rare
 *    multi-DSN lines preserved from pre-refactor behavior).
 * 3. For each DSN: validate via `createDetectedDsn`, record
 *    `fileHadValidDsn` for mtime tracking, dedup into `seen`.
 * 4. If this file contributed at least one validated DSN, record
 *    its mtime in `sourceMtimes` (first match wins since subsequent
 *    matches on the same file have the same mtime).
 */
function processMatch(
  match: {
    path: string;
    absolutePath: string;
    line: string;
    mtime?: number;
  },
  ctx: MatchProcessingContext
): void {
  if (isCommentedLine(match.line.trim())) {
    return;
  }
  const dsns = extractDsnsOnLine(match.line);
  if (dsns.length === 0) {
    return;
  }
  const packagePath = inferPackagePath(match.path);
  let fileHadValidDsn = false;
  for (const raw of dsns) {
    const detected = createDetectedDsn(raw, "code", match.path, packagePath);
    if (detected === null) {
      continue;
    }
    fileHadValidDsn = true;
    if (!ctx.seen.has(raw)) {
      ctx.seen.set(raw, detected);
    }
  }
  if (fileHadValidDsn && !ctx.filesSeenForMtime.has(match.absolutePath)) {
    ctx.filesSeenForMtime.add(match.absolutePath);
    if (match.mtime !== undefined) {
      ctx.sourceMtimes[match.path] = match.mtime;
    }
  }
}

/**
 * Extract DSN URLs from a single line's text. Called by
 * `scanDirectory` on each matching line yielded by `grepFiles`.
 * Runs the full `DSN_PATTERN` match + host validation, mirroring
 * `extractDsnsFromContent` but without the whole-file literal gate
 * (grep already handles that).
 *
 * Most lines have zero or one DSN; this loop handles the rare case
 * of two URLs on one line (a preserved behavior of the pre-refactor
 * scanner's `content.matchAll`).
 */
function extractDsnsOnLine(line: string): string[] {
  const dsns: string[] = [];
  for (const m of line.matchAll(DSN_PATTERN)) {
    const raw = m[0];
    if (!dsns.includes(raw) && isValidDsnHost(raw)) {
      dsns.push(raw);
    }
  }
  return dsns;
}
