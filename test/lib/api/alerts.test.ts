import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  deleteIssueAlertRule,
  deleteMetricAlertRule,
  getIssueAlertRule,
  listIssueAlertsPaginated,
} from "../../../src/lib/api/alerts.js";
import { DEFAULT_SENTRY_URL } from "../../../src/lib/constants.js";
import { setAuthToken } from "../../../src/lib/db/auth.js";
import { setOrgRegion } from "../../../src/lib/db/regions.js";
import { resetAuthenticatedFetch } from "../../../src/lib/sentry-client.js";
import { mockFetch, useTestConfigDir } from "../../helpers.js";

useTestConfigDir("api-alerts-");

let originalFetch: typeof globalThis.fetch;

beforeEach(async () => {
  originalFetch = globalThis.fetch;
  resetAuthenticatedFetch();
  await setAuthToken("test-token");
  setOrgRegion("test-org", DEFAULT_SENTRY_URL);
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  resetAuthenticatedFetch();
});

describe("deleteIssueAlertRule", () => {
  test("treats empty-body 204 as success", async () => {
    globalThis.fetch = mockFetch(async (input, init) => {
      const req = new Request(input!, init);
      expect(req.method).toBe("DELETE");
      expect(req.url).toBe(
        `${DEFAULT_SENTRY_URL}/api/0/projects/test-org/test-project/rules/42/`
      );
      expect(req.headers.get("Authorization")).toBe("Bearer test-token");
      return new Response(null, { status: 204 });
    });

    await expect(
      deleteIssueAlertRule("test-org", "test-project", "42")
    ).resolves.toBeUndefined();
  });
});

/** Minimal workflow/rule payload from the org-scoped `/workflows/` endpoint. */
function workflowRule(overrides: Record<string, unknown>) {
  return {
    id: "1",
    name: "Rule",
    status: "active",
    actionMatch: "any",
    conditions: [],
    actions: [],
    frequency: 30,
    environment: null,
    owner: null,
    projects: [],
    detectorIds: [7],
    dateCreated: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("listIssueAlertsPaginated", () => {
  test("reads from org-scoped /workflows/ and drops unattached workflows", async () => {
    globalThis.fetch = mockFetch(async (input, init) => {
      const url = new URL(new Request(input!, init).url);
      expect(url.pathname).toBe("/api/0/organizations/test-org/workflows/");
      expect(url.searchParams.get("projectSlug")).toBe("test-project");
      return Response.json([
        workflowRule({ id: "1", name: "Attached", detectorIds: [7] }),
        workflowRule({ id: "2", name: "Unattached", detectorIds: [] }),
      ]);
    });

    const { data } = await listIssueAlertsPaginated("test-org", "test-project");
    expect(data).toHaveLength(1);
    expect(data[0]?.id).toBe("1");
  });
});

describe("getIssueAlertRule", () => {
  test("reads from /workflows/ filtered by project and id", async () => {
    globalThis.fetch = mockFetch(async (input, init) => {
      const url = new URL(new Request(input!, init).url);
      expect(url.pathname).toBe("/api/0/organizations/test-org/workflows/");
      expect(url.searchParams.get("projectSlug")).toBe("test-project");
      expect(url.searchParams.get("id")).toBe("42");
      return Response.json([workflowRule({ id: "42", name: "My Rule" })]);
    });

    const rule = await getIssueAlertRule("test-org", "test-project", "42");
    expect(rule.id).toBe("42");
    expect(rule.name).toBe("My Rule");
  });

  test("throws 404 ApiError when no attached rule matches", async () => {
    globalThis.fetch = mockFetch(async () =>
      // Only an unattached workflow comes back → filtered out → not found.
      Response.json([workflowRule({ id: "42", detectorIds: [] })])
    );

    await expect(
      getIssueAlertRule("test-org", "test-project", "42")
    ).rejects.toMatchObject({ name: "ApiError", status: 404 });
  });
});

describe("deleteMetricAlertRule", () => {
  test("treats empty-body 202 as success", async () => {
    globalThis.fetch = mockFetch(async (input, init) => {
      const req = new Request(input!, init);
      expect(req.method).toBe("DELETE");
      expect(req.url).toBe(
        `${DEFAULT_SENTRY_URL}/api/0/organizations/test-org/alert-rules/9/`
      );
      expect(req.headers.get("Authorization")).toBe("Bearer test-token");
      return new Response(null, { status: 202 });
    });

    await expect(
      deleteMetricAlertRule("test-org", "9")
    ).resolves.toBeUndefined();
  });
});
