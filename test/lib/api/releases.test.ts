/**
 * Release API Function Tests
 *
 * Tests the real API function bodies by mocking globalThis.fetch.
 * This ensures the functions correctly call the SDK, pass parameters,
 * and transform responses.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { DeployResponse, OrgReleaseResponse } from "@sentry/api";
import {
  createRelease,
  createReleaseDeploy,
  deleteRelease,
  getRelease,
  listReleaseDeploys,
  listReleasesPaginated,
  setCommitsLocal,
  updateRelease,
} from "../../../src/lib/api/releases.js";
import { setAuthToken } from "../../../src/lib/db/auth.js";
import { setOrgRegion } from "../../../src/lib/db/regions.js";
import { mockFetch, useTestConfigDir } from "../../helpers.js";

useTestConfigDir("api-releases-");

const SAMPLE_RELEASE: OrgReleaseResponse = {
  id: 1,
  version: "1.0.0",
  shortVersion: "1.0.0",
  status: "open",
  dateCreated: "2025-01-01T00:00:00Z",
  dateReleased: null,
  firstEvent: null,
  lastEvent: null,
  ref: null,
  url: null,
  commitCount: 0,
  deployCount: 0,
  newGroups: 0,
  authors: [],
  projects: [
    {
      id: 1,
      slug: "test-project",
      name: "Test Project",
      platform: "javascript",
      platforms: ["javascript"],
      hasHealthData: false,
      newGroups: 0,
    },
  ],
  data: {},
  versionInfo: null,
};

const SAMPLE_DEPLOY: DeployResponse = {
  id: "42",
  environment: "production",
  dateStarted: null,
  dateFinished: "2025-01-01T12:00:00Z",
  name: null,
  url: null,
};

let originalFetch: typeof globalThis.fetch;

/** Create a Link header for pagination */
function linkHeader(cursor: string, hasResults: boolean): string {
  return `<https://us.sentry.io/api/0/next/>; rel="next"; results="${hasResults}"; cursor="${cursor}"`;
}

beforeEach(async () => {
  originalFetch = globalThis.fetch;
  await setAuthToken("test-token");
  setOrgRegion("test-org", "https://us.sentry.io");
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// =============================================================================
// getRelease
// =============================================================================

describe("getRelease", () => {
  test("fetches a release by version", async () => {
    globalThis.fetch = mockFetch(async (input, init) => {
      const req = new Request(input!, init);
      expect(req.url).toContain("/releases/1.0.0/");
      return new Response(JSON.stringify(SAMPLE_RELEASE), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const release = await getRelease("test-org", "1.0.0");

    expect(release.version).toBe("1.0.0");
    expect(release.shortVersion).toBe("1.0.0");
    expect(release.id).toBe(1);
  });
});

// =============================================================================
// createRelease
// =============================================================================

describe("createRelease", () => {
  test("creates a release with version and projects", async () => {
    globalThis.fetch = mockFetch(async (input, init) => {
      const req = new Request(input!, init);
      expect(req.method).toBe("POST");
      const body = (await req.json()) as {
        version: string;
        projects: string[];
      };
      expect(body.version).toBe("1.0.0");
      expect(body.projects).toEqual(["test-project"]);
      return new Response(JSON.stringify(SAMPLE_RELEASE), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    });

    const release = await createRelease("test-org", {
      version: "1.0.0",
      projects: ["test-project"],
    });

    expect(release.version).toBe("1.0.0");
    expect(release.projects).toHaveLength(1);
  });
});

// =============================================================================
// updateRelease
// =============================================================================

describe("updateRelease", () => {
  test("updates a release with dateReleased", async () => {
    const updated = { ...SAMPLE_RELEASE, dateReleased: "2025-06-15T00:00:00Z" };
    globalThis.fetch = mockFetch(async (input, init) => {
      const req = new Request(input!, init);
      expect(req.method).toBe("PUT");
      expect(req.url).toContain("/releases/1.0.0/");
      const body = (await req.json()) as { dateReleased: string };
      expect(body.dateReleased).toBe("2025-06-15T00:00:00Z");
      return new Response(JSON.stringify(updated), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const release = await updateRelease("test-org", "1.0.0", {
      dateReleased: "2025-06-15T00:00:00Z",
    });

    expect(release.dateReleased).toBe("2025-06-15T00:00:00Z");
  });
});

// =============================================================================
// deleteRelease
// =============================================================================

describe("deleteRelease", () => {
  test("deletes a release", async () => {
    globalThis.fetch = mockFetch(async (input, init) => {
      const req = new Request(input!, init);
      expect(req.method).toBe("DELETE");
      expect(req.url).toContain("/releases/1.0.0/");
      return new Response(null, { status: 204 });
    });

    // Should not throw
    await deleteRelease("test-org", "1.0.0");
  });
});

// =============================================================================
// listReleaseDeploys
// =============================================================================

describe("listReleaseDeploys", () => {
  test("returns deploys for a release", async () => {
    globalThis.fetch = mockFetch(async (input, init) => {
      const req = new Request(input!, init);
      expect(req.url).toContain("/releases/1.0.0/deploys/");
      return new Response(JSON.stringify([SAMPLE_DEPLOY]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const deploys = await listReleaseDeploys("test-org", "1.0.0");

    expect(deploys).toHaveLength(1);
    expect(deploys[0].environment).toBe("production");
    expect(deploys[0].id).toBe("42");
  });
});

// =============================================================================
// createReleaseDeploy
// =============================================================================

describe("createReleaseDeploy", () => {
  test("creates a deploy for a release", async () => {
    globalThis.fetch = mockFetch(async (input, init) => {
      const req = new Request(input!, init);
      expect(req.method).toBe("POST");
      expect(req.url).toContain("/releases/1.0.0/deploys/");
      const body = (await req.json()) as { environment: string };
      expect(body.environment).toBe("production");
      return new Response(JSON.stringify(SAMPLE_DEPLOY), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    });

    const deploy = await createReleaseDeploy("test-org", "1.0.0", {
      environment: "production",
    });

    expect(deploy.environment).toBe("production");
    expect(deploy.id).toBe("42");
  });
});

// =============================================================================
// setCommitsAuto
// =============================================================================

// setCommitsAuto tests are in test/isolated/set-commits-auto.test.ts
// because they require mock.module() for git helpers.

// =============================================================================
// setCommitsLocal
// =============================================================================

describe("setCommitsLocal", () => {
  test("sends explicit commits to the API", async () => {
    const withCommits = { ...SAMPLE_RELEASE, commitCount: 2 };
    globalThis.fetch = mockFetch(async (input, init) => {
      const req = new Request(input!, init);
      expect(req.method).toBe("PUT");
      const body = (await req.json()) as {
        commits: Array<{ id: string; message: string }>;
      };
      expect(body.commits).toHaveLength(1);
      expect(body.commits[0].id).toBe("abc123");
      return new Response(JSON.stringify(withCommits), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const release = await setCommitsLocal("test-org", "1.0.0", [
      {
        id: "abc123",
        message: "fix: something",
        author_name: "Test",
        author_email: "test@example.com",
        timestamp: "2025-01-01T00:00:00Z",
      },
    ]);

    expect(release.commitCount).toBe(2);
  });
});

// =============================================================================
// listReleasesPaginated
// =============================================================================

describe("listReleasesPaginated", () => {
  test("returns a page of releases with cursor", async () => {
    globalThis.fetch = mockFetch(async (input, init) => {
      const req = new Request(input!, init);
      expect(req.url).toContain("/releases/");
      return new Response(JSON.stringify([SAMPLE_RELEASE]), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          link: linkHeader("abc:0:0", true),
        },
      });
    });

    const result = await listReleasesPaginated("test-org", { perPage: 25 });

    expect(result.data).toHaveLength(1);
    expect(result.data[0].version).toBe("1.0.0");
    expect(result.nextCursor).toBe("abc:0:0");
  });

  test("returns no cursor when no more pages", async () => {
    globalThis.fetch = mockFetch(
      async () =>
        new Response(JSON.stringify([SAMPLE_RELEASE]), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            link: linkHeader("abc:0:0", false),
          },
        })
    );

    const result = await listReleasesPaginated("test-org");

    expect(result.data).toHaveLength(1);
    expect(result.nextCursor).toBeUndefined();
  });

  test("passes query and sort options", async () => {
    globalThis.fetch = mockFetch(async (input, init) => {
      const req = new Request(input!, init);
      const url = new URL(req.url);
      expect(url.searchParams.get("query")).toBe("1.0");
      expect(url.searchParams.get("sort")).toBe("date");
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const result = await listReleasesPaginated("test-org", {
      query: "1.0",
      sort: "date",
    });

    expect(result.data).toHaveLength(0);
  });
});
