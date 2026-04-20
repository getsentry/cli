/**
 * Tests for `extractRequiredScopes` — the 403-response scope parser
 * that powers the friendly "missing scope: event:read" hint in place
 * of the hardcoded "(org:read, project:read)" fallback.
 */

import { describe, expect, test } from "bun:test";
import { extractRequiredScopes } from "../../src/lib/api-scope.js";

describe("extractRequiredScopes", () => {
  test("returns [] for undefined or null detail", () => {
    expect(extractRequiredScopes(undefined)).toEqual([]);
    expect(extractRequiredScopes(null)).toEqual([]);
  });

  test("returns [] when the detail contains no recognizable scopes", () => {
    expect(
      extractRequiredScopes(
        "You do not have permission to perform this action."
      )
    ).toEqual([]);
  });

  test("extracts a single scope from a detail string", () => {
    expect(
      extractRequiredScopes(
        "You do not have the required scope to perform this action. Required scopes: event:read"
      )
    ).toEqual(["event:read"]);
  });

  test("extracts multiple scopes from a detail string preserving order", () => {
    expect(
      extractRequiredScopes(
        "Required scopes: event:read, project:write. Got: none."
      )
    ).toEqual(["event:read", "project:write"]);
  });

  test("deduplicates repeated scopes", () => {
    expect(
      extractRequiredScopes(
        "event:read is required. Try obtaining event:read scope."
      )
    ).toEqual(["event:read"]);
  });

  test("ignores random foo:bar substrings that aren't real scopes", () => {
    // The regex is anchored to the known resource namespace so that
    // response text mentioning things like `http:localhost` or
    // `timestamp:now` doesn't accidentally match.
    expect(
      extractRequiredScopes("http:localhost timestamp:now category:billing")
    ).toEqual([]);
  });

  test("lowercases the matched scope identifier", () => {
    expect(extractRequiredScopes("Required: EVENT:READ")).toEqual([
      "event:read",
    ]);
  });

  test("pulls scopes from a structured `required` field", () => {
    expect(
      extractRequiredScopes({
        detail: "You do not have permission to perform this action.",
        required: ["event:read"],
      })
    ).toEqual(["event:read"]);
  });

  test("pulls scopes from a structured `requiredScopes` field", () => {
    expect(
      extractRequiredScopes({
        detail: "Missing scopes.",
        requiredScopes: ["project:admin", "team:write"],
      })
    ).toEqual(["project:admin", "team:write"]);
  });

  test("pulls scopes from a `scopes` field of {scope} objects", () => {
    expect(
      extractRequiredScopes({
        detail: "Missing scopes.",
        scopes: [{ scope: "org:read" }, { scope: "org:write" }],
      })
    ).toEqual(["org:read", "org:write"]);
  });

  test("falls back to text scanning when the structured fields are absent", () => {
    // An object without the known field names gets serialized and
    // scanned — catches responses that carry scope info under a
    // non-standard key.
    expect(
      extractRequiredScopes({
        message: "Your token lacks project:read.",
      })
    ).toEqual(["project:read"]);
  });

  test("ignores non-string entries in the required array", () => {
    expect(
      extractRequiredScopes({
        required: [42, null, "event:read", { unrelated: true }],
      })
    ).toEqual(["event:read"]);
  });

  test("supports all CLI OAuth namespaces", () => {
    // Round-trip check that the namespaces the OAuth flow requests
    // (plus `alerts` / `member`) all pass the regex.
    const allScopes = [
      "org:read",
      "org:write",
      "org:admin",
      "project:read",
      "project:write",
      "project:admin",
      "team:read",
      "team:write",
      "team:admin",
      "member:read",
      "member:write",
      "member:admin",
      "event:read",
      "event:write",
      "event:admin",
      "release:read",
      "release:write",
      "release:admin",
      "alerts:read",
      "alerts:write",
    ];
    expect(
      extractRequiredScopes(`Required scopes: ${allScopes.join(", ")}`)
    ).toEqual(allScopes);
  });
});
