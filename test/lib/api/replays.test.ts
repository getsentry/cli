/**
 * Tests for the replay API helpers.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  getReplay,
  getReplayRecordingSegments,
  listReplayIdsForIssue,
  listReplays,
} from "../../../src/lib/api/replays.js";
import { DEFAULT_SENTRY_URL } from "../../../src/lib/constants.js";
import { setAuthToken } from "../../../src/lib/db/auth.js";
import { setOrgRegion } from "../../../src/lib/db/regions.js";
import { mockFetch, useTestConfigDir } from "../../helpers.js";

useTestConfigDir("replays-api-test-");

const REPLAY_ID = "346789a703f6454384f1de473b8b9fcc";

function replayRow(id = REPLAY_ID) {
  return {
    id,
    count_errors: 2,
    count_segments: 4,
    duration: 95,
    started_at: "2025-01-30T14:32:15+00:00",
    user: { display_name: "Test User" },
  };
}

describe("listReplays", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(async () => {
    originalFetch = globalThis.fetch;
    await setAuthToken("test-token");
    setOrgRegion("test-org", DEFAULT_SENTRY_URL);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("calls the organization replay index with repeated field params", async () => {
    let capturedUrl = "";

    globalThis.fetch = mockFetch(async (input, init) => {
      const req = new Request(input!, init);
      capturedUrl = req.url;
      return new Response(JSON.stringify({ data: [replayRow()] }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          Link: `<https://sentry.io/api/0/next/>; rel="next"; results="true"; cursor="0:25:0"`,
        },
      });
    });

    const result = await listReplays("test-org", {
      limit: 25,
      projectSlugs: ["cli"],
      query: "count_errors:>0",
      sort: "-count_errors",
      statsPeriod: "24h",
    });

    const url = new URL(capturedUrl);
    expect(url.pathname).toContain("/api/0/organizations/test-org/replays/");
    expect(url.searchParams.get("projectSlug")).toBe("cli");
    expect(url.searchParams.get("query")).toBe("count_errors:>0");
    expect(url.searchParams.get("sort")).toBe("-count_errors");
    expect(url.searchParams.get("statsPeriod")).toBe("24h");
    expect(url.searchParams.get("per_page")).toBe("25");
    expect(url.searchParams.getAll("field")).toContain("id");
    expect(url.searchParams.getAll("field")).toContain("user");
    expect(result.data).toHaveLength(1);
    expect(result.nextCursor).toBe("0:25:0");
  });

  test("passes replay environment filters and custom field selection", async () => {
    let capturedUrl = "";

    globalThis.fetch = mockFetch(async (input, init) => {
      const req = new Request(input!, init);
      capturedUrl = req.url;
      return new Response(JSON.stringify({ data: [replayRow()] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    await listReplays("test-org", {
      environment: ["production", "canary"],
      fields: ["id", "user", "urls"],
      limit: 10,
      sort: "-count_rage_clicks",
    });

    const url = new URL(capturedUrl);
    expect(url.searchParams.getAll("environment")).toEqual([
      "production",
      "canary",
    ]);
    expect(url.searchParams.getAll("field")).toEqual(["id", "user", "urls"]);
    expect(url.searchParams.get("sort")).toBe("-count_rage_clicks");
  });

  test("auto-paginates when limit exceeds the API cap", async () => {
    const capturedUrls: string[] = [];
    let callIndex = 0;

    globalThis.fetch = mockFetch(async (input, init) => {
      const req = new Request(input!, init);
      capturedUrls.push(req.url);

      const body =
        callIndex === 0
          ? {
              data: Array.from({ length: 100 }, (_, index) =>
                replayRow(index.toString(16).padStart(32, "a").slice(-32))
              ),
            }
          : {
              data: Array.from({ length: 50 }, (_, index) =>
                replayRow(index.toString(16).padStart(32, "b").slice(-32))
              ),
            };
      const headers =
        callIndex === 0
          ? {
              Link: `<https://sentry.io/api/0/next/>; rel="next"; results="true"; cursor="0:100:0"`,
            }
          : {
              Link: `<https://sentry.io/api/0/next/>; rel="next"; results="false"; cursor=""`,
            };
      callIndex += 1;

      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json", ...headers },
      });
    });

    const result = await listReplays("test-org", { limit: 150 });

    expect(result.data).toHaveLength(150);
    expect(result.nextCursor).toBeUndefined();
    expect(capturedUrls).toHaveLength(2);
    expect(capturedUrls.every((url) => url.includes("per_page=100"))).toBe(
      true
    );
  });
});

describe("getReplay", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(async () => {
    originalFetch = globalThis.fetch;
    await setAuthToken("test-token");
    setOrgRegion("test-org", DEFAULT_SENTRY_URL);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("calls the replay detail endpoint", async () => {
    let capturedUrl = "";

    globalThis.fetch = mockFetch(async (input, init) => {
      const req = new Request(input!, init);
      capturedUrl = req.url;
      return new Response(JSON.stringify({ data: replayRow() }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const replay = await getReplay("test-org", REPLAY_ID);

    expect(capturedUrl).toContain(
      `/api/0/organizations/test-org/replays/${REPLAY_ID}/`
    );
    expect(replay.id).toBe(REPLAY_ID);
    expect(replay.count_errors).toBe(2);
  });

  test("normalizes archived replay payload oddities", async () => {
    globalThis.fetch = mockFetch(
      async () =>
        new Response(
          JSON.stringify({
            data: {
              ...replayRow(),
              error_ids: undefined,
              info_ids: undefined,
              project_id: 42,
              releases: null,
              tags: [],
              trace_ids: undefined,
              urls: null,
              warning_ids: undefined,
            },
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        )
    );

    const replay = await getReplay("test-org", REPLAY_ID);

    expect(replay.project_id).toBe("42");
    expect(replay.tags).toEqual({});
    expect(replay.releases).toEqual([]);
    expect(replay.urls).toEqual([]);
    expect(replay.error_ids).toEqual([]);
    expect(replay.info_ids).toEqual([]);
    expect(replay.trace_ids).toEqual([]);
    expect(replay.warning_ids).toEqual([]);
  });
});

describe("getReplayRecordingSegments", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(async () => {
    originalFetch = globalThis.fetch;
    await setAuthToken("test-token");
    setOrgRegion("test-org", DEFAULT_SENTRY_URL);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("calls the project replay recording-segments endpoint", async () => {
    let capturedUrl = "";

    globalThis.fetch = mockFetch(async (input, init) => {
      const req = new Request(input!, init);
      capturedUrl = req.url;
      return new Response(JSON.stringify([[{ timestamp: 1 }]]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const segments = await getReplayRecordingSegments(
      "test-org",
      "42",
      REPLAY_ID
    );

    const url = new URL(capturedUrl);
    expect(url.pathname).toContain(
      `/api/0/projects/test-org/42/replays/${REPLAY_ID}/recording-segments/`
    );
    expect(url.searchParams.get("download")).toBe("true");
    expect(segments).toEqual([[{ timestamp: 1 }]]);
  });
});

describe("listReplayIdsForIssue", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(async () => {
    originalFetch = globalThis.fetch;
    await setAuthToken("test-token");
    setOrgRegion("test-org", DEFAULT_SENTRY_URL);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("calls the replay-count endpoint with the issue query", async () => {
    let capturedUrl = "";

    globalThis.fetch = mockFetch(async (input, init) => {
      const req = new Request(input!, init);
      capturedUrl = req.url;
      return new Response(
        JSON.stringify({
          "12345": [
            "346789a703f6454384f1de473b8b9fcc",
            "aaaaaaaa03f6454384f1de473b8b9fcc",
          ],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    });

    const replayIds = await listReplayIdsForIssue("test-org", "12345");
    const url = new URL(capturedUrl);

    expect(url.pathname).toContain(
      "/api/0/organizations/test-org/replay-count/"
    );
    expect(url.searchParams.get("returnIds")).toBe("true");
    expect(url.searchParams.get("query")).toBe("issue.id:[12345]");
    expect(url.searchParams.get("data_source")).toBe("discover");
    expect(url.searchParams.get("statsPeriod")).toBe("90d");
    expect(url.searchParams.getAll("project")).toEqual(["-1"]);
    expect(replayIds).toEqual([
      "346789a703f6454384f1de473b8b9fcc",
      "aaaaaaaa03f6454384f1de473b8b9fcc",
    ]);
  });
});
