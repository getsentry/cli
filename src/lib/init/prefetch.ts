/**
 * Background Org Detection Prefetch
 *
 * Provides a warm/consume pattern for org resolution during `sentry init`.
 * Call {@link warmOrgDetection} early (before the preamble) to start DSN
 * scanning and org-list fetching in the background.  Later, call
 * {@link resolveOrgPrefetched} or {@link listOrgsPrefetched} — they return
 * the cached result instantly if the background work has finished, or
 * fall back to a live call if it hasn't been warmed.
 *
 * This keeps the hot path (inside the wizard's `createSentryProject`)
 * free of explicit promise-threading — callers just swap in the
 * prefetch-aware functions.
 */

import { listOrganizations } from "../api-client.js";
import type { ResolvedOrg } from "../resolve-target.js";
import { resolveOrg } from "../resolve-target.js";

type OrgResult = ResolvedOrg | null;
type OrgListResult = Array<{ id: string; slug: string; name: string }>;

let orgPromise: Promise<OrgResult> | undefined;
let orgListPromise: Promise<OrgListResult> | undefined;

/**
 * Kick off background org detection and org-list fetching.
 *
 * Safe to call multiple times — subsequent calls are no-ops.
 * Errors are silently swallowed so the foreground path can retry.
 */
export function warmOrgDetection(cwd: string): void {
  if (!orgPromise) {
    orgPromise = resolveOrg({ cwd }).catch(() => null);
  }
  if (!orgListPromise) {
    orgListPromise = listOrganizations().catch(() => []);
  }
}

/**
 * Resolve the org, using the prefetched result if available.
 * Falls back to a live call when {@link warmOrgDetection} was not called.
 */
export function resolveOrgPrefetched(cwd: string): Promise<OrgResult> {
  if (orgPromise) {
    return orgPromise;
  }
  return resolveOrg({ cwd }).catch(() => null);
}

/**
 * List organizations, using the prefetched result if available.
 * Falls back to a live call when {@link warmOrgDetection} was not called.
 */
export function listOrgsPrefetched(): Promise<OrgListResult> {
  if (orgListPromise) {
    return orgListPromise;
  }
  return listOrganizations().catch(() => []);
}

/**
 * Reset prefetch state.  Used by tests to prevent cross-test leakage.
 */
export function resetPrefetch(): void {
  orgPromise = undefined;
  orgListPromise = undefined;
}
