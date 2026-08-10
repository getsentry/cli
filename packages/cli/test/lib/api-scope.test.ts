/**
 * Tests for `extractRequiredScopes` — the 403-response scope parser
 * that powers the friendly "missing scope: event:read" hint in place
 * of the hardcoded "(org:read, project:read)" fallback.
 */

import { describe, expect, test } from "vitest";
import {
  extractRequiredScopes,
  extractRequiredScopesFromWwwAuthenticate,
} from "../../src/lib/api-scope.js";

describe("extractRequiredScopesFromWwwAuthenticate", () => {
  test("extracts scopes from an RFC 6750 insufficient-scope challenge", () => {
    expect(
      extractRequiredScopesFromWwwAuthenticate(
        'Bearer error="insufficient_scope", scope="team:admin project:write"'
      )
    ).toEqual(["team:admin", "project:write"]);
  });

  test("accepts a future scope because the server challenge is authoritative", () => {
    expect(
      extractRequiredScopesFromWwwAuthenticate(
        'Bearer error="insufficient_scope", scope="project:new-capability"'
      )
    ).toEqual(["project:new-capability"]);
  });

  test("ignores unrelated or incomplete authentication challenges", () => {
    expect(
      extractRequiredScopesFromWwwAuthenticate(
        'Bearer error="invalid_token", scope="team:admin"'
      )
    ).toEqual([]);
    expect(
      extractRequiredScopesFromWwwAuthenticate(
        'Basic realm="sentry", error="insufficient_scope", scope="team:admin"'
      )
    ).toEqual([]);
    expect(
      extractRequiredScopesFromWwwAuthenticate(
        'Bearer error="insufficient_scope"'
      )
    ).toEqual([]);
  });

  test("deduplicates scopes while preserving server order", () => {
    expect(
      extractRequiredScopesFromWwwAuthenticate(
        'Bearer scope="team:admin team:admin org:read", error=insufficient_scope'
      )
    ).toEqual(["team:admin", "org:read"]);
  });

  test.each([
    [
      'Basic realm="legacy", Bearer error="insufficient_scope", scope="team:admin"',
    ],
    [
      'Bearer error="insufficient_scope", scope="team:admin", Basic realm="legacy"',
    ],
  ])("isolates Bearer parameters in combined challenges", (header) => {
    expect(extractRequiredScopesFromWwwAuthenticate(header)).toEqual([
      "team:admin",
    ]);
  });

  test("does not borrow a scope from a later authentication challenge", () => {
    expect(
      extractRequiredScopesFromWwwAuthenticate(
        'Bearer error="insufficient_scope", Custom scope="team:admin"'
      )
    ).toEqual([]);
  });

  test("ignores challenge-like text inside a quoted parameter", () => {
    expect(
      extractRequiredScopesFromWwwAuthenticate(
        'Basic realm="legacy, Bearer bogus", Bearer error="insufficient_scope", scope="project:new-capability"'
      )
    ).toEqual(["project:new-capability"]);
  });
});

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

  test("ignores role scopes mentioned in member-project policy guidance", () => {
    expect(
      extractRequiredScopes(
        "Your organization has disabled this feature for members. " +
          "This is an org-level policy setting, not an auth issue. " +
          "You need org:admin/manager/owner role, or team:admin role on the team."
      )
    ).toEqual([]);
  });

  test("ignores a role requirement that merely names a scope", () => {
    expect(
      extractRequiredScopes("This action requires the team:admin role.")
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

  test("matches every scope in the canonical Sentry SENTRY_SCOPES list", () => {
    // Canonical list mirrored from getsentry/sentry
    // `src/sentry/conf/server.py` SENTRY_SCOPES. Keeping this test here
    // makes it easy to spot when the backend adds or removes a scope.
    const allScopes = [
      "org:read",
      "org:write",
      "org:admin",
      "org:integrations",
      "org:ci",
      "member:invite",
      "member:read",
      "member:write",
      "member:admin",
      "team:read",
      "team:write",
      "team:admin",
      "project:read",
      "project:write",
      "project:admin",
      "project:releases",
      "project:distribution",
      "event:read",
      "event:write",
      "event:admin",
      "alerts:read",
      "alerts:write",
    ];
    expect(
      extractRequiredScopes(`Required scopes: ${allScopes.join(", ")}`)
    ).toEqual(allScopes);
  });

  test("rejects scope-shaped strings that are not real Sentry scopes", () => {
    // Catches regressions where the regex accidentally widens to
    // `<ns>:<action>` products that Sentry doesn't actually define —
    // e.g. `release:read` (no `release` namespace; the real scope is
    // `project:releases`) or `alerts:admin` (no admin tier).
    expect(
      extractRequiredScopes(
        "Not real: release:read release:write alerts:admin team:superuser"
      )
    ).toEqual([]);
  });
});
