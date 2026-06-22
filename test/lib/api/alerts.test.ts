import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  deleteIssueAlertRule,
  deleteMetricAlertRule,
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
