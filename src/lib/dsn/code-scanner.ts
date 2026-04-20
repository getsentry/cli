/**
 * Language-Agnostic DSN Code Scanner (policy layer).
 *
 * This module owns the DSN-specific policy (URL regex, comment-line
 * filtering, host validation, package-path inference, stop-on-first
 * semantics). All file walking, `.gitignore` handling, extension
 * filtering, and bounded concurrency are delegated to the shared
 * `src/lib/scan/` module.
 *
 * Flow:
 *   1. `scanDirectory(cwd, stopOnFirst)` calls `walkFiles` with the
 *      DSN preset (`dsnScanOptions()`), passing `recordMtimes` and an
 *      `onDirectoryVisit` hook so the cache-invalidation map is
 *      populated in one traversal.
 *   2. Each yielded file is read + passed through `extractDsnsFromContent`
 *      via `mapFilesConcurrent`. Per-file `ConfigError` re-throws up
 *      to the caller; all other errors are logged at debug level and
 *      the file is skipped.
 *   3. `onResult` in `mapFilesConcurrent` dedups into a shared Map
 *      and raises the early-exit flag on first unique DSN when
 *      `stopOnFirst: true`.
 *
 * Behavior change landed in PR 3: the walker's `nestedGitignore: true`
 * default (via `dsnScanOptions()`) means nested `.gitignore` files are
 * now honored. Pre-PR-3 code only read the project-root `.gitignore`.
 * This is a correctness improvement matching git's cumulative semantics;
 * DSNs in files covered by a subdir `.gitignore` are no longer detected.
 */

import path from "node:path";
import { DEFAULT_SENTRY_HOST, getConfiguredSentryUrl } from "../constants.js";
import { ConfigError } from "../errors.js";
import { logger } from "../logger.js";
import {
  mapFilesConcurrent,
  normalizePath,
  type WalkEntry,
  walkFiles,
} from "../scan/index.js";
import { withTracingSpan } from "../telemetry.js";
import { createDetectedDsn, inferPackagePath, parseDsn } from "./parser.js";
import { DSN_MAX_DEPTH, dsnScanOptions } from "./scan-options.js";
import type { DetectedDsn } from "./types.js";

/** Scoped logger for DSN code scanning */
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
  // `https://` (case-insensitive). When neither substring appears in
  // the file, we know there are zero candidates and can skip the
  // regex scan entirely. On large walks (10k+ files), ~99% of files
  // contain no `http` substring — measured ~3% improvement on the
  // synthetic/large bench. Two indexOf calls are strictly cheaper
  // than one `toLowerCase()` allocation on big files.
  if (content.indexOf("http") === -1 && content.indexOf("HTTP") === -1) {
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
  return scanDirectory(cwd, false);
}

/**
 * Scan a directory and return the first DSN found.
 *
 * Optimized for the common case of single-project repositories.
 * Stops scanning as soon as a valid DSN is found (propagates via
 * `mapFilesConcurrent`'s shared early-exit flag).
 */
export async function scanCodeForFirstDsn(
  cwd: string
): Promise<DetectedDsn | null> {
  const { dsns } = await scanDirectory(cwd, true);
  return dsns[0] ?? null;
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
 * Bundle of per-scan mutable state. Collecting these into one record
 * keeps the per-file processor's arity under Biome's 4-param ceiling.
 */
type ScanDirectoryState = {
  cwd: string;
  stopOnFirst: boolean;
  seen: Map<string, DetectedDsn>;
  sourceMtimes: Record<string, number>;
  filesScanned: { count: number };
};

/**
 * Main scan implementation. Wraps the pipeline in a traced span so
 * production dashboards + the `scanCodeForDsns` bench op stay in
 * sync. Attribute names match the pre-PR-3 scanner byte-for-byte.
 */
function scanDirectory(
  cwd: string,
  stopOnFirst: boolean
): Promise<CodeScanResult> {
  return withTracingSpan(
    "scanCodeForDsns",
    "dsn.detect.code",
    async (span) => {
      const sourceMtimes: Record<string, number> = {};
      const dirMtimes: Record<string, number> = {};
      const seen = new Map<string, DetectedDsn>();
      // Mutable counters threaded through the state object so the
      // per-file callback can update them without capturing.
      const filesScanned = { count: 0 };
      let filesCollected = 0;

      const state: ScanDirectoryState = {
        cwd,
        stopOnFirst,
        seen,
        sourceMtimes,
        filesScanned,
      };

      try {
        // Walker yields every text file under cwd that passes the DSN
        // preset (depth 3 with monorepo reset, full DSN skip list,
        // nested .gitignore honored). We tap the iterator to count
        // collected files for telemetry, then feed the tapped stream
        // through mapFilesConcurrent for bounded parallel reads.
        const walkSource = walkFiles({
          cwd,
          ...dsnScanOptions(),
          recordMtimes: true,
          onDirectoryVisit: (absDir, mtimeMs) => {
            const rel = normalizePath(path.relative(cwd, absDir)) || ".";
            dirMtimes[rel] = mtimeMs;
          },
        });
        const tapped = tapWalker(walkSource, () => {
          filesCollected += 1;
        });

        await mapFilesConcurrent(
          tapped,
          (entry) => processEntry(entry, state),
          {
            onResult: (detected) => {
              let firstUnique = false;
              for (const dsn of detected) {
                if (!seen.has(dsn.raw)) {
                  seen.set(dsn.raw, dsn);
                  if (stopOnFirst) {
                    firstUnique = true;
                  }
                }
              }
              return firstUnique ? { done: true } : undefined;
            },
          }
        );

        span.setAttribute("dsn.files_collected", filesCollected);
        span.setAttributes({
          "dsn.files_scanned": filesScanned.count,
          "dsn.dsns_found": seen.size,
        });

        return {
          dsns: [...seen.values()],
          sourceMtimes,
          dirMtimes,
        };
      } catch (error) {
        // ConfigError is a user-facing misconfiguration — surface it.
        if (error instanceof ConfigError) {
          throw error;
        }
        // Anything else is an unexpected walk failure. Matches the
        // pre-PR-3 scanner's behavior: return empty + set span to error.
        span.setStatus({ code: 2, message: "Directory scan failed" });
        return { dsns: [], sourceMtimes: {}, dirMtimes };
      }
    },
    {
      "dsn.scan_dir": cwd,
      "dsn.stop_on_first": stopOnFirst,
      "dsn.max_depth": DSN_MAX_DEPTH,
    }
  );
}

/**
 * Per-file worker: read the file, extract DSNs via the DSN-specific
 * content pipeline, wrap each raw match in a `DetectedDsn`. Returns
 * an empty array (not null) for files with no DSNs so the early-exit
 * logic in `mapFilesConcurrent.onResult` sees zero-hit files as
 * "keep going, not done".
 *
 * Re-throws `ConfigError` so `scanDirectory`'s outer try/catch can
 * propagate user-facing misconfig. All other fs errors are logged at
 * debug level and treated as "no DSNs here" — matches the pre-PR-3
 * scanner's error-handling shape exactly.
 */
async function processEntry(
  entry: WalkEntry,
  state: ScanDirectoryState
): Promise<DetectedDsn[]> {
  state.filesScanned.count += 1;
  try {
    const content = await Bun.file(entry.absolutePath).text();
    const raws = extractDsnsFromContent(
      content,
      state.stopOnFirst ? 1 : undefined
    );
    if (raws.length === 0) {
      return [];
    }
    const packagePath = inferPackagePath(entry.relativePath);
    const detected = raws
      .map((raw) =>
        createDetectedDsn(raw, "code", entry.relativePath, packagePath)
      )
      .filter((d): d is DetectedDsn => d !== null);
    // Only record mtime when at least one DSN was accepted (matches
    // pre-PR-3 behavior — the cache only tracks files it cares about).
    if (detected.length > 0) {
      state.sourceMtimes[entry.relativePath] = entry.mtime;
    }
    return detected;
  } catch (error) {
    if (error instanceof ConfigError) {
      throw error;
    }
    // ENOENT / EACCES / malformed content — the pre-PR-3 scanner
    // matched these with a single `log.debug(...)` and returned
    // empty. Preserve that behavior exactly.
    log.debug(`Cannot read file: ${entry.relativePath}`);
    return [];
  }
}

/**
 * Pass-through async generator that invokes `onEach` once per entry
 * before yielding. Lets `scanDirectory` count collected files without
 * forking the walker's output iterator.
 */
async function* tapWalker(
  source: AsyncIterable<WalkEntry>,
  onEach: () => void
): AsyncGenerator<WalkEntry> {
  for await (const entry of source) {
    onEach();
    yield entry;
  }
}
