/**
 * Isolated tests for setCommitsAuto
 *
 * Uses mock.module() for git helpers, so must run in isolation
 * to avoid polluting other test files' module state.
 */

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { OrgReleaseResponse } from "@sentry/api";
import { setAuthToken } from "../../src/lib/db/auth.js";
import { setOrgRegion } from "../../src/lib/db/regions.js";
import { mockFetch, useTestConfigDir } from "../helpers.js";

useTestConfigDir("set-commits-auto-");

mock.module("../../src/lib/git.js", () => ({
  getRepositoryName: () => "getsentry/cli",
  getHeadCommit: () => "abc123def456789012345678901234567890abcd",
  isInsideGitWorkTree: () => true,
  isShallowRepository: () => false,
  getCommitLog: () => [],
  getUncommittedFiles: () => [],
  parseRemoteUrl: (url: string) => url,
}));

// Import after mock.module so the mocked git helpers are used
const { setCommitsAuto } = await import("../../src/lib/api/releases.js");

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

const SAMPLE_REPO = {
  id: "1",
  name: "getsentry/cli",
  url: "https://github.com/getsentry/cli",
  provider: { id: "integrations:github", name: "GitHub" },
  status: "active",
};

let originalFetch: typeof globalThis.fetch;

beforeEach(async () => {
  originalFetch = globalThis.fetch;
  await setAuthToken("test-token");
  setOrgRegion("test-org", "https://us.sentry.io");
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("setCommitsAuto", () => {
  test("lists repos, discovers HEAD, and sends refs to the API", async () => {
    const withCommits = { ...SAMPLE_RELEASE, commitCount: 5 };
    const requests: { method: string; url: string }[] = [];

    globalThis.fetch = mockFetch(async (input, init) => {
      const req = new Request(input!, init);
      requests.push({ method: req.method, url: req.url });

      // First request: list org repositories (SDK uses /repos/ endpoint)
      if (req.url.includes("/repos/")) {
        expect(req.method).toBe("GET");
        return new Response(JSON.stringify([SAMPLE_REPO]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Second request: PUT refs on the release
      expect(req.method).toBe("PUT");
      expect(req.url).toContain("/releases/1.0.0/");
      const body = (await req.json()) as {
        refs: Array<{ repository: string; commit: string }>;
      };
      expect(body.refs).toEqual([
        {
          repository: "getsentry/cli",
          commit: "abc123def456789012345678901234567890abcd",
        },
      ]);
      return new Response(JSON.stringify(withCommits), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const release = await setCommitsAuto("test-org", "1.0.0", "/tmp");

    expect(release.commitCount).toBe(5);
    expect(requests).toHaveLength(2);
  });

  test("throws when org has no repositories", async () => {
    globalThis.fetch = mockFetch(
      async () =>
        new Response(JSON.stringify([]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
    );

    expect(setCommitsAuto("test-org", "1.0.0", "/tmp")).rejects.toThrow(
      /No repository integrations/
    );
  });
});
