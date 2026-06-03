/**
 * Regression tests for listIssueEvents pagination overshoot.
 *
 * The issue events endpoint has no per-page parameter, so a single API page can
 * return more events than the caller's `limit`. When that happens listIssueEvents
 * MUST trim to `limit` AND drop nextCursor — returning a cursor that points past
 * the trimmed tail would make `-c next` navigation skip the events between the
 * trim point and that cursor.
 */

import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { listIssueEvents } from "../../../src/lib/api/events.js";
import { setAuthToken } from "../../../src/lib/db/auth.js";
import { setOrgRegion } from "../../../src/lib/db/regions.js";
import { mockFetch, useTestConfigDir } from "../../helpers.js";

useTestConfigDir("test-events-overshoot-");
let originalFetch: typeof globalThis.fetch;

beforeEach(async () => {
  originalFetch = globalThis.fetch;
  await setAuthToken("test-token");
  setOrgRegion("test-org", "https://sentry.io");
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

/** Build a Sentry pagination Link header advertising a next page. */
function nextLinkHeader(cursor: string): string {
  return `<https://sentry.io/next/>; rel="next"; results="true"; cursor="${cursor}"`;
}

function makeEvents(count: number): Array<{ id: string }> {
  return Array.from({ length: count }, (_unused, i) => ({ id: `evt-${i}` }));
}

describe("listIssueEvents overshoot handling", () => {
  test("trims to limit and drops nextCursor when a page overshoots", async () => {
    // Single page returns 5 events with a next cursor, but caller wants 2.
    globalThis.fetch = mockFetch(
      async () =>
        new Response(JSON.stringify(makeEvents(5)), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            Link: nextLinkHeader("page2"),
          },
        })
    );

    const result = await listIssueEvents("test-org", "123", { limit: 2 });

    expect(result.data).toHaveLength(2);
    expect(result.data[0]?.id).toBe("evt-0");
    expect(result.data[1]?.id).toBe("evt-1");
    // Critical: cursor dropped so no events are skipped on the next navigation.
    expect(result.nextCursor).toBeUndefined();
  });

  test("preserves nextCursor when the page exactly fills the limit", async () => {
    globalThis.fetch = mockFetch(
      async () =>
        new Response(JSON.stringify(makeEvents(2)), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            Link: nextLinkHeader("page2"),
          },
        })
    );

    const result = await listIssueEvents("test-org", "123", { limit: 2 });

    expect(result.data).toHaveLength(2);
    // No trim occurred, so the cursor remains valid for the next page.
    expect(result.nextCursor).toBe("page2");
  });

  test("returns all events with no cursor when under the limit", async () => {
    globalThis.fetch = mockFetch(
      async () =>
        new Response(JSON.stringify(makeEvents(3)), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
    );

    const result = await listIssueEvents("test-org", "123", { limit: 25 });

    expect(result.data).toHaveLength(3);
    expect(result.nextCursor).toBeUndefined();
  });
});
