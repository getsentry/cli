/**
 * Fetches Sentry documentation directly from docs.sentry.io for the local
 * init agent. Ported from the retired docs-mcp worker, with the Cloudflare
 * Cache API replaced by a process-lifetime in-memory cache (the CLI is a
 * short-lived process, so a simple Map is sufficient and avoids re-downloading
 * the ~6MB doctree across tool calls in a single run).
 */

import { customFetch } from "../../custom-ca.js";

const BASE_URL = "https://docs.sentry.io";
const FETCH_TIMEOUT_MS = 15_000;

const TRAILING_MD_RE = /\.md$/;
const TRAILING_SLASHES_RE = /\/+$/;
const HTTP_URL_RE = /^https?:\/\//i;

const cache = new Map<string, string>();
const inflight = new Map<string, Promise<string>>();

function cachedFetch(url: string): Promise<string> {
  const cached = cache.get(url);
  if (cached !== undefined) {
    return Promise.resolve(cached);
  }
  const pending = inflight.get(url);
  if (pending) {
    return pending;
  }

  const request = (async () => {
    try {
      const response = await customFetch(url, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!response.ok) {
        throw new Error(
          `Failed to fetch ${url}: ${response.status} ${response.statusText}`
        );
      }
      const body = await response.text();
      cache.set(url, body);
      return body;
    } finally {
      inflight.delete(url);
    }
  })();

  inflight.set(url, request);
  return request;
}

/**
 * Normalize a docs.sentry.io path so it works with the `.md` export API.
 * Returns a path with a single leading slash and no trailing slash or `.md`.
 */
export function normalizeDocPath(path: string): string {
  let p = path.trim();
  // If a full URL is passed, keep only its path component. We always refetch
  // against BASE_URL, so any host in the input is discarded (and we avoid a
  // substring host check, which static analysis flags as unsafe).
  if (HTTP_URL_RE.test(p)) {
    try {
      p = new URL(p).pathname;
    } catch {
      // Not a valid URL; fall through and treat the input as a path.
    }
  }
  p = p.replace(TRAILING_MD_RE, "");
  p = p.replace(TRAILING_SLASHES_RE, "");
  if (!p.startsWith("/")) {
    p = `/${p}`;
  }
  return p;
}

/** Fetch the pre-rendered Markdown export for a single docs.sentry.io page. */
export function fetchDocPage(path: string): Promise<string> {
  const normalized = normalizeDocPath(path);
  return cachedFetch(`${BASE_URL}${normalized}.md`);
}

/** Fetch the global doctree.json sitemap (raw JSON string). */
export function fetchDocTree(): Promise<string> {
  return cachedFetch(`${BASE_URL}/doctree.json`);
}

/** Build the public docs.sentry.io URL for a path (no `.md` suffix). */
export function buildDocsUrl(path: string): string {
  return `${BASE_URL}${normalizeDocPath(path)}/`;
}
