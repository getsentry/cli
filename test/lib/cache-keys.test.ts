/**
 * Unit tests for `computeInvalidationPrefixes`.
 */

import { describe, expect, test } from "bun:test";
import { computeInvalidationPrefixes } from "../../src/lib/cache-keys.js";

const BASE = "https://us.sentry.io/api/0/";

describe("computeInvalidationPrefixes — hierarchy walk", () => {
  test("detail URL yields self + ancestors down to owner", () => {
    const prefixes = computeInvalidationPrefixes(
      `${BASE}organizations/acme/issues/12345/`
    );
    expect(prefixes).toContain(`${BASE}organizations/acme/issues/12345/`);
    expect(prefixes).toContain(`${BASE}organizations/acme/issues/`);
    expect(prefixes).toContain(`${BASE}organizations/acme/`);
    // The bare `organizations/` root is deliberately NOT swept —
    // it would evict other orgs' caches.
    expect(prefixes).not.toContain(`${BASE}organizations/`);
  });

  test("deeply nested path yields every ancestor down to owner", () => {
    const prefixes = computeInvalidationPrefixes(
      `${BASE}organizations/acme/releases/1.0.0/deploys/`
    );
    expect(prefixes).toContain(
      `${BASE}organizations/acme/releases/1.0.0/deploys/`
    );
    expect(prefixes).toContain(`${BASE}organizations/acme/releases/1.0.0/`);
    expect(prefixes).toContain(`${BASE}organizations/acme/releases/`);
    expect(prefixes).toContain(`${BASE}organizations/acme/`);
    // Stop at the owner level, don't sweep bare `organizations/`.
    expect(prefixes).not.toContain(`${BASE}organizations/`);
  });

  test("single-segment path yields only the segment itself", () => {
    const prefixes = computeInvalidationPrefixes(`${BASE}organizations/`);
    expect(prefixes).toEqual([`${BASE}organizations/`]);
  });

  test("two-segment path walks to the top (owner-level mutation)", () => {
    // The floor only kicks in at length > 2.
    const prefixes = computeInvalidationPrefixes(`${BASE}organizations/acme/`);
    expect(prefixes).toContain(`${BASE}organizations/acme/`);
    expect(prefixes).toContain(`${BASE}organizations/`);
  });

  test("query string is stripped from the prefix set", () => {
    const prefixes = computeInvalidationPrefixes(
      `${BASE}organizations/acme/issues/12345/?collapse=stats&collapse=lifetime`
    );
    expect(prefixes).toContain(`${BASE}organizations/acme/issues/12345/`);
    expect(
      prefixes.every((p) => !(p.includes("collapse=") || p.includes("?")))
    ).toBe(true);
  });

  test("trailing-slashless URL still works", () => {
    const prefixes = computeInvalidationPrefixes(
      `${BASE}organizations/acme/issues`
    );
    expect(prefixes).toContain(`${BASE}organizations/acme/issues/`);
    expect(prefixes).toContain(`${BASE}organizations/acme/`);
  });
});

describe("computeInvalidationPrefixes — cross-endpoint rules", () => {
  test("POST /teams/{org}/{team}/projects/ invalidates org project list", () => {
    const prefixes = computeInvalidationPrefixes(
      `${BASE}teams/acme/backend/projects/`
    );
    expect(prefixes).toContain(`${BASE}organizations/acme/projects/`);
    expect(prefixes).toContain(`${BASE}teams/acme/backend/projects/`);
    expect(prefixes).toContain(`${BASE}teams/acme/backend/`);
    expect(prefixes).toContain(`${BASE}teams/acme/`);
    expect(prefixes).not.toContain(`${BASE}teams/`);
  });

  test("DELETE /projects/{org}/{project}/ invalidates org project list", () => {
    const prefixes = computeInvalidationPrefixes(
      `${BASE}projects/acme/frontend/`
    );
    expect(prefixes).toContain(`${BASE}organizations/acme/projects/`);
    expect(prefixes).toContain(`${BASE}projects/acme/frontend/`);
    expect(prefixes).toContain(`${BASE}projects/acme/`);
    expect(prefixes).not.toContain(`${BASE}projects/`);
  });

  test("unrelated paths get no cross-endpoint sweep", () => {
    const prefixes = computeInvalidationPrefixes(
      `${BASE}organizations/acme/teams/`
    );
    expect(prefixes).not.toContain(`${BASE}organizations/acme/projects/`);
    expect(prefixes).toContain(`${BASE}organizations/acme/teams/`);
  });
});

describe("computeInvalidationPrefixes — edge cases", () => {
  test("returns [] for URLs not under /api/0/", () => {
    expect(
      computeInvalidationPrefixes("https://example.com/some/path/")
    ).toEqual([]);
    expect(
      computeInvalidationPrefixes("https://uploads.sentry.io/x/y")
    ).toEqual([]);
  });

  test("returns [] for unparseable URLs", () => {
    expect(computeInvalidationPrefixes("not-a-url")).toEqual([]);
    expect(computeInvalidationPrefixes("")).toEqual([]);
  });

  test("returns [] when the mutation hits /api/0/ root itself", () => {
    expect(computeInvalidationPrefixes(BASE)).toEqual([]);
  });

  test("deduplicates prefixes across hierarchy + rule-table", () => {
    const prefixes = computeInvalidationPrefixes(
      `${BASE}teams/acme/backend/projects/`
    );
    expect(prefixes.length).toBe(new Set(prefixes).size);
  });

  test("self-hosted base URLs are preserved", () => {
    const prefixes = computeInvalidationPrefixes(
      "https://sentry.example.com/api/0/organizations/acme/issues/12345/"
    );
    expect(prefixes).toContain(
      "https://sentry.example.com/api/0/organizations/acme/issues/12345/"
    );
    expect(prefixes).toContain(
      "https://sentry.example.com/api/0/organizations/acme/"
    );
  });
});
