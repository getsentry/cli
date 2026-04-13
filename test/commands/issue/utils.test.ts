/**
 * Issue Command Utilities Tests
 *
 * Tests for shared utilities in src/commands/issue/utils.ts
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  buildCommandHint,
  ensureRootCauseAnalysis,
  pollAutofixState,
  resolveIssue,
  resolveOrgAndIssueId,
} from "../../../src/commands/issue/utils.js";
import { DEFAULT_SENTRY_URL } from "../../../src/lib/constants.js";
import { setAuthToken } from "../../../src/lib/db/auth.js";
import { setCachedProject } from "../../../src/lib/db/project-cache.js";
import { setOrgRegion } from "../../../src/lib/db/regions.js";
import { ApiError, ResolutionError } from "../../../src/lib/errors.js";
import { mockFetch, useTestConfigDir } from "../../helpers.js";

describe("buildCommandHint", () => {
  test("suggests <org>/ID for numeric IDs", () => {
    expect(buildCommandHint("view", "123456789")).toBe(
      "sentry issue view <org>/123456789"
    );
    expect(buildCommandHint("explain", "0")).toBe(
      "sentry issue explain <org>/0"
    );
  });

  test("suggests <project>-suffix for short suffixes", () => {
    expect(buildCommandHint("view", "G")).toBe("sentry issue view <project>-G");
    expect(buildCommandHint("explain", "4Y")).toBe(
      "sentry issue explain <project>-4Y"
    );
    expect(buildCommandHint("plan", "ABC")).toBe(
      "sentry issue plan <project>-ABC"
    );
  });

  test("suggests <org>/ID for IDs with dashes", () => {
    expect(buildCommandHint("view", "cli-G")).toBe(
      "sentry issue view <org>/cli-G"
    );
    expect(buildCommandHint("explain", "PROJECT-ABC")).toBe(
      "sentry issue explain <org>/PROJECT-ABC"
    );
  });

  test("suggests <org>/@selector for selectors", () => {
    expect(buildCommandHint("view", "@latest")).toBe(
      "sentry issue view <org>/@latest"
    );
    expect(buildCommandHint("explain", "@most_frequent")).toBe(
      "sentry issue explain <org>/@most_frequent"
    );
  });

  test("shows as-is when input already contains a slash (CLI-8C)", () => {
    // org/numeric — don't add another <org>/ prefix
    expect(buildCommandHint("view", "saber-ut/103103195")).toBe(
      "sentry issue view saber-ut/103103195"
    );
    // org/project-suffix — already has full context
    expect(buildCommandHint("view", "sentry/cli-G")).toBe(
      "sentry issue view sentry/cli-G"
    );
    // org/project/suffix — three-level path, show as-is
    expect(buildCommandHint("explain", "sentry/cli/CLI-A1")).toBe(
      "sentry issue explain sentry/cli/CLI-A1"
    );
  });

  test("returns URL as-is for share URLs", () => {
    const shareUrl =
      "https://gibush-kq.sentry.io/share/issue/f1abd515c51346778384ff25dfb341e5/";
    expect(buildCommandHint("view", shareUrl)).toBe(
      `sentry issue view ${shareUrl}`
    );
  });

  test("returns URL as-is for regular issue URLs", () => {
    const issueUrl = "https://sentry.io/organizations/my-org/issues/12345/";
    expect(buildCommandHint("view", issueUrl)).toBe(
      `sentry issue view ${issueUrl}`
    );
  });
});

const getConfigDir = useTestConfigDir("test-issue-utils-", {
  isolateProjectRoot: true,
});

let originalFetch: typeof globalThis.fetch;

beforeEach(async () => {
  originalFetch = globalThis.fetch;
  // Default to a silent 404 so tests that don't set a custom fetch mock
  // won't produce "unexpected fetch" warnings from the preload trap.
  globalThis.fetch = mockFetch(
    async () =>
      new Response(JSON.stringify({ detail: "Not found" }), { status: 404 })
  );
  await setAuthToken("test-token");
  // Pre-populate region cache for orgs used in tests to avoid region resolution API calls
  setOrgRegion("test-org", DEFAULT_SENTRY_URL);
  setOrgRegion("my-org", DEFAULT_SENTRY_URL);
  setOrgRegion("cached-org", DEFAULT_SENTRY_URL);
  setOrgRegion("org1", DEFAULT_SENTRY_URL);
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("resolveOrgAndIssueId", () => {
  test("throws for numeric ID (org cannot be resolved)", async () => {
    // @ts-expect-error - partial mock
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      const url = req.url;

      // Numeric ID is fetched directly
      if (url.includes("/issues/123456789/")) {
        return new Response(
          JSON.stringify({
            id: "123456789",
            shortId: "PROJECT-ABC",
            title: "Test Issue",
            status: "unresolved",
            platform: "javascript",
            type: "error",
            count: "10",
            userCount: 5,
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      return new Response(JSON.stringify({ detail: "Not found" }), {
        status: 404,
      });
    };

    // Numeric IDs don't have org context, so resolveOrgAndIssueId should throw
    await expect(
      resolveOrgAndIssueId({
        issueArg: "123456789",
        cwd: getConfigDir(),
        command: "explain",
      })
    ).rejects.toThrow("Organization");
  });

  test("resolves numeric ID when API response includes subdomain-style permalink", async () => {
    // @ts-expect-error - partial mock
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      const url = req.url;

      if (url.includes("/issues/123456789/")) {
        return new Response(
          JSON.stringify({
            id: "123456789",
            shortId: "PROJECT-ABC",
            title: "Test Issue",
            status: "unresolved",
            platform: "javascript",
            type: "error",
            count: "10",
            userCount: 5,
            // Org slug embedded in subdomain-style permalink
            permalink: "https://my-org.sentry.io/issues/123456789/",
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      return new Response(JSON.stringify({ detail: "Not found" }), {
        status: 404,
      });
    };

    // Org should be extracted from permalink — no longer throws
    const result = await resolveOrgAndIssueId({
      issueArg: "123456789",
      cwd: getConfigDir(),
      command: "explain",
    });
    expect(result.org).toBe("my-org");
    expect(result.issueId).toBe("123456789");
  });

  test("resolves numeric ID when API response includes path-style permalink", async () => {
    // @ts-expect-error - partial mock
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      const url = req.url;

      if (url.includes("/issues/55555555/")) {
        return new Response(
          JSON.stringify({
            id: "55555555",
            shortId: "BACKEND-XY",
            title: "Another Issue",
            status: "unresolved",
            platform: "python",
            type: "error",
            count: "1",
            userCount: 1,
            // Path-style permalink (sentry.io/organizations/{org}/issues/{id}/)
            permalink:
              "https://sentry.io/organizations/acme-corp/issues/55555555/",
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      return new Response(JSON.stringify({ detail: "Not found" }), {
        status: 404,
      });
    };

    const result = await resolveOrgAndIssueId({
      issueArg: "55555555",
      cwd: getConfigDir(),
      command: "explain",
    });
    expect(result.org).toBe("acme-corp");
    expect(result.issueId).toBe("55555555");
  });

  test("resolves explicit org prefix (org/ISSUE-ID)", async () => {
    // @ts-expect-error - partial mock
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      const url = req.url;

      if (url.includes("organizations/my-org/shortids/PROJECT-ABC")) {
        return new Response(
          JSON.stringify({
            organizationSlug: "my-org",
            projectSlug: "project",
            groupId: "987654321",
            group: {
              id: "987654321",
              shortId: "PROJECT-ABC",
              title: "Test Issue",
              status: "unresolved",
              platform: "javascript",
              type: "error",
              count: "10",
              userCount: 5,
            },
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      return new Response(JSON.stringify({ detail: "Not found" }), {
        status: 404,
      });
    };

    const result = await resolveOrgAndIssueId({
      issueArg: "my-org/PROJECT-ABC",
      cwd: getConfigDir(),
      command: "explain",
    });

    expect(result.org).toBe("my-org");
    expect(result.issueId).toBe("987654321");
  });

  test("resolves alias-suffix format (e.g., 'f-g') using cached aliases", async () => {
    // Empty fingerprint matches detectAllDsns on empty dir
    const { setProjectAliases } = await import(
      "../../../src/lib/db/project-aliases.js"
    );
    setProjectAliases(
      {
        f: { orgSlug: "cached-org", projectSlug: "frontend" },
        b: { orgSlug: "cached-org", projectSlug: "backend" },
      },
      ""
    );

    // @ts-expect-error - partial mock
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      const url = req.url;

      if (url.includes("organizations/cached-org/shortids/FRONTEND-G")) {
        return new Response(
          JSON.stringify({
            organizationSlug: "cached-org",
            projectSlug: "frontend",
            groupId: "111222333",
            group: {
              id: "111222333",
              shortId: "FRONTEND-G",
              title: "Test Issue from alias",
              status: "unresolved",
              platform: "javascript",
              type: "error",
              count: "5",
              userCount: 2,
            },
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      return new Response(JSON.stringify({ detail: "Not found" }), {
        status: 404,
      });
    };

    const result = await resolveOrgAndIssueId({
      issueArg: "f-g",
      cwd: getConfigDir(),
      command: "explain",
    });

    expect(result.org).toBe("cached-org");
    expect(result.issueId).toBe("111222333");
  });

  test("resolves explicit org prefix with project-suffix (e.g., 'org1/dashboard-4y')", async () => {
    // @ts-expect-error - partial mock
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      const url = req.url;

      // With explicit org, we try project-suffix format: dashboard-4y -> DASHBOARD-4Y
      if (url.includes("organizations/org1/shortids/DASHBOARD-4Y")) {
        return new Response(
          JSON.stringify({
            organizationSlug: "org1",
            projectSlug: "dashboard",
            groupId: "999888777",
            group: {
              id: "999888777",
              shortId: "DASHBOARD-4Y",
              title: "Test Issue with explicit org",
              status: "unresolved",
              platform: "javascript",
              type: "error",
              count: "1",
              userCount: 1,
            },
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      return new Response(JSON.stringify({ detail: "Not found" }), {
        status: 404,
      });
    };

    const result = await resolveOrgAndIssueId({
      issueArg: "org1/dashboard-4y",
      cwd: getConfigDir(),
      command: "explain",
    });

    expect(result.org).toBe("org1");
    expect(result.issueId).toBe("999888777");
  });

  test("resolves short suffix format (e.g., 'G') using project context from defaults", async () => {
    const { setDefaults } = await import("../../../src/lib/db/defaults.js");
    setDefaults("my-org", "my-project");

    // @ts-expect-error - partial mock
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      const url = req.url;

      if (url.includes("organizations/my-org/shortids/MY-PROJECT-G")) {
        return new Response(
          JSON.stringify({
            organizationSlug: "my-org",
            projectSlug: "my-project",
            groupId: "444555666",
            group: {
              id: "444555666",
              shortId: "MY-PROJECT-G",
              title: "Test Issue from short suffix",
              status: "unresolved",
              platform: "python",
              type: "error",
              count: "3",
              userCount: 1,
            },
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      return new Response(JSON.stringify({ detail: "Not found" }), {
        status: 404,
      });
    };

    const result = await resolveOrgAndIssueId({
      issueArg: "G",
      cwd: getConfigDir(),
      command: "explain",
    });

    expect(result.org).toBe("my-org");
    expect(result.issueId).toBe("444555666");
  });

  test("throws ResolutionError for short suffix without project context", async () => {
    // Clear any defaults to ensure no project context
    const { clearAuth } = await import("../../../src/lib/db/auth.js");
    const { setDefaults } = await import("../../../src/lib/db/defaults.js");
    await clearAuth();
    setDefaults(undefined, undefined);

    await expect(
      resolveOrgAndIssueId({
        issueArg: "G",
        cwd: getConfigDir(),
        command: "explain",
      })
    ).rejects.toThrow("could not be resolved");
  });

  test("searches projects across orgs for project-suffix format", async () => {
    const { clearProjectAliases } = await import(
      "../../../src/lib/db/project-aliases.js"
    );
    clearProjectAliases();

    // @ts-expect-error - partial mock
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      const url = req.url;

      // getUserRegions - return empty regions to use fallback path
      if (url.includes("/users/me/regions/")) {
        return new Response(JSON.stringify({ regions: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      // listOrganizations call
      if (
        url.includes("/organizations/") &&
        !url.includes("/projects/") &&
        !url.includes("/issues/") &&
        !url.includes("/shortids/")
      ) {
        return new Response(
          JSON.stringify([{ id: "1", slug: "my-org", name: "My Org" }]),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      // getProject for my-org/craft - found
      if (url.includes("/projects/my-org/craft/")) {
        return new Response(
          JSON.stringify({
            id: "123",
            slug: "craft",
            name: "Craft",
            platform: "javascript",
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      if (url.includes("organizations/my-org/shortids/CRAFT-G")) {
        return new Response(
          JSON.stringify({
            organizationSlug: "my-org",
            projectSlug: "craft",
            groupId: "777888999",
            group: {
              id: "777888999",
              shortId: "CRAFT-G",
              title: "Test Issue fallback",
              status: "unresolved",
              platform: "javascript",
              type: "error",
              count: "1",
              userCount: 1,
            },
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      return new Response(JSON.stringify({ detail: "Not found" }), {
        status: 404,
      });
    };

    const result = await resolveOrgAndIssueId({
      issueArg: "craft-g",
      cwd: getConfigDir(),
      command: "explain",
    });

    expect(result.org).toBe("my-org");
    expect(result.issueId).toBe("777888999");
  });

  test("throws when project not found in any org", async () => {
    const { clearProjectAliases } = await import(
      "../../../src/lib/db/project-aliases.js"
    );
    clearProjectAliases();

    // @ts-expect-error - partial mock
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      const url = req.url;

      // getUserRegions - return empty regions to use fallback path
      if (url.includes("/users/me/regions/")) {
        return new Response(JSON.stringify({ regions: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      // listOrganizations call
      if (
        url.includes("/organizations/") &&
        !url.includes("/projects/") &&
        !url.includes("/issues/") &&
        !url.includes("/shortids/")
      ) {
        return new Response(
          JSON.stringify([{ id: "1", slug: "my-org", name: "My Org" }]),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      // getProject (single project detail) — "nonexistent" doesn't exist
      // URL pattern: /projects/{org}/{project}/
      if (url.match(/\/projects\/[^/]+\/[^/]+/)) {
        return new Response(JSON.stringify({ detail: "Not found" }), {
          status: 404,
        });
      }

      // listProjects — return projects that don't match "nonexistent"
      // URL pattern: /organizations/{org}/projects/
      if (url.includes("/projects/")) {
        return new Response(
          JSON.stringify([
            {
              id: "123",
              slug: "other-project",
              name: "Other",
              platform: "python",
            },
          ]),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      return new Response(JSON.stringify({ detail: "Not found" }), {
        status: 404,
      });
    };

    await expect(
      resolveOrgAndIssueId({
        issueArg: "nonexistent-g",
        cwd: getConfigDir(),
        command: "explain",
      })
    ).rejects.toThrow("not found");
  });

  test("throws when project found in multiple orgs without explicit org", async () => {
    const { clearProjectAliases } = await import(
      "../../../src/lib/db/project-aliases.js"
    );
    clearProjectAliases();

    setOrgRegion("org2", DEFAULT_SENTRY_URL);

    // @ts-expect-error - partial mock
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      const url = req.url;

      // getUserRegions - return empty regions to use fallback path
      if (url.includes("/users/me/regions/")) {
        return new Response(JSON.stringify({ regions: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      // listOrganizations call
      if (
        url.includes("/organizations/") &&
        !url.includes("/projects/") &&
        !url.includes("/issues/") &&
        !url.includes("/shortids/")
      ) {
        return new Response(
          JSON.stringify([
            { id: "1", slug: "org1", name: "Org 1" },
            { id: "2", slug: "org2", name: "Org 2" },
          ]),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      // getProject for org1/common - found
      if (url.includes("/projects/org1/common/")) {
        return new Response(
          JSON.stringify({
            id: "123",
            slug: "common",
            name: "Common",
            platform: "javascript",
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      // getProject for org2/common - also found
      if (url.includes("/projects/org2/common/")) {
        return new Response(
          JSON.stringify({
            id: "456",
            slug: "common",
            name: "Common",
            platform: "python",
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      return new Response(JSON.stringify({ detail: "Not found" }), {
        status: 404,
      });
    };

    await expect(
      resolveOrgAndIssueId({
        issueArg: "common-g",
        cwd: getConfigDir(),
        command: "explain",
      })
    ).rejects.toThrow("is ambiguous");
  });

  test("short suffix auth error (401) propagates", async () => {
    const { setDefaults } = await import("../../../src/lib/db/defaults.js");
    setDefaults("my-org", "my-project");

    // @ts-expect-error - partial mock
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ detail: "Unauthorized" }), {
        status: 401,
      });

    // Auth errors should propagate
    await expect(
      resolveOrgAndIssueId({
        issueArg: "G",
        cwd: getConfigDir(),
        command: "explain",
      })
    ).rejects.toThrow();
  });

  test("short suffix server error (500) propagates", async () => {
    const { setDefaults } = await import("../../../src/lib/db/defaults.js");
    setDefaults("my-org", "my-project");

    // @ts-expect-error - partial mock
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ detail: "Internal Server Error" }), {
        status: 500,
      });

    // Server errors should propagate
    await expect(
      resolveOrgAndIssueId({
        issueArg: "G",
        cwd: getConfigDir(),
        command: "explain",
      })
    ).rejects.toThrow("500");
  });

  test("fast path: ambiguous when shortid resolves in multiple orgs", async () => {
    const { clearProjectAliases } = await import(
      "../../../src/lib/db/project-aliases.js"
    );
    clearProjectAliases();

    setOrgRegion("org2", DEFAULT_SENTRY_URL);

    const makeShortIdResponse = (orgSlug: string, groupId: string) =>
      new Response(
        JSON.stringify({
          organizationSlug: orgSlug,
          projectSlug: "shared",
          groupId,
          group: {
            id: groupId,
            shortId: "SHARED-G",
            title: "Test Issue",
            status: "unresolved",
            platform: "javascript",
            type: "error",
            count: "1",
            userCount: 1,
          },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );

    // @ts-expect-error - partial mock
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      const url = req.url;

      if (url.includes("/users/me/regions/")) {
        return new Response(JSON.stringify({ regions: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (
        url.includes("/organizations/") &&
        !url.includes("/projects/") &&
        !url.includes("/issues/") &&
        !url.includes("/shortids/")
      ) {
        return new Response(
          JSON.stringify([
            { id: "1", slug: "org1", name: "Org 1" },
            { id: "2", slug: "org2", name: "Org 2" },
          ]),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      // Both orgs resolve the shortid — triggers fast-path ambiguity
      if (url.includes("organizations/org1/shortids/SHARED-G")) {
        return makeShortIdResponse("org1", "111");
      }
      if (url.includes("organizations/org2/shortids/SHARED-G")) {
        return makeShortIdResponse("org2", "222");
      }

      return new Response(JSON.stringify({ detail: "Not found" }), {
        status: 404,
      });
    };

    await expect(
      resolveOrgAndIssueId({
        issueArg: "shared-g",
        cwd: getConfigDir(),
        command: "explain",
      })
    ).rejects.toThrow("is ambiguous");
  });

  test("fast path: surfaces 403 when all orgs return forbidden", async () => {
    const { clearProjectAliases } = await import(
      "../../../src/lib/db/project-aliases.js"
    );
    clearProjectAliases();

    // @ts-expect-error - partial mock
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      const url = req.url;

      if (url.includes("/users/me/regions/")) {
        return new Response(JSON.stringify({ regions: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (
        url.includes("/organizations/") &&
        !url.includes("/projects/") &&
        !url.includes("/issues/") &&
        !url.includes("/shortids/")
      ) {
        return new Response(
          JSON.stringify([{ id: "1", slug: "my-org", name: "My Org" }]),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      // Shortid endpoint returns 403 for all orgs
      if (url.includes("/shortids/")) {
        return new Response(
          JSON.stringify({ detail: "You do not have permission" }),
          { status: 403 }
        );
      }

      return new Response(JSON.stringify({ detail: "Not found" }), {
        status: 404,
      });
    };

    const err = await resolveOrgAndIssueId({
      issueArg: "restricted-g",
      cwd: getConfigDir(),
      command: "explain",
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(403);
  });

  test("fast path: surfaces 500 when all orgs return server error", async () => {
    const { clearProjectAliases } = await import(
      "../../../src/lib/db/project-aliases.js"
    );
    clearProjectAliases();

    // @ts-expect-error - partial mock
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      const url = req.url;

      if (url.includes("/users/me/regions/")) {
        return new Response(JSON.stringify({ regions: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (
        url.includes("/organizations/") &&
        !url.includes("/projects/") &&
        !url.includes("/issues/") &&
        !url.includes("/shortids/")
      ) {
        return new Response(
          JSON.stringify([{ id: "1", slug: "my-org", name: "My Org" }]),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      // Shortid endpoint returns 500 for all orgs
      if (url.includes("/shortids/")) {
        return new Response(
          JSON.stringify({ detail: "Internal Server Error" }),
          { status: 500 }
        );
      }

      return new Response(JSON.stringify({ detail: "Not found" }), {
        status: 404,
      });
    };

    const err = await resolveOrgAndIssueId({
      issueArg: "broken-g",
      cwd: getConfigDir(),
      command: "explain",
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(500);
  });
});

describe("pollAutofixState", () => {
  test("returns immediately when state is COMPLETED", async () => {
    let fetchCount = 0;

    // @ts-expect-error - partial mock
    globalThis.fetch = async () => {
      fetchCount += 1;
      return new Response(
        JSON.stringify({
          autofix: {
            run_id: 12_345,
            status: "COMPLETED",
            steps: [],
          },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    };

    const result = await pollAutofixState({
      orgSlug: "test-org",
      issueId: "123456789",

      json: true,
    });

    expect(result.status).toBe("COMPLETED");
    expect(fetchCount).toBe(1);
  });

  test("returns immediately when state is ERROR", async () => {
    // @ts-expect-error - partial mock
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          autofix: {
            run_id: 12_345,
            status: "ERROR",
            steps: [],
          },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );

    const result = await pollAutofixState({
      orgSlug: "test-org",
      issueId: "123456789",

      json: true,
    });

    expect(result.status).toBe("ERROR");
  });

  test("stops at WAITING_FOR_USER_RESPONSE when stopOnWaitingForUser is true", async () => {
    // @ts-expect-error - partial mock
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          autofix: {
            run_id: 12_345,
            status: "WAITING_FOR_USER_RESPONSE",
            steps: [],
          },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );

    const result = await pollAutofixState({
      orgSlug: "test-org",
      issueId: "123456789",

      json: true,
      stopOnWaitingForUser: true,
    });

    expect(result.status).toBe("WAITING_FOR_USER_RESPONSE");
  });

  test("continues polling when PROCESSING", async () => {
    let fetchCount = 0;

    // @ts-expect-error - partial mock
    globalThis.fetch = async () => {
      fetchCount += 1;

      // Return PROCESSING for first call, COMPLETED for second
      if (fetchCount === 1) {
        return new Response(
          JSON.stringify({
            autofix: {
              run_id: 12_345,
              status: "PROCESSING",
              steps: [],
            },
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      return new Response(
        JSON.stringify({
          autofix: {
            run_id: 12_345,
            status: "COMPLETED",
            steps: [],
          },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    };

    const result = await pollAutofixState({
      orgSlug: "test-org",
      issueId: "123456789",

      json: true,
      pollIntervalMs: 10, // Short interval for test
    });

    expect(result.status).toBe("COMPLETED");
    expect(fetchCount).toBe(2);
  });

  test("writes progress to stdout when not in JSON mode", async () => {
    let stdoutOutput = "";
    let fetchCount = 0;

    // Force rich output so the spinner isn't suppressed in non-TTY test env
    const origPlain = process.env.SENTRY_PLAIN_OUTPUT;
    process.env.SENTRY_PLAIN_OUTPUT = "0";

    // Spy on process.stdout.write to capture spinner output
    const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string | Uint8Array) => {
      stdoutOutput += String(chunk);
      return true;
    }) as typeof process.stdout.write;

    try {
      // Return PROCESSING first to allow animation interval to fire,
      // then COMPLETED on second call
      // @ts-expect-error - partial mock
      globalThis.fetch = async () => {
        fetchCount += 1;

        if (fetchCount === 1) {
          return new Response(
            JSON.stringify({
              autofix: {
                run_id: 12_345,
                status: "PROCESSING",
                steps: [
                  {
                    id: "step-1",
                    key: "analysis",
                    status: "PROCESSING",
                    title: "Analysis",
                    progress: [
                      {
                        message: "Analyzing...",
                        timestamp: "2025-01-01T00:00:00Z",
                      },
                    ],
                  },
                ],
              },
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }
          );
        }

        return new Response(
          JSON.stringify({
            autofix: {
              run_id: 12_345,
              status: "COMPLETED",
              steps: [],
            },
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        );
      };

      await pollAutofixState({
        orgSlug: "test-org",
        issueId: "123456789",
        json: false,
        pollIntervalMs: 100, // Allow animation interval (80ms) to fire
      });

      expect(stdoutOutput).toContain("Analyzing");
    } finally {
      process.stdout.write = origWrite;
      if (origPlain === undefined) {
        delete process.env.SENTRY_PLAIN_OUTPUT;
      } else {
        process.env.SENTRY_PLAIN_OUTPUT = origPlain;
      }
    }
  });

  test("throws timeout error when exceeding timeoutMs", async () => {
    // @ts-expect-error - partial mock
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          autofix: {
            run_id: 12_345,
            status: "PROCESSING",
            steps: [],
          },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );

    await expect(
      pollAutofixState({
        orgSlug: "test-org",
        issueId: "123456789",

        json: true,
        timeoutMs: 50,
        pollIntervalMs: 20,
        timeoutMessage: "Custom timeout message",
      })
    ).rejects.toThrow("Custom timeout message");
  });

  test("continues polling when autofix is null", async () => {
    let fetchCount = 0;

    // @ts-expect-error - partial mock
    globalThis.fetch = async () => {
      fetchCount += 1;

      // Return null for first call, state for second
      if (fetchCount === 1) {
        return new Response(JSON.stringify({ autofix: null }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      return new Response(
        JSON.stringify({
          autofix: {
            run_id: 12_345,
            status: "COMPLETED",
            steps: [],
          },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    };

    const result = await pollAutofixState({
      orgSlug: "test-org",
      issueId: "123456789",

      json: true,
      pollIntervalMs: 10,
    });

    expect(result.status).toBe("COMPLETED");
    expect(fetchCount).toBe(2);
  });
});

describe("ensureRootCauseAnalysis", () => {
  test("returns immediately when state is COMPLETED", async () => {
    let fetchCount = 0;

    // @ts-expect-error - partial mock
    globalThis.fetch = async () => {
      fetchCount += 1;
      return new Response(
        JSON.stringify({
          autofix: {
            run_id: 12_345,
            status: "COMPLETED",
            steps: [],
          },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    };

    const result = await ensureRootCauseAnalysis({
      org: "test-org",
      issueId: "123456789",

      json: true,
    });

    expect(result.status).toBe("COMPLETED");
    expect(fetchCount).toBe(1); // Only one fetch to check state
  });

  test("returns immediately when state is WAITING_FOR_USER_RESPONSE", async () => {
    let fetchCount = 0;

    // @ts-expect-error - partial mock
    globalThis.fetch = async () => {
      fetchCount += 1;
      return new Response(
        JSON.stringify({
          autofix: {
            run_id: 12_345,
            status: "WAITING_FOR_USER_RESPONSE",
            steps: [],
          },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    };

    const result = await ensureRootCauseAnalysis({
      org: "test-org",
      issueId: "123456789",

      json: true,
    });

    expect(result.status).toBe("WAITING_FOR_USER_RESPONSE");
    expect(fetchCount).toBe(1);
  });

  test("triggers new analysis when no state exists", async () => {
    let triggerCalled = false;

    // @ts-expect-error - partial mock
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      const url = req.url;

      // First call: getAutofixState returns null
      if (url.includes("/autofix/") && req.method === "GET") {
        // After trigger, return COMPLETED
        if (triggerCalled) {
          return new Response(
            JSON.stringify({
              autofix: {
                run_id: 12_345,
                status: "COMPLETED",
                steps: [],
              },
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }
          );
        }
        // Before trigger, return null
        return new Response(JSON.stringify({ autofix: null }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Trigger RCA endpoint
      if (url.includes("/autofix/") && req.method === "POST") {
        triggerCalled = true;
        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ detail: "Not found" }), {
        status: 404,
      });
    };

    const result = await ensureRootCauseAnalysis({
      org: "test-org",
      issueId: "123456789",

      json: true,
    });

    expect(result.status).toBe("COMPLETED");
    expect(triggerCalled).toBe(true);
  });

  test("retries when existing analysis has ERROR status", async () => {
    let triggerCalled = false;

    // @ts-expect-error - partial mock
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      const url = req.url;

      // getAutofixState
      if (url.includes("/autofix/") && req.method === "GET") {
        // First call returns ERROR, subsequent calls return COMPLETED
        if (!triggerCalled) {
          return new Response(
            JSON.stringify({
              autofix: {
                run_id: 12_345,
                status: "ERROR",
                steps: [],
              },
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }
          );
        }
        return new Response(
          JSON.stringify({
            autofix: {
              run_id: 12_346,
              status: "COMPLETED",
              steps: [],
            },
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      // Trigger RCA endpoint
      if (url.includes("/autofix/") && req.method === "POST") {
        triggerCalled = true;
        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ detail: "Not found" }), {
        status: 404,
      });
    };

    const result = await ensureRootCauseAnalysis({
      org: "test-org",
      issueId: "123456789",

      json: true,
    });

    expect(result.status).toBe("COMPLETED");
    expect(triggerCalled).toBe(true); // Should have retried
  });

  test("polls until complete when state is PROCESSING", async () => {
    let fetchCount = 0;

    // @ts-expect-error - partial mock
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);

      if (req.method === "GET") {
        fetchCount += 1;

        // First call returns PROCESSING, second returns COMPLETED
        if (fetchCount === 1) {
          return new Response(
            JSON.stringify({
              autofix: {
                run_id: 12_345,
                status: "PROCESSING",
                steps: [],
              },
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }
          );
        }

        return new Response(
          JSON.stringify({
            autofix: {
              run_id: 12_345,
              status: "COMPLETED",
              steps: [],
            },
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      return new Response(JSON.stringify({ detail: "Not found" }), {
        status: 404,
      });
    };

    const result = await ensureRootCauseAnalysis({
      org: "test-org",
      issueId: "123456789",

      json: true,
    });

    expect(result.status).toBe("COMPLETED");
    expect(fetchCount).toBeGreaterThan(1); // Polled multiple times
  });

  test("forces new analysis when force flag is true", async () => {
    let triggerCalled = false;

    // @ts-expect-error - partial mock
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      const url = req.url;

      // getAutofixState - would return COMPLETED, but force should skip this
      if (url.includes("/autofix/") && req.method === "GET") {
        // After trigger, return new COMPLETED state
        return new Response(
          JSON.stringify({
            autofix: {
              run_id: triggerCalled ? 99_999 : 12_345,
              status: "COMPLETED",
              steps: [],
            },
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      // Trigger RCA endpoint
      if (url.includes("/autofix/") && req.method === "POST") {
        triggerCalled = true;
        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ detail: "Not found" }), {
        status: 404,
      });
    };

    const result = await ensureRootCauseAnalysis({
      org: "test-org",
      issueId: "123456789",

      json: true,
      force: true,
    });

    expect(result.status).toBe("COMPLETED");
    expect(triggerCalled).toBe(true); // Should trigger even though state exists
  });

  test("writes progress messages to stdout when not in JSON mode", async () => {
    let stdoutOutput = "";
    let triggerCalled = false;

    // Force rich output so the spinner isn't suppressed in non-TTY test env
    const origPlain = process.env.SENTRY_PLAIN_OUTPUT;
    process.env.SENTRY_PLAIN_OUTPUT = "0";

    // Spy on process.stdout.write to capture spinner output
    const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string | Uint8Array) => {
      stdoutOutput += String(chunk);
      return true;
    }) as typeof process.stdout.write;

    try {
      // @ts-expect-error - partial mock
      globalThis.fetch = async (
        input: RequestInfo | URL,
        init?: RequestInit
      ) => {
        const req = new Request(input, init);
        const url = req.url;

        if (url.includes("/autofix/") && req.method === "GET") {
          if (triggerCalled) {
            return new Response(
              JSON.stringify({
                autofix: {
                  run_id: 12_345,
                  status: "COMPLETED",
                  steps: [],
                },
              }),
              {
                status: 200,
                headers: { "Content-Type": "application/json" },
              }
            );
          }
          return new Response(JSON.stringify({ autofix: null }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }

        if (url.includes("/autofix/") && req.method === "POST") {
          triggerCalled = true;
          return new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }

        return new Response(JSON.stringify({ detail: "Not found" }), {
          status: 404,
        });
      };

      await ensureRootCauseAnalysis({
        org: "test-org",
        issueId: "123456789",
        json: false, // Not JSON mode, should output progress
      });

      // The poll spinner writes to stdout — check for the spinner's initial message
      expect(stdoutOutput).toContain("Waiting for analysis");
    } finally {
      process.stdout.write = origWrite;
      if (origPlain === undefined) {
        delete process.env.SENTRY_PLAIN_OUTPUT;
      } else {
        process.env.SENTRY_PLAIN_OUTPUT = origPlain;
      }
    }
  });
});

describe("resolveOrgAndIssueId: magic @ selectors", () => {
  test("resolves @latest to the most recent unresolved issue", async () => {
    const { setDefaults } = await import("../../../src/lib/db/defaults.js");
    setDefaults("test-org", undefined);

    // @ts-expect-error - partial mock
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      const url = req.url;

      // listIssuesPaginated: /organizations/test-org/issues/?query=is:unresolved&sort=date&limit=1
      if (
        url.includes("/organizations/test-org/issues/") &&
        url.includes("sort=date")
      ) {
        return new Response(
          JSON.stringify([
            {
              id: "111222333",
              shortId: "CLI-G",
              title: "Latest issue",
              status: "unresolved",
              platform: "javascript",
              type: "error",
              count: "5",
              userCount: 2,
            },
          ]),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      return new Response(JSON.stringify({ detail: "Not found" }), {
        status: 404,
      });
    };

    const result = await resolveOrgAndIssueId({
      issueArg: "@latest",
      cwd: getConfigDir(),
      command: "view",
    });

    expect(result.org).toBe("test-org");
    expect(result.issueId).toBe("111222333");
  });

  test("resolves @most_frequent to the highest frequency issue", async () => {
    const { setDefaults } = await import("../../../src/lib/db/defaults.js");
    setDefaults("test-org", undefined);

    // @ts-expect-error - partial mock
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      const url = req.url;

      // listIssuesPaginated: sort=freq
      if (
        url.includes("/organizations/test-org/issues/") &&
        url.includes("sort=freq")
      ) {
        return new Response(
          JSON.stringify([
            {
              id: "444555666",
              shortId: "CLI-H",
              title: "Frequent issue",
              status: "unresolved",
              platform: "python",
              type: "error",
              count: "1000",
              userCount: 50,
            },
          ]),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      return new Response(JSON.stringify({ detail: "Not found" }), {
        status: 404,
      });
    };

    const result = await resolveOrgAndIssueId({
      issueArg: "@most_frequent",
      cwd: getConfigDir(),
      command: "view",
    });

    expect(result.org).toBe("test-org");
    expect(result.issueId).toBe("444555666");
  });

  test("resolves org/@latest with explicit org prefix", async () => {
    // @ts-expect-error - partial mock
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      const url = req.url;

      if (
        url.includes("/organizations/my-org/issues/") &&
        url.includes("sort=date")
      ) {
        return new Response(
          JSON.stringify([
            {
              id: "777888999",
              shortId: "BACKEND-Z",
              title: "Latest in my-org",
              status: "unresolved",
              platform: "python",
              type: "error",
              count: "3",
              userCount: 1,
            },
          ]),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      return new Response(JSON.stringify({ detail: "Not found" }), {
        status: 404,
      });
    };

    const result = await resolveOrgAndIssueId({
      issueArg: "my-org/@latest",
      cwd: getConfigDir(),
      command: "view",
    });

    expect(result.org).toBe("my-org");
    expect(result.issueId).toBe("777888999");
  });

  test("throws ResolutionError when no unresolved issues found", async () => {
    const { setDefaults } = await import("../../../src/lib/db/defaults.js");
    setDefaults("test-org", undefined);

    // @ts-expect-error - partial mock
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      const url = req.url;

      // Return empty list — no unresolved issues
      if (url.includes("/organizations/test-org/issues/")) {
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ detail: "Not found" }), {
        status: 404,
      });
    };

    const err = await resolveOrgAndIssueId({
      issueArg: "@latest",
      cwd: getConfigDir(),
      command: "view",
    }).catch((e) => e);

    expect(err).toBeInstanceOf(ResolutionError);
    expect(String(err)).toContain("no unresolved issues found");
    expect(String(err)).toContain("most recent");
  });

  test("throws ContextError when org cannot be resolved for bare @selector", async () => {
    // Clear defaults so there's no org context
    const { clearAuth } = await import("../../../src/lib/db/auth.js");
    const { setDefaults } = await import("../../../src/lib/db/defaults.js");
    await clearAuth();
    setDefaults(undefined, undefined);

    await expect(
      resolveOrgAndIssueId({
        issueArg: "@latest",
        cwd: getConfigDir(),
        command: "view",
      })
    ).rejects.toThrow("Organization");
  });
});

describe("resolveIssue: numeric 404 error handling", () => {
  const getResolveIssueConfigDir = useTestConfigDir("test-resolve-issue-", {
    isolateProjectRoot: true,
  });

  let savedFetch: typeof globalThis.fetch;

  beforeEach(async () => {
    savedFetch = globalThis.fetch;
    await setAuthToken("test-token");
    setOrgRegion("my-org", DEFAULT_SENTRY_URL);
  });

  afterEach(() => {
    globalThis.fetch = savedFetch;
  });

  test("numeric 404 throws ResolutionError with ID and short-ID hint", async () => {
    // @ts-expect-error - partial mock
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ detail: "Issue not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });

    const err = await resolveIssue({
      issueArg: "123456789",
      cwd: getResolveIssueConfigDir(),
      command: "view",
    }).catch((e) => e);

    expect(err).toBeInstanceOf(ResolutionError);
    // Message includes the numeric ID
    expect(String(err)).toContain("123456789");
    // Message says "not found", not "is required"
    expect(String(err)).toContain("not found");
    // Suggests the short-ID format
    expect(String(err)).toContain("project>-123456789");
  });

  test("numeric non-404 error propagates unchanged", async () => {
    // @ts-expect-error - partial mock
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ detail: "Internal Server Error" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });

    await expect(
      resolveIssue({
        issueArg: "123456789",
        cwd: getResolveIssueConfigDir(),
        command: "view",
      })
    ).rejects.not.toBeInstanceOf(ResolutionError);
  });

  test("explicit-org-numeric 404 throws ResolutionError with org and ID", async () => {
    // @ts-expect-error - partial mock
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ detail: "Issue not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });

    const err = await resolveIssue({
      issueArg: "my-org/999999999",
      cwd: getResolveIssueConfigDir(),
      command: "view",
    }).catch((e) => e);

    expect(err).toBeInstanceOf(ResolutionError);
    // Message includes the numeric ID
    expect(String(err)).toContain("999999999");
    // Message mentions the org
    expect(String(err)).toContain("my-org");
    // Message says "not found", not "is required"
    expect(String(err)).toContain("not found");
    // Suggests the short-ID format
    expect(String(err)).toContain("project>-999999999");
  });

  test("explicit-org-numeric non-404 error propagates unchanged", async () => {
    // @ts-expect-error - partial mock
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ detail: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });

    await expect(
      resolveIssue({
        issueArg: "my-org/999999999",
        cwd: getResolveIssueConfigDir(),
        command: "view",
      })
    ).rejects.not.toBeInstanceOf(ResolutionError);
  });
});

describe("resolveIssue: project-search DSN shortcut", () => {
  const getDsnTestConfigDir = useTestConfigDir("test-dsn-shortcut-", {
    isolateProjectRoot: true,
  });

  let dsnOriginalFetch: typeof globalThis.fetch;

  beforeEach(async () => {
    dsnOriginalFetch = globalThis.fetch;
    await setAuthToken("test-token");
    setOrgRegion("my-org", DEFAULT_SENTRY_URL);
    // Seed project cache so resolveFromDsn resolves without any API call.
    // orgId is "123" (DSN parser strips the "o" prefix from o123.ingest.*)
    setCachedProject("123", "456", {
      orgSlug: "my-org",
      orgName: "My Org",
      projectSlug: "my-project",
      projectName: "My Project",
      projectId: "456",
    });
  });

  afterEach(() => {
    globalThis.fetch = dsnOriginalFetch;
  });

  test("uses DSN shortcut when project matches, skips listOrganizations", async () => {
    const { writeFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const cwd = getDsnTestConfigDir();

    // Write a DSN so detectDsn finds it
    writeFileSync(
      join(cwd, ".env"),
      "SENTRY_DSN=https://abc@o123.ingest.us.sentry.io/456"
    );

    const requests: string[] = [];

    // @ts-expect-error - partial mock
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      const url = req.url;
      requests.push(url);

      // Short ID resolution — the only HTTP call the shortcut should make
      if (url.includes("/shortids/MY-PROJECT-5BS/")) {
        return new Response(
          JSON.stringify({
            organizationSlug: "my-org",
            projectSlug: "my-project",
            group: {
              id: "999",
              shortId: "MY-PROJECT-5BS",
              title: "Test Issue",
              status: "unresolved",
              platform: "javascript",
              type: "error",
              count: "1",
              userCount: 1,
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      return new Response(JSON.stringify({ detail: "Not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    };

    const result = await resolveIssue({
      issueArg: "my-project-5BS",
      cwd,
      command: "view",
    });

    // Shortcut resolved correctly
    expect(result.org).toBe("my-org");
    expect(result.issue.id).toBe("999");

    // The expensive listOrganizations calls were skipped
    expect(requests.some((r) => r.includes("/users/me/regions/"))).toBe(false);
    expect(
      requests.some(
        (r) => r.includes("/organizations/") && !r.includes("/shortids/")
      )
    ).toBe(false);
  });
});

describe("resolveIssue with share URLs", () => {
  const cwd = "/tmp/test-share";

  test("resolves share URL with org from subdomain", async () => {
    setOrgRegion("gibush-kq", DEFAULT_SENTRY_URL);

    // @ts-expect-error - partial mock
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      const url = req.url;

      // Share API endpoint (public, no auth)
      if (url.includes("/shared/issues/f1abd515c51346778384ff25dfb341e5")) {
        return new Response(JSON.stringify({ groupID: "99124558" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Authenticated issue fetch
      if (url.includes("/organizations/gibush-kq/issues/99124558/")) {
        return new Response(
          JSON.stringify({
            id: "99124558",
            shortId: "BACKEND-A1",
            title: "Share Test Issue",
            status: "unresolved",
            platform: "python",
            type: "error",
            count: "5",
            userCount: 3,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      return new Response(JSON.stringify({ detail: "Not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    };

    const result = await resolveIssue({
      issueArg:
        "https://gibush-kq.sentry.io/share/issue/f1abd515c51346778384ff25dfb341e5/",
      cwd,
      command: "view",
    });

    expect(result.org).toBe("gibush-kq");
    expect(result.issue.id).toBe("99124558");
    expect(result.issue.shortId).toBe("BACKEND-A1");
  });

  test("resolves share URL without org via unscoped fetch", async () => {
    // @ts-expect-error - partial mock
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      const url = req.url;

      // Share API endpoint
      if (url.includes("/shared/issues/aabbccdd11223344aabbccdd11223344")) {
        return new Response(JSON.stringify({ groupID: "55555" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Unscoped issue fetch
      if (url.includes("/issues/55555/")) {
        return new Response(
          JSON.stringify({
            id: "55555",
            shortId: "WEB-B2",
            title: "Unscoped Share Issue",
            status: "unresolved",
            platform: "javascript",
            type: "error",
            count: "1",
            userCount: 1,
            permalink: "https://test-org.sentry.io/issues/55555/",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      return new Response(JSON.stringify({ detail: "Not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    };

    const result = await resolveIssue({
      issueArg:
        "https://sentry.io/share/issue/aabbccdd11223344aabbccdd11223344/",
      cwd,
      command: "view",
    });

    expect(result.issue.id).toBe("55555");
    expect(result.org).toBe("test-org");
  });

  test("throws ApiError when share link is expired/disabled", async () => {
    // @ts-expect-error - partial mock
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ detail: "Not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });

    await expect(
      resolveIssue({
        issueArg:
          "https://sentry.io/share/issue/deadbeefdeadbeefdeadbeefdeadbeef/",
        cwd,
        command: "view",
      })
    ).rejects.toThrow(ApiError);

    try {
      await resolveIssue({
        issueArg:
          "https://sentry.io/share/issue/deadbeefdeadbeefdeadbeefdeadbeef/",
        cwd,
        command: "view",
      });
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).message).toContain("Share link not found");
    }
  });
});
