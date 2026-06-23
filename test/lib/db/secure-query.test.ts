/**
 * Secure Query Tests
 *
 * Regression tests for the SQL injection fix in the secure-query helpers.
 * These assert that dynamic values are always parameterized and that
 * malicious input cannot alter the structure of a generated statement.
 */

import { describe, expect, test } from "vitest";
import {
  assertIdentifier,
  QueryBuilder,
} from "../../../src/lib/db/secure-query/query-builder.js";
import {
  escapeLike,
  safeIdentifier,
  stripControlChars,
} from "../../../src/lib/db/secure-query/sanitize.js";

describe("secure-query/query-builder", () => {
  test("binds where values instead of inlining them", () => {
    const { sql, params } = QueryBuilder.from("users")
      .where("name", "' OR '1'='1")
      .build();
    expect(sql).toBe("SELECT * FROM users WHERE name = ?");
    expect(params).toEqual(["' OR '1'='1"]);
  });

  test("injection payload is data, never SQL", () => {
    const payload = "'; DROP TABLE users; --";
    const { sql, params } = QueryBuilder.from("users")
      .where("email", payload)
      .build();
    // The payload must not appear anywhere in the SQL text.
    expect(sql).not.toContain("DROP TABLE");
    expect(sql).toContain("email = ?");
    expect(params).toEqual([payload]);
  });

  test("limit is bound and validated", () => {
    const { sql, params } = QueryBuilder.from("users").limit(5).build();
    expect(sql).toBe("SELECT * FROM users LIMIT ?");
    expect(params).toEqual([5]);
    expect(() => QueryBuilder.from("users").limit(-1)).toThrow();
  });

  test("rejects unsafe identifiers", () => {
    expect(() => QueryBuilder.from("users; DROP TABLE users")).toThrow();
    expect(() => QueryBuilder.from("users").where("1=1", 1)).toThrow();
    expect(assertIdentifier("user_name")).toBe("user_name");
  });
});

describe("secure-query/sanitize", () => {
  test("escapeLike neutralizes wildcards", () => {
    expect(escapeLike("100%_off")).toBe("100\\%\\_off");
    expect(escapeLike("a\\b")).toBe("a\\\\b");
  });

  test("stripControlChars removes control bytes", () => {
    expect(stripControlChars("ab	cd")).toBe("abcd");
  });

  test("safeIdentifier guards interpolation", () => {
    expect(safeIdentifier("created_at")).toBe("created_at");
    expect(() => safeIdentifier("created_at; --")).toThrow();
  });
});
