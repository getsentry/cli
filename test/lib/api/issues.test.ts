/**
 * Tests for issue API helpers: parseResolveSpec + mergeIssues.
 *
 * Other issue API functions (list/get/update) are covered by
 * test/lib/api-client.coverage.test.ts.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  mergeIssues,
  parseResolveSpec,
  RESOLVE_NEXT_RELEASE_SENTINEL,
} from "../../../src/lib/api-client.js";
import { ApiError, ValidationError } from "../../../src/lib/errors.js";
import { mockFetch } from "../../helpers.js";

describe("parseResolveSpec", () => {
  test("returns null for undefined", () => {
    expect(parseResolveSpec(undefined)).toBeNull();
  });

  test("returns null for empty string", () => {
    expect(parseResolveSpec("")).toBeNull();
  });

  test("returns null for whitespace-only string", () => {
    expect(parseResolveSpec("   ")).toBeNull();
  });

  test("parses @next sentinel as inNextRelease", () => {
    expect(parseResolveSpec(RESOLVE_NEXT_RELEASE_SENTINEL)).toEqual({
      inNextRelease: true,
    });
  });

  test("treats any other value as inRelease", () => {
    expect(parseResolveSpec("0.26.1")).toEqual({ inRelease: "0.26.1" });
    expect(parseResolveSpec("v2.3.0")).toEqual({ inRelease: "v2.3.0" });
    expect(parseResolveSpec("my-release-tag")).toEqual({
      inRelease: "my-release-tag",
    });
  });

  test("trims surrounding whitespace from the version", () => {
    expect(parseResolveSpec("  0.26.1  ")).toEqual({ inRelease: "0.26.1" });
  });
});

describe("mergeIssues", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("rejects fewer than 2 group IDs", async () => {
    await expect(mergeIssues("test-org", ["1"])).rejects.toThrow(
      ValidationError
    );
    await expect(mergeIssues("test-org", [])).rejects.toThrow(ValidationError);
  });

  test("sends PUT to org bulk-mutate endpoint with id= params and merge body", async () => {
    let capturedUrl = "";
    let capturedMethod = "";
    let capturedBody: unknown;

    globalThis.fetch = mockFetch(async (input, init) => {
      const req = new Request(input!, init);
      capturedUrl = req.url;
      capturedMethod = req.method;
      capturedBody = await req.json();
      return new Response(
        JSON.stringify({
          merge: { parent: "100", children: ["200", "300"] },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    });

    const result = await mergeIssues("test-org", ["100", "200", "300"]);

    expect(capturedMethod).toBe("PUT");
    expect(capturedUrl).toContain("/api/0/organizations/test-org/issues/");
    // All three IDs present as repeated query params
    expect(capturedUrl).toContain("id=100");
    expect(capturedUrl).toContain("id=200");
    expect(capturedUrl).toContain("id=300");
    expect(capturedBody).toEqual({ merge: 1 });
    expect(result).toEqual({ parent: "100", children: ["200", "300"] });
  });

  test("propagates API errors (e.g. 'Only error issues can be merged')", async () => {
    globalThis.fetch = mockFetch(
      async () =>
        new Response(JSON.stringify(["Only error issues can be merged."]), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        })
    );

    await expect(
      mergeIssues("test-org", ["100", "200"])
    ).rejects.toBeInstanceOf(ApiError);
  });

  test("handles 204 No Content (no matching issues) gracefully", async () => {
    // Sentry's bulk mutate returns 204 when IDs are out of scope or the
    // matched set is empty — without a body. Previously this crashed with
    // SyntaxError in response.json().
    globalThis.fetch = mockFetch(
      async () =>
        new Response(null, {
          status: 204,
        })
    );

    await expect(
      mergeIssues("test-org", ["100", "200"])
    ).rejects.toBeInstanceOf(ApiError);
    await expect(mergeIssues("test-org", ["100", "200"])).rejects.toThrow(
      /no matching issues|out of scope/i
    );
  });
});
