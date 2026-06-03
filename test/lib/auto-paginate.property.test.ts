/**
 * Property-based tests for autoPaginate().
 *
 * autoPaginate has two paths with DIFFERENT trimming contracts:
 *
 * - Fast path (`limit <= API_MAX_PER_PAGE`): returns a single page verbatim,
 *   WITHOUT trimming — so a page that overshoots `limit` is returned as-is with
 *   its nextCursor. Callers whose endpoint can overshoot a single page (e.g.
 *   `listIssueEvents`, which has no per-page param) must trim-and-drop-cursor
 *   themselves; that behavior is covered by `events-overshoot.test.ts`.
 * - Multi-page path (`limit > API_MAX_PER_PAGE`): accumulates across pages and,
 *   on overshoot, trims to `limit` AND drops nextCursor so cursor navigation
 *   never skips the rows between the trim point and the dropped cursor.
 *
 * These tests pin the multi-page contract, the source of the original bug class.
 */

import { asyncProperty, assert as fcAssert, integer, nat } from "fast-check";
import { describe, expect, test } from "vitest";
import {
  API_MAX_PER_PAGE,
  autoPaginate,
  type PaginatedResponse,
} from "../../src/lib/api/infrastructure.js";
import { DEFAULT_NUM_RUNS } from "../model-based/helpers.js";

/**
 * Build a paginated fetcher over a fixed pool of sequential numbers, served in
 * pages of `pageSize` (capped at API_MAX_PER_PAGE to mimic a real endpoint).
 */
function makePagedFetcher(total: number, pageSize: number) {
  const cappedPageSize = Math.min(pageSize, API_MAX_PER_PAGE);
  return (cursor: string | undefined): Promise<PaginatedResponse<number[]>> => {
    const offset = cursor ? Number(cursor) : 0;
    const data = Array.from(
      { length: Math.min(cappedPageSize, Math.max(0, total - offset)) },
      (_unused, i) => offset + i
    );
    const nextOffset = offset + data.length;
    const nextCursor = nextOffset < total ? String(nextOffset) : undefined;
    return Promise.resolve({ data, nextCursor });
  };
}

// Multi-page path requires limit > API_MAX_PER_PAGE. Real callers cap perPage at
// min(limit, API_MAX_PER_PAGE) and the multi-page cap is MAX_PAGINATION_PAGES, so
// the achievable ceiling is API_MAX_PER_PAGE * MAX_PAGINATION_PAGES. We keep the
// limit comfortably under that ceiling and use realistic (large) page sizes so
// the page-cap safety path is not the thing under test here.
const multiPageLimit = integer({
  min: API_MAX_PER_PAGE + 1,
  max: API_MAX_PER_PAGE * 4,
});
const pageSizeArb = integer({
  min: Math.floor(API_MAX_PER_PAGE / 2),
  max: API_MAX_PER_PAGE,
});

describe("property: autoPaginate multi-page contract", () => {
  test("never returns more than limit items", () => {
    fcAssert(
      asyncProperty(
        nat(API_MAX_PER_PAGE * 5),
        multiPageLimit,
        pageSizeArb,
        async (total, limit, pageSize) => {
          const result = await autoPaginate(
            makePagedFetcher(total, pageSize),
            limit
          );
          expect(result.data.length).toBeLessThanOrEqual(limit);
        }
      ),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("drops nextCursor whenever the result is trimmed to limit", () => {
    fcAssert(
      asyncProperty(
        nat(API_MAX_PER_PAGE * 5),
        multiPageLimit,
        pageSizeArb,
        async (total, limit, pageSize) => {
          const result = await autoPaginate(
            makePagedFetcher(total, pageSize),
            limit
          );
          // When more rows exist than we returned, the data must be exactly
          // `limit` long AND nextCursor undefined — a non-undefined cursor would
          // skip the rows between the trim point and that cursor.
          if (total > limit) {
            expect(result.data.length).toBe(limit);
            expect(result.nextCursor).toBeUndefined();
          }
        }
      ),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("accumulated rows are contiguous from offset 0 (no skips/dupes)", () => {
    fcAssert(
      asyncProperty(
        nat(API_MAX_PER_PAGE * 5),
        multiPageLimit,
        pageSizeArb,
        async (total, limit, pageSize) => {
          const result = await autoPaginate(
            makePagedFetcher(total, pageSize),
            limit
          );
          const expectedLen = Math.min(total, limit);
          expect(result.data).toEqual(
            Array.from({ length: expectedLen }, (_unused, i) => i)
          );
        }
      ),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });
});
