/**
 * Seer Trial API Client Tests
 *
 * Tests for getSeerTrialStatus and startSeerTrial by mocking fetch.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
  getSeerTrialStatus,
  startSeerTrial,
} from "../../src/lib/api-client.js";
import { setAuthToken } from "../../src/lib/db/auth.js";
import { CONFIG_DIR_ENV_VAR } from "../../src/lib/db/index.js";
import { setOrgRegion } from "../../src/lib/db/regions.js";
import { cleanupTestDir, createTestConfigDir, mockFetch } from "../helpers.js";

let testConfigDir: string;
let originalFetch: typeof globalThis.fetch;

beforeEach(async () => {
  testConfigDir = await createTestConfigDir("test-seer-trial-api-");
  process.env[CONFIG_DIR_ENV_VAR] = testConfigDir;

  originalFetch = globalThis.fetch;

  await setAuthToken("test-token");
  await setOrgRegion("test-org", "https://sentry.io");
});

afterEach(async () => {
  globalThis.fetch = originalFetch;
  await cleanupTestDir(testConfigDir);
});

describe("getSeerTrialStatus", () => {
  test("returns unstarted seerUsers trial when available", async () => {
    globalThis.fetch = mockFetch(
      async () =>
        new Response(
          JSON.stringify({
            productTrials: [
              {
                category: "seerUsers",
                startDate: null,
                endDate: null,
                reasonCode: 0,
                isStarted: false,
                lengthDays: 14,
              },
            ],
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        )
    );

    const trial = await getSeerTrialStatus("test-org");

    expect(trial).not.toBeNull();
    expect(trial?.category).toBe("seerUsers");
    expect(trial?.isStarted).toBe(false);
    expect(trial?.lengthDays).toBe(14);
  });

  test("prefers seerUsers over seerAutofix when both available", async () => {
    globalThis.fetch = mockFetch(
      async () =>
        new Response(
          JSON.stringify({
            productTrials: [
              {
                category: "seerAutofix",
                startDate: null,
                endDate: null,
                reasonCode: 0,
                isStarted: false,
                lengthDays: 14,
              },
              {
                category: "seerUsers",
                startDate: null,
                endDate: null,
                reasonCode: 0,
                isStarted: false,
                lengthDays: 14,
              },
            ],
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        )
    );

    const trial = await getSeerTrialStatus("test-org");

    expect(trial).not.toBeNull();
    expect(trial?.category).toBe("seerUsers");
  });

  test("falls back to seerAutofix when seerUsers is not available", async () => {
    globalThis.fetch = mockFetch(
      async () =>
        new Response(
          JSON.stringify({
            productTrials: [
              {
                category: "seerAutofix",
                startDate: null,
                endDate: null,
                reasonCode: 0,
                isStarted: false,
                lengthDays: 14,
              },
            ],
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        )
    );

    const trial = await getSeerTrialStatus("test-org");

    expect(trial).not.toBeNull();
    expect(trial?.category).toBe("seerAutofix");
  });

  test("returns null when no trials exist", async () => {
    globalThis.fetch = mockFetch(
      async () =>
        new Response(JSON.stringify({}), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
    );

    const trial = await getSeerTrialStatus("test-org");

    expect(trial).toBeNull();
  });

  test("returns null when trial is already started", async () => {
    globalThis.fetch = mockFetch(
      async () =>
        new Response(
          JSON.stringify({
            productTrials: [
              {
                category: "seerUsers",
                startDate: "2025-01-01",
                endDate: "2025-01-15",
                reasonCode: 0,
                isStarted: true,
                lengthDays: 14,
              },
            ],
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        )
    );

    const trial = await getSeerTrialStatus("test-org");

    expect(trial).toBeNull();
  });

  test("returns null when only non-seer trials exist", async () => {
    globalThis.fetch = mockFetch(
      async () =>
        new Response(
          JSON.stringify({
            productTrials: [
              {
                category: "replays",
                startDate: null,
                endDate: null,
                reasonCode: 0,
                isStarted: false,
                lengthDays: 14,
              },
            ],
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        )
    );

    const trial = await getSeerTrialStatus("test-org");

    expect(trial).toBeNull();
  });

  test("sends GET request to customer endpoint", async () => {
    let capturedRequest: Request | undefined;

    globalThis.fetch = mockFetch(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        capturedRequest = new Request(input, init);
        return new Response(JSON.stringify({}), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
    );

    await getSeerTrialStatus("test-org");

    expect(capturedRequest?.method).toBe("GET");
    expect(capturedRequest?.url).toContain("/customers/test-org/");
  });

  test("throws ApiError on non-200 response", async () => {
    globalThis.fetch = mockFetch(
      async () =>
        new Response(JSON.stringify({ detail: "Not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        })
    );

    await expect(getSeerTrialStatus("test-org")).rejects.toThrow();
  });
});

describe("startSeerTrial", () => {
  test("sends PUT request with correct body for seerUsers", async () => {
    let capturedBody: unknown;

    globalThis.fetch = mockFetch(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        capturedBody = JSON.parse(init?.body as string);
        return new Response(JSON.stringify({}), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
    );

    await startSeerTrial("test-org", "seerUsers");

    expect(capturedBody).toEqual({
      referrer: "sentry-cli",
      productTrial: { category: "seerUsers", reasonCode: 0 },
    });
  });

  test("sends PUT request with seerAutofix category", async () => {
    let capturedBody: unknown;

    globalThis.fetch = mockFetch(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        capturedBody = JSON.parse(init?.body as string);
        return new Response(JSON.stringify({}), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
    );

    await startSeerTrial("test-org", "seerAutofix");

    expect(capturedBody).toEqual({
      referrer: "sentry-cli",
      productTrial: { category: "seerAutofix", reasonCode: 0 },
    });
  });

  test("sends PUT to product-trial endpoint", async () => {
    let capturedUrl: string | undefined;
    let capturedMethod: string | undefined;

    globalThis.fetch = mockFetch(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        capturedUrl = input.toString();
        capturedMethod = init?.method ?? "GET";
        return new Response(JSON.stringify({}), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
    );

    await startSeerTrial("test-org", "seerUsers");

    expect(capturedMethod).toBe("PUT");
    expect(capturedUrl).toContain("/customers/test-org/product-trial/");
  });

  test("throws ApiError on non-200 response", async () => {
    globalThis.fetch = mockFetch(
      async () =>
        new Response(JSON.stringify({ detail: "Forbidden" }), {
          status: 403,
          headers: { "Content-Type": "application/json" },
        })
    );

    await expect(startSeerTrial("test-org", "seerUsers")).rejects.toThrow();
  });
});
