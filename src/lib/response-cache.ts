/**
 * Filesystem-based HTTP response cache for read-only API calls.
 *
 * Uses `http-cache-semantics` (RFC 7234/9111) to make correct caching decisions.
 * When the server provides `Cache-Control` / `ETag` / `Expires` headers, they
 * are respected automatically. When the server sends no cache headers (Sentry's
 * current behavior), a URL-based fallback TTL is applied.
 *
 * Cache entries are stored as individual JSON files under `~/.sentry/cache/responses/`.
 * This keeps the response data separate from the config SQLite database, which
 * stores small structured data (tokens, org slugs, cursors). API responses can
 * be 50–500 KB each, so a dedicated cache directory avoids bloating the DB.
 *
 * @module
 */

import { createHash } from "node:crypto";
import {
  mkdir,
  readdir,
  readFile,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import CachePolicy from "http-cache-semantics";
import pLimit from "p-limit";

import { getConfigDir } from "./db/index.js";

// ---------------------------------------------------------------------------
// TTL tiers — used as fallback when the server sends no cache headers
// ---------------------------------------------------------------------------

/**
 * TTL tier classification for URLs.
 *
 * - `immutable`: data that never changes once created (events, traces)
 * - `stable`: data that changes infrequently (orgs, projects, teams)
 * - `volatile`: data that changes often (issue lists, log lists)
 * - `no-cache`: never cache (polling endpoints like autofix state)
 */
type TtlTier = "immutable" | "stable" | "volatile" | "no-cache";

/** Fallback TTL durations by tier (milliseconds). `no-cache` uses 0 as a sentinel. */
const FALLBACK_TTL_MS: Record<TtlTier, number> = {
  immutable: 24 * 60 * 60 * 1000, // 24 hours — events and traces never change
  stable: 5 * 60 * 1000, // 5 minutes
  volatile: 60 * 1000, // 60 seconds
  "no-cache": 0,
};

/**
 * URL patterns grouped by TTL tier.
 *
 * Checked in tier priority order (no-cache → immutable → volatile).
 * "stable" has no patterns — it is the default fallback when nothing else matches.
 */
const URL_TIER_REGEXPS: Readonly<Record<TtlTier, readonly RegExp[]>> = {
  // Polling endpoints where state changes rapidly
  "no-cache": [/\/(?:autofix|root-cause)\//],
  // Specific resources by ID (events, traces) — never change once created
  immutable: [/\/events\/[^/?]+\/?(?:\?|$)/, /\/trace\/[0-9a-f]{32}\//],
  // Issue endpoints (lists AND detail views), dataset queries, trace-logs
  volatile: [
    /\/issues\//,
    /[?&]dataset=(?:logs|transactions)/,
    /\/trace-logs\//,
  ],
  // Default fallback — no patterns needed
  stable: [],
};

/** Tier check order — stable is the default and has no patterns to check. */
const TIER_CHECK_ORDER: readonly TtlTier[] = [
  "no-cache",
  "immutable",
  "volatile",
];

/**
 * Classify a URL into a TTL tier for fallback caching.
 *
 * @param url - Full URL string (with query params)
 * @returns The TTL tier
 * @internal Exported for testing
 */
export function classifyUrl(url: string): TtlTier {
  for (const tier of TIER_CHECK_ORDER) {
    for (const pattern of URL_TIER_REGEXPS[tier]) {
      if (pattern.test(url)) {
        return tier;
      }
    }
  }
  return "stable";
}

// ---------------------------------------------------------------------------
// Cache key generation
// ---------------------------------------------------------------------------

/**
 * Build a deterministic cache key from an HTTP method and URL.
 *
 * Query parameters are sorted alphabetically so that `?a=1&b=2` and `?b=2&a=1`
 * produce the same key. The key is then SHA-256 hashed to produce a fixed-length
 * filename-safe string.
 *
 * @param method - HTTP method (e.g., "GET")
 * @param url - Full URL string
 * @returns Hex-encoded SHA-256 hash suitable for use as a filename
 * @internal Exported for testing
 */
export function buildCacheKey(method: string, url: string): string {
  const normalized = normalizeUrl(method, url);
  return createHash("sha256").update(normalized).digest("hex");
}

/**
 * Normalize method + URL into a stable string for cache key derivation.
 * Sorts query params alphabetically for deterministic key generation.
 *
 * @internal Exported for testing
 */
export function normalizeUrl(method: string, url: string): string {
  const parsed = new URL(url);
  const sortedParams = new URLSearchParams(
    [...parsed.searchParams.entries()].sort(([a], [b]) => {
      if (a < b) {
        return -1;
      }
      if (a > b) {
        return 1;
      }
      return 0;
    })
  );
  parsed.search = sortedParams.toString() ? `?${sortedParams.toString()}` : "";
  return `${method.toUpperCase()}|${parsed.toString()}`;
}

// ---------------------------------------------------------------------------
// Cache storage types and constants
// ---------------------------------------------------------------------------

/** Shape of a serialized cache entry on disk */
type CacheEntry = {
  /** Serialized CachePolicy object (via policy.toObject()) */
  policy: CachePolicy.CachePolicyObject;
  /** Response body (already parsed JSON) */
  body: unknown;
  /** HTTP status code */
  status: number;
  /** Selected response headers (e.g., Link for pagination) */
  headers: Record<string, string>;
  /** Original URL, used for TTL tier classification during cleanup */
  url: string;
  /** When this entry was created (epoch ms) */
  createdAt: number;
  /**
   * Pre-computed expiry timestamp (epoch ms).
   * Allows cleanup to check freshness without deserializing CachePolicy.
   * Optional for backwards compatibility with entries written before this field.
   */
  expiresAt?: number;
};

/** CachePolicy options for a single-user CLI cache */
const POLICY_OPTIONS: CachePolicy.Options = {
  shared: false,
  cacheHeuristic: 0.1,
  immutableMinTimeToLive: FALLBACK_TTL_MS.immutable,
};

/** Maximum number of cache files to retain */
const MAX_CACHE_ENTRIES = 500;

/** Probability of running cleanup on each cache write */
const CLEANUP_PROBABILITY = 0.1;

/**
 * Headers that should be preserved in the cache for consumers.
 * Only includes headers that affect API client behavior (e.g., pagination).
 */
const PRESERVED_HEADERS = ["link"];

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Get the response cache directory path */
function getCacheDir(): string {
  return join(getConfigDir(), "cache", "responses");
}

/** Get the full file path for a cache key */
function cacheFilePath(key: string): string {
  return join(getCacheDir(), `${key}.json`);
}

/** Check if an error is an ENOENT (file/directory not found) */
function isNotFound(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

/** Extract the subset of response headers worth caching */
function pickHeaders(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  for (const name of PRESERVED_HEADERS) {
    const value = headers.get(name);
    if (value) {
      result[name] = value;
    }
  }
  return result;
}

/** Convert Headers to a plain object for http-cache-semantics */
function headersToObject(headers: Headers): Record<string, string> {
  return Object.fromEntries(headers.entries());
}

/**
 * Check whether a cache entry is still fresh.
 *
 * Uses the server-provided TTL (via CachePolicy) when available. Falls back
 * to URL-based TTL tiers when the server sends no cache headers.
 */
function isEntryFresh(
  policy: CachePolicy,
  entry: CacheEntry,
  requestHeaders: Record<string, string>,
  url: string
): boolean {
  const newRequest = { url, method: "GET", headers: requestHeaders };
  if (policy.satisfiesWithoutRevalidation(newRequest)) {
    return true;
  }

  // CachePolicy says stale — check if we should override with fallback TTL.
  // timeToLive() returns 0 when the server sent no cache headers, or a
  // positive/negative value when it did (negative = already expired).
  const serverTtl = policy.timeToLive();
  if (serverTtl !== 0) {
    // Server provided an explicit TTL — respect it (even if expired)
    return false;
  }

  // No server TTL (0) — use our URL-based fallback tier
  const tier = classifyUrl(url);
  const fallbackTtl = FALLBACK_TTL_MS[tier];
  const age = Date.now() - entry.createdAt;
  return age <= fallbackTtl;
}

/**
 * Build the response headers for a cached entry.
 * Merges CachePolicy's computed headers with our preserved headers.
 * Flattens multi-value headers into comma-separated strings for the Response API.
 */
function buildResponseHeaders(
  policy: CachePolicy,
  entry: CacheEntry
): Record<string, string> {
  const policyHeaders = policy.responseHeaders();
  const result: Record<string, string> = {};

  for (const [name, value] of Object.entries(policyHeaders)) {
    if (value === undefined) {
      continue;
    }
    result[name] = Array.isArray(value) ? value.join(", ") : value;
  }

  // Merge preserved headers (like Link for pagination)
  for (const [name, value] of Object.entries(entry.headers)) {
    if (!(name in result)) {
      result[name] = value;
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Cache bypass control
// ---------------------------------------------------------------------------

let cacheDisabledFlag = false;

/**
 * Disable the response cache for the current process.
 * Called when `--refresh` flag is passed to a command.
 */
export function disableResponseCache(): void {
  cacheDisabledFlag = true;
}

/**
 * Check if response caching is disabled.
 * Cache is disabled when:
 * - `disableResponseCache()` was called (--refresh flag)
 * - `SENTRY_NO_CACHE=1` environment variable is set
 */
export function isCacheDisabled(): boolean {
  return cacheDisabledFlag || process.env.SENTRY_NO_CACHE === "1";
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Attempt to serve a cached response for a GET request.
 *
 * Reads the cache file directly and handles ENOENT (cache miss) without a
 * separate existence check. Reconstructs the `CachePolicy` from the stored
 * metadata and verifies the cached response still satisfies the new request.
 *
 * @param method - HTTP method (only "GET" is cached)
 * @param url - Full request URL
 * @param requestHeaders - Headers from the new request
 * @returns A synthetic Response if cache hit, or undefined on miss/expired
 */
export async function getCachedResponse(
  method: string,
  url: string,
  requestHeaders: Record<string, string>
): Promise<Response | undefined> {
  if (
    method !== "GET" ||
    isCacheDisabled() ||
    classifyUrl(url) === "no-cache"
  ) {
    return;
  }

  const key = buildCacheKey(method, url);
  const entry = await readCacheEntry(key);
  if (!entry) {
    return;
  }

  try {
    const policy = CachePolicy.fromObject(entry.policy);
    if (!isEntryFresh(policy, entry, requestHeaders, url)) {
      return;
    }

    const responseHeaders = buildResponseHeaders(policy, entry);
    return new Response(JSON.stringify(entry.body), {
      status: entry.status,
      headers: responseHeaders,
    });
  } catch {
    // Corrupted or version-incompatible policy object — treat as cache miss.
    // Best-effort cleanup of the broken entry.
    unlink(cacheFilePath(key)).catch(() => {
      // Ignored — fire-and-forget
    });
    return;
  }
}

/**
 * Read and parse a cache entry from disk.
 * Returns undefined on ENOENT or parse errors.
 */
async function readCacheEntry(key: string): Promise<CacheEntry | undefined> {
  const filePath = cacheFilePath(key);
  let raw: string;
  try {
    raw = await readFile(filePath, "utf-8");
  } catch {
    // ENOENT = cache miss; other read errors = treat as miss
    return;
  }

  try {
    return JSON.parse(raw) as CacheEntry;
  } catch {
    // Corrupted cache file — delete it
    await unlink(filePath).catch(() => {
      // Best-effort cleanup of corrupted file
    });
    return;
  }
}

/**
 * Store a response in the cache.
 *
 * Only caches successful (2xx) GET responses. Uses `http-cache-semantics` to
 * determine if the response is storable per RFC 7234. If the server explicitly
 * sends `Cache-Control: no-store`, the response is not cached.
 *
 * This function is fire-and-forget — errors are silently swallowed to avoid
 * slowing down the response path.
 *
 * @param method - HTTP method
 * @param url - Full request URL
 * @param requestHeaders - Request headers
 * @param response - The fetch Response to cache (must be cloned before passing)
 */
export async function storeCachedResponse(
  method: string,
  url: string,
  requestHeaders: Record<string, string>,
  response: Response
): Promise<void> {
  if (
    method !== "GET" ||
    isCacheDisabled() ||
    !response.ok ||
    classifyUrl(url) === "no-cache"
  ) {
    return;
  }

  try {
    await writeResponseToCache(method, url, requestHeaders, response);
  } catch {
    // Cache write failures are non-fatal — silently ignore
  }
}

/** Core cache write logic, separated for complexity management */
async function writeResponseToCache(
  method: string,
  url: string,
  requestHeaders: Record<string, string>,
  response: Response
): Promise<void> {
  const responseHeadersObj = headersToObject(response.headers);

  const policy = new CachePolicy(
    { url, method, headers: requestHeaders },
    { status: response.status, headers: responseHeadersObj },
    POLICY_OPTIONS
  );

  if (!policy.storable()) {
    return;
  }

  const body: unknown = await response.json();
  const key = buildCacheKey(method, url);
  const now = Date.now();

  // Pre-compute expiry for cheap cleanup checks (avoids CachePolicy deserialization)
  const serverTtl = policy.timeToLive();
  const fallbackTtl = FALLBACK_TTL_MS[classifyUrl(url)];
  const ttl = serverTtl > 0 ? serverTtl : fallbackTtl;

  const entry: CacheEntry = {
    policy: policy.toObject(),
    body,
    status: response.status,
    headers: pickHeaders(response.headers),
    url,
    createdAt: now,
    expiresAt: now + ttl,
  };

  await mkdir(getCacheDir(), { recursive: true, mode: 0o700 });
  await writeFile(cacheFilePath(key), JSON.stringify(entry), "utf-8");

  // Probabilistic cleanup to avoid unbounded cache growth
  if (Math.random() < CLEANUP_PROBABILITY) {
    cleanupCache().catch(() => {
      // Non-fatal: cleanup failure doesn't affect cache correctness
    });
  }
}

/**
 * Remove all cached responses.
 * Called on `auth logout` and `auth login` since cached data is tied to the user.
 */
export async function clearResponseCache(): Promise<void> {
  try {
    await rm(getCacheDir(), { recursive: true, force: true });
  } catch {
    // Ignore errors — directory may not exist
  }
}

// ---------------------------------------------------------------------------
// Concurrency helper
// ---------------------------------------------------------------------------

/** Concurrency limit for parallel cache file I/O operations */
const CACHE_IO_CONCURRENCY = 8;

/**
 * Run an async function over items with bounded concurrency.
 * Uses p-limit to prevent overwhelming the filesystem with simultaneous reads.
 */
async function parallel<T>(
  items: readonly T[],
  fn: (item: T) => Promise<void>
): Promise<void> {
  const limit = pLimit(CACHE_IO_CONCURRENCY);
  await Promise.all(items.map((item) => limit(() => fn(item))));
}

// ---------------------------------------------------------------------------
// Cache cleanup
// ---------------------------------------------------------------------------

/**
 * Clean up expired and excess cache entries.
 *
 * Deletes entries that have expired (based on server TTL or fallback TTL),
 * then enforces a maximum entry count by evicting the oldest entries.
 */
async function cleanupCache(): Promise<void> {
  const cacheDir = getCacheDir();
  let files: string[];
  try {
    files = await readdir(cacheDir);
  } catch (error) {
    if (isNotFound(error)) {
      return;
    }
    throw error;
  }

  const jsonFiles = files.filter((f) => f.endsWith(".json"));
  if (jsonFiles.length === 0) {
    return;
  }

  const entries = await collectEntryMetadata(cacheDir, jsonFiles);

  // Delete expired entries
  await deleteExpiredEntries(cacheDir, entries);

  // Enforce max entry count — evict oldest first
  await evictExcessEntries(cacheDir, entries);
}

/** Metadata for a cache entry, used for cleanup decisions */
type EntryMetadata = { file: string; createdAt: number; expired: boolean };

/**
 * Read all cache files and determine which are expired.
 *
 * Uses the pre-computed `expiresAt` field when available (cheap — no
 * CachePolicy deserialization). Falls back to URL-based TTL classification
 * for entries written before `expiresAt` was added.
 */
async function collectEntryMetadata(
  cacheDir: string,
  jsonFiles: string[]
): Promise<EntryMetadata[]> {
  const entries: EntryMetadata[] = [];
  const now = Date.now();

  await parallel(jsonFiles, async (file) => {
    const filePath = join(cacheDir, file);
    try {
      const raw = await readFile(filePath, "utf-8");
      const entry = JSON.parse(raw) as CacheEntry;
      const expired =
        entry.expiresAt !== undefined
          ? now >= entry.expiresAt
          : now - entry.createdAt >
            FALLBACK_TTL_MS[classifyUrl(entry.url ?? "")];
      entries.push({ file, createdAt: entry.createdAt, expired });
    } catch {
      // Unparseable file — delete it
      unlink(filePath).catch(() => {
        // Best-effort cleanup of corrupted file
      });
    }
  });

  return entries;
}

/** Delete cache files that have expired */
async function deleteExpiredEntries(
  cacheDir: string,
  entries: EntryMetadata[]
): Promise<void> {
  const expired = entries.filter((e) => e.expired);
  await parallel(expired, async (entry) => {
    await unlink(join(cacheDir, entry.file)).catch(() => {
      // Best-effort: file may have been deleted by another process
    });
  });
}

/** Evict the oldest entries when over the max count */
async function evictExcessEntries(
  cacheDir: string,
  entries: EntryMetadata[]
): Promise<void> {
  const remaining = entries.filter((e) => !e.expired);
  if (remaining.length <= MAX_CACHE_ENTRIES) {
    return;
  }

  remaining.sort((a, b) => a.createdAt - b.createdAt);
  const toEvict = remaining.slice(0, remaining.length - MAX_CACHE_ENTRIES);
  await parallel(toEvict, async (entry) => {
    await unlink(join(cacheDir, entry.file)).catch(() => {
      // Best-effort eviction
    });
  });
}
