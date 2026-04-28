/**
 * Tests for the discover/explore API helper.
 *
 * Verifies URL construction, query parameter encoding (especially repeated
 * `field` params), schema validation, and pagination cursor extraction.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { queryEvents } from "../../../src/lib/api/discover.js";
import { mockFetch, useTestConfigDir } from "../../helpers.js";

describe("queryEvents", () => {
  useTestConfigDir("discover-test-");

  let originalFetch: typeof globalThis.fetch;
  let capturedUrl = "";
  let capturedMethod = "";

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    capturedUrl = "";
    capturedMethod = "";
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function mockOk(body: unknown, headers: Record<string, string> = {}) {
    globalThis.fetch = mockFetch(async (input, init) => {
      const req = new Request(input!, init);
      capturedUrl = req.url;
      capturedMethod = req.method;
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json", ...headers },
      });
    });
  }

  test("hits /organizations/{org}/events/ with GET", async () => {
    mockOk({ data: [], meta: { fields: {} } });

    await queryEvents("my-org", { fields: ["title", "count()"] });

    expect(capturedMethod).toBe("GET");
    expect(capturedUrl).toContain("/api/0/organizations/my-org/events/");
  });

  test("encodes fields as repeated query params (field=a&field=b)", async () => {
    mockOk({ data: [], meta: { fields: {} } });

    await queryEvents("my-org", {
      fields: ["title", "count()", "count_unique(user)"],
    });

    // Each field appears as its own query param (not joined with comma).
    // URLSearchParams encodes parens as %28/%29 — assert against decoded URL.
    const decoded = decodeURIComponent(capturedUrl);
    expect(decoded).toContain("field=title");
    expect(decoded).toContain("field=count()");
    expect(decoded).toContain("field=count_unique(user)");
    // Verify we got 3 separate field= params, not 1 with commas
    expect(capturedUrl.match(/field=/g)?.length).toBe(3);
  });

  test("defaults dataset to errors when not provided", async () => {
    mockOk({ data: [], meta: { fields: {} } });

    await queryEvents("my-org", { fields: ["title"] });

    expect(capturedUrl).toContain("dataset=errors");
  });

  test("passes explicit dataset", async () => {
    mockOk({ data: [], meta: { fields: {} } });

    await queryEvents("my-org", {
      fields: ["span.op"],
      dataset: "spans",
    });

    expect(capturedUrl).toContain("dataset=spans");
  });

  test("omits empty query (does not send query=&)", async () => {
    mockOk({ data: [], meta: { fields: {} } });

    await queryEvents("my-org", { fields: ["title"], query: "" });

    expect(capturedUrl).not.toContain("query=");
  });

  test("passes non-empty query", async () => {
    mockOk({ data: [], meta: { fields: {} } });

    await queryEvents("my-org", {
      fields: ["title"],
      query: "is:unresolved",
    });

    expect(capturedUrl).toContain(
      `query=${encodeURIComponent("is:unresolved")}`
    );
  });

  test("omits sort when not provided", async () => {
    mockOk({ data: [], meta: { fields: {} } });

    await queryEvents("my-org", { fields: ["title"] });

    expect(capturedUrl).not.toContain("sort=");
  });

  test("passes sort when provided", async () => {
    mockOk({ data: [], meta: { fields: {} } });

    await queryEvents("my-org", {
      fields: ["span.op"],
      dataset: "spans",
      sort: "-count()",
    });

    // URLSearchParams encodes ( and ) but leaves - and most chars alone
    expect(decodeURIComponent(capturedUrl)).toContain("sort=-count()");
  });

  test("uses statsPeriod when no absolute range provided", async () => {
    mockOk({ data: [], meta: { fields: {} } });

    await queryEvents("my-org", {
      fields: ["title"],
      statsPeriod: "1h",
    });

    expect(capturedUrl).toContain("statsPeriod=1h");
    expect(capturedUrl).not.toContain("start=");
    expect(capturedUrl).not.toContain("end=");
  });

  test("uses absolute start/end and skips statsPeriod fallback", async () => {
    mockOk({ data: [], meta: { fields: {} } });

    await queryEvents("my-org", {
      fields: ["title"],
      start: "2024-01-15T00:00:00Z",
      end: "2024-01-16T00:00:00Z",
      // statsPeriod also passed but should be ignored
      statsPeriod: "7d",
    });

    expect(capturedUrl).toContain(
      `start=${encodeURIComponent("2024-01-15T00:00:00Z")}`
    );
    expect(capturedUrl).toContain(
      `end=${encodeURIComponent("2024-01-16T00:00:00Z")}`
    );
    expect(capturedUrl).not.toContain("statsPeriod=");
  });

  test("passes per_page from limit", async () => {
    mockOk({ data: [], meta: { fields: {} } });

    await queryEvents("my-org", { fields: ["title"], limit: 50 });

    expect(capturedUrl).toContain("per_page=50");
  });

  test("passes cursor when provided", async () => {
    mockOk({ data: [], meta: { fields: {} } });

    await queryEvents("my-org", {
      fields: ["title"],
      cursor: "0:50:0",
    });

    expect(capturedUrl).toContain(`cursor=${encodeURIComponent("0:50:0")}`);
  });

  test("returns parsed data and extracts nextCursor from Link header", async () => {
    const cursor = "0:50:0";
    mockOk(
      {
        data: [{ title: "Error A", "count()": 100 }],
        meta: {
          fields: { title: "string", "count()": "integer" },
          units: {},
        },
      },
      {
        Link: `<https://us.sentry.io/api/0/next/>; rel="next"; results="true"; cursor="${cursor}"`,
      }
    );

    const result = await queryEvents("my-org", {
      fields: ["title", "count()"],
    });

    expect(result.data.data).toHaveLength(1);
    expect(result.data.meta?.fields).toEqual({
      title: "string",
      "count()": "integer",
    });
    expect(result.nextCursor).toBe(cursor);
  });

  test("returns undefined nextCursor when results=false in Link header", async () => {
    mockOk(
      {
        data: [],
        meta: { fields: {} },
      },
      {
        Link: `<https://us.sentry.io/api/0/next/>; rel="next"; results="false"; cursor=""`,
      }
    );

    const result = await queryEvents("my-org", { fields: ["title"] });

    expect(result.nextCursor).toBeUndefined();
  });
});
