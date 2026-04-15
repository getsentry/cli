/**
 * Search Query Sanitization Tests
 *
 * Tests for `sanitizeQuery` and its OR→in-list rewriting logic
 * in `src/lib/search-query.ts`.
 *
 * Core invariants (round-trips, random inputs) are tested via
 * property-based tests in `search-query.property.test.ts`.
 * These tests focus on specific rewrite cases, edge cases,
 * and error messages.
 */

import { describe, expect, test } from "bun:test";
import { ValidationError } from "../../src/lib/errors.js";
import { sanitizeQuery } from "../../src/lib/search-query.js";

// ---------------------------------------------------------------------------
// Passthrough (no operators)
// ---------------------------------------------------------------------------

describe("sanitizeQuery: passthrough", () => {
  test("passes through a simple qualifier query unchanged", () => {
    expect(sanitizeQuery("is:unresolved level:error")).toBe(
      "is:unresolved level:error"
    );
  });

  test("passes through a plain text query unchanged", () => {
    expect(sanitizeQuery("timeout crash")).toBe("timeout crash");
  });

  test("does not match 'and'/'or' as substrings of normal words", () => {
    expect(sanitizeQuery("sandbox handler")).toBe("sandbox handler");
    expect(sanitizeQuery("order error")).toBe("order error");
  });

  test("does not match OR inside qualifier values (tag:OR)", () => {
    expect(sanitizeQuery("tag:OR")).toBe("tag:OR");
  });

  test("does not match AND inside qualifier values (tag:AND)", () => {
    expect(sanitizeQuery("tag:AND")).toBe("tag:AND");
  });

  test("does not match OR inside quoted strings", () => {
    expect(sanitizeQuery('message:"error OR timeout"')).toBe(
      'message:"error OR timeout"'
    );
  });

  test("does not match AND inside quoted strings", () => {
    expect(sanitizeQuery('title:"error AND timeout"')).toBe(
      'title:"error AND timeout"'
    );
  });

  test("does not match OR in qualifier values with more context", () => {
    expect(sanitizeQuery("is:unresolved tag:OR_something")).toBe(
      "is:unresolved tag:OR_something"
    );
  });
});

// ---------------------------------------------------------------------------
// AND stripping
// ---------------------------------------------------------------------------

describe("sanitizeQuery: AND", () => {
  test("strips AND and returns cleaned query", () => {
    expect(sanitizeQuery("error AND timeout")).toBe("error timeout");
  });

  test("strips multiple AND operators", () => {
    expect(sanitizeQuery("error AND timeout AND crash")).toBe(
      "error timeout crash"
    );
  });

  test("handles case-insensitive AND", () => {
    expect(sanitizeQuery("error And timeout")).toBe("error timeout");
    expect(sanitizeQuery("error and timeout")).toBe("error timeout");
  });

  test("strips AND with qualifiers", () => {
    expect(sanitizeQuery("is:unresolved AND level:error")).toBe(
      "is:unresolved level:error"
    );
  });

  test("handles leading AND", () => {
    expect(sanitizeQuery("AND error timeout")).toBe("error timeout");
  });

  test("handles trailing AND", () => {
    expect(sanitizeQuery("error timeout AND")).toBe("error timeout");
  });
});

// ---------------------------------------------------------------------------
// OR → in-list rewrites (successful)
// ---------------------------------------------------------------------------

describe("sanitizeQuery: OR → in-list (success)", () => {
  test("rewrites same-key qualifier OR to in-list", () => {
    expect(sanitizeQuery("level:error OR level:warning")).toBe(
      "level:[error,warning]"
    );
  });

  test("rewrites OR chain of 3+ same-key qualifiers", () => {
    expect(sanitizeQuery("level:error OR level:warning OR level:fatal")).toBe(
      "level:[error,warning,fatal]"
    );
  });

  test("preserves surrounding tokens", () => {
    expect(sanitizeQuery("is:unresolved level:error OR level:warning")).toBe(
      "is:unresolved level:[error,warning]"
    );
  });

  test("preserves surrounding tokens on both sides", () => {
    expect(
      sanitizeQuery("is:unresolved level:error OR level:warning firstSeen:-24h")
    ).toBe("is:unresolved level:[error,warning] firstSeen:-24h");
  });

  test("rewrites quoted values", () => {
    expect(
      sanitizeQuery('message:"pool exhaustion" OR message:"connection timeout"')
    ).toBe('message:["pool exhaustion","connection timeout"]');
  });

  test("merges existing in-list value with plain value", () => {
    expect(sanitizeQuery("level:[error,warning] OR level:fatal")).toBe(
      "level:[error,warning,fatal]"
    );
  });

  test("merges two in-list values", () => {
    expect(sanitizeQuery("level:[error] OR level:[warning,fatal]")).toBe(
      "level:[error,warning,fatal]"
    );
  });

  test("rewrites multiple independent OR groups", () => {
    expect(
      sanitizeQuery(
        "level:error OR level:warning browser:Chrome OR browser:Firefox"
      )
    ).toBe("level:[error,warning] browser:[Chrome,Firefox]");
  });

  test("handles case-insensitive OR", () => {
    expect(sanitizeQuery("level:error or level:warning")).toBe(
      "level:[error,warning]"
    );
    expect(sanitizeQuery("level:error Or level:warning")).toBe(
      "level:[error,warning]"
    );
  });

  test("handles mixed AND and OR", () => {
    expect(
      sanitizeQuery("is:unresolved AND level:error OR level:warning")
    ).toBe("is:unresolved level:[error,warning]");
  });

  test("preserves key casing from first token", () => {
    expect(sanitizeQuery("Level:error OR level:warning")).toBe(
      "Level:[error,warning]"
    );
  });

  test("handles leading OR (stray)", () => {
    expect(sanitizeQuery("OR level:error OR level:warning")).toBe(
      "level:[error,warning]"
    );
  });

  test("handles trailing OR (stray)", () => {
    expect(sanitizeQuery("level:error OR level:warning OR")).toBe(
      "level:[error,warning]"
    );
  });
});

// ---------------------------------------------------------------------------
// OR → throws (cannot rewrite)
// ---------------------------------------------------------------------------

describe("sanitizeQuery: OR → throws", () => {
  test("throws for free-text OR", () => {
    expect(() => sanitizeQuery("error OR timeout")).toThrow(ValidationError);
  });

  test("throws for different keys across OR", () => {
    expect(() => sanitizeQuery("level:error OR assigned:me")).toThrow(
      ValidationError
    );
  });

  test("throws for is: qualifier (not supported with in-list)", () => {
    expect(() => sanitizeQuery("is:unresolved OR is:resolved")).toThrow(
      ValidationError
    );
  });

  test("throws for has: qualifier (not supported with in-list)", () => {
    expect(() => sanitizeQuery("has:user OR has:email")).toThrow(
      ValidationError
    );
  });

  test("throws for negated qualifiers", () => {
    expect(() => sanitizeQuery("!level:error OR !level:warning")).toThrow(
      ValidationError
    );
  });

  test("throws for wildcards in values", () => {
    expect(() => sanitizeQuery("message:*error* OR message:*timeout*")).toThrow(
      ValidationError
    );
  });

  test("throws for comparison operator values (not valid in in-list)", () => {
    expect(() => sanitizeQuery("age:>24h OR age:>7d")).toThrow(ValidationError);
    expect(() => sanitizeQuery("times_seen:>100 OR times_seen:>200")).toThrow(
      ValidationError
    );
    expect(() =>
      sanitizeQuery("span.duration:>=1s OR span.duration:>=500ms")
    ).toThrow(ValidationError);
    expect(() =>
      sanitizeQuery("firstSeen:<=2024-01-01 OR firstSeen:<=2024-06-01")
    ).toThrow(ValidationError);
  });

  test("throws for mixed free-text and qualifier OR", () => {
    expect(() => sanitizeQuery("is:unresolved error OR timeout")).toThrow(
      ValidationError
    );
  });

  test("error includes field and rewritable example", () => {
    try {
      sanitizeQuery("error OR timeout");
      expect.unreachable("Should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      const ve = error as ValidationError;
      expect(ve.field).toBe("query");
      expect(ve.message).toContain("OR");
      expect(ve.message).toContain("level:error OR level:warning");
      expect(ve.message).toContain("key:[val1,val2]");
    }
  });

  test("throws for OR with qualifiers mixed in (real-world query 1)", () => {
    // From CLI-16J: AI agent tried free-text OR
    expect(() =>
      sanitizeQuery(
        "is:unresolved pool exhaustion OR connection timeout OR connection terminated"
      )
    ).toThrow(ValidationError);
  });
});
