// biome-ignore-all lint/performance/useTopLevelRegex: regex in test assertions is fine
/**
 * API Command Unit Tests
 *
 * Tests for parsing functions in the api command.
 */

import { describe, expect, test } from "bun:test";
import {
  parseFields,
  parseFieldValue,
  parseHeaders,
  parseMethod,
  setNestedValue,
} from "../../src/commands/api.js";

describe("parseMethod", () => {
  test("accepts valid uppercase methods", () => {
    expect(parseMethod("GET")).toBe("GET");
    expect(parseMethod("POST")).toBe("POST");
    expect(parseMethod("PUT")).toBe("PUT");
    expect(parseMethod("DELETE")).toBe("DELETE");
    expect(parseMethod("PATCH")).toBe("PATCH");
  });

  test("normalizes lowercase methods to uppercase", () => {
    expect(parseMethod("get")).toBe("GET");
    expect(parseMethod("post")).toBe("POST");
    expect(parseMethod("delete")).toBe("DELETE");
  });

  test("normalizes mixed case methods", () => {
    expect(parseMethod("Get")).toBe("GET");
    expect(parseMethod("pOsT")).toBe("POST");
  });

  test("throws for invalid methods", () => {
    expect(() => parseMethod("INVALID")).toThrow(/Invalid method/);
    expect(() => parseMethod("HEAD")).toThrow(/Invalid method/);
    expect(() => parseMethod("OPTIONS")).toThrow(/Invalid method/);
    expect(() => parseMethod("")).toThrow(/Invalid method/);
  });
});

describe("parseFieldValue", () => {
  test("parses valid JSON values", () => {
    expect(parseFieldValue('"hello"')).toBe("hello");
    expect(parseFieldValue("123")).toBe(123);
    expect(parseFieldValue("3.14")).toBe(3.14);
    expect(parseFieldValue("true")).toBe(true);
    expect(parseFieldValue("false")).toBe(false);
    expect(parseFieldValue("null")).toBe(null);
    expect(parseFieldValue("[1,2,3]")).toEqual([1, 2, 3]);
    expect(parseFieldValue('{"a":1}')).toEqual({ a: 1 });
  });

  test("returns raw string for non-JSON values", () => {
    expect(parseFieldValue("hello")).toBe("hello");
    expect(parseFieldValue("hello world")).toBe("hello world");
    expect(parseFieldValue("")).toBe("");
  });
});

describe("setNestedValue", () => {
  test("sets top-level value", () => {
    const obj: Record<string, unknown> = {};
    setNestedValue(obj, "key", "value");
    expect(obj).toEqual({ key: "value" });
  });

  test("sets nested value with dot notation", () => {
    const obj: Record<string, unknown> = {};
    setNestedValue(obj, "a.b.c", "value");
    expect(obj).toEqual({ a: { b: { c: "value" } } });
  });

  test("preserves existing nested structure", () => {
    const obj: Record<string, unknown> = { a: { existing: true } };
    setNestedValue(obj, "a.new", "value");
    expect(obj).toEqual({ a: { existing: true, new: "value" } });
  });

  test("overwrites existing value", () => {
    const obj: Record<string, unknown> = { key: "old" };
    setNestedValue(obj, "key", "new");
    expect(obj).toEqual({ key: "new" });
  });

  test("throws for __proto__ key (prototype pollution prevention)", () => {
    const obj: Record<string, unknown> = {};
    expect(() => setNestedValue(obj, "__proto__.evil", true)).toThrow(
      /Invalid field key: "__proto__" is not allowed/
    );
    // Verify no pollution occurred
    expect(({} as Record<string, unknown>).evil).toBeUndefined();
  });

  test("throws for nested __proto__ key", () => {
    const obj: Record<string, unknown> = {};
    expect(() => setNestedValue(obj, "foo.__proto__.bar", true)).toThrow(
      /Invalid field key: "__proto__" is not allowed/
    );
  });

  test("throws for constructor key", () => {
    const obj: Record<string, unknown> = {};
    expect(() => setNestedValue(obj, "constructor.prototype.x", true)).toThrow(
      /Invalid field key: "constructor" is not allowed/
    );
  });

  test("throws for prototype key", () => {
    const obj: Record<string, unknown> = {};
    expect(() => setNestedValue(obj, "prototype.y", true)).toThrow(
      /Invalid field key: "prototype" is not allowed/
    );
  });

  test("handles consecutive dots gracefully", () => {
    const obj: Record<string, unknown> = {};
    setNestedValue(obj, "a..b", "value");
    expect(obj).toEqual({ a: { b: "value" } });
  });
});

describe("parseFields", () => {
  test("parses single field", () => {
    expect(parseFields(["key=value"])).toEqual({ key: "value" });
  });

  test("parses multiple fields", () => {
    expect(parseFields(["a=1", "b=2"])).toEqual({ a: 1, b: 2 });
  });

  test("parses nested fields with dot notation", () => {
    expect(parseFields(["user.name=John", "user.age=30"])).toEqual({
      user: { name: "John", age: 30 },
    });
  });

  test("parses JSON values in fields", () => {
    expect(parseFields(["tags=[1,2,3]", "active=true"])).toEqual({
      tags: [1, 2, 3],
      active: true,
    });
  });

  test("handles value with equals sign", () => {
    expect(parseFields(["query=a=b"])).toEqual({ query: "a=b" });
  });

  test("throws for invalid field format", () => {
    expect(() => parseFields(["invalid"])).toThrow(/Invalid field format/);
    expect(() => parseFields(["no-equals"])).toThrow(/Invalid field format/);
  });

  test("returns empty object for empty array", () => {
    expect(parseFields([])).toEqual({});
  });
});

describe("parseFields with raw=true (--raw-field behavior)", () => {
  test("keeps number values as strings", () => {
    expect(parseFields(["count=123"], true)).toEqual({ count: "123" });
    expect(parseFields(["price=3.14"], true)).toEqual({ price: "3.14" });
  });

  test("keeps boolean values as strings", () => {
    expect(parseFields(["active=true"], true)).toEqual({ active: "true" });
    expect(parseFields(["enabled=false"], true)).toEqual({ enabled: "false" });
  });

  test("keeps null as string", () => {
    expect(parseFields(["value=null"], true)).toEqual({ value: "null" });
  });

  test("keeps JSON arrays as strings", () => {
    expect(parseFields(["tags=[1,2,3]"], true)).toEqual({ tags: "[1,2,3]" });
  });

  test("keeps JSON objects as strings", () => {
    expect(parseFields(['data={"a":1}'], true)).toEqual({ data: '{"a":1}' });
  });

  test("keeps plain strings as strings", () => {
    expect(parseFields(["name=John"], true)).toEqual({ name: "John" });
  });

  test("handles nested keys with raw values", () => {
    expect(parseFields(["user.age=30"], true)).toEqual({
      user: { age: "30" },
    });
  });

  test("handles empty value", () => {
    expect(parseFields(["empty="], true)).toEqual({ empty: "" });
  });

  test("comparison: raw vs typed for same input", () => {
    // Typed (default): parses JSON
    expect(parseFields(["count=123"])).toEqual({ count: 123 });
    // Raw: keeps as string
    expect(parseFields(["count=123"], true)).toEqual({ count: "123" });
  });
});

describe("parseHeaders", () => {
  test("parses single header", () => {
    expect(parseHeaders(["Content-Type: application/json"])).toEqual({
      "Content-Type": "application/json",
    });
  });

  test("parses multiple headers", () => {
    expect(
      parseHeaders(["Content-Type: application/json", "Accept: text/plain"])
    ).toEqual({
      "Content-Type": "application/json",
      Accept: "text/plain",
    });
  });

  test("trims whitespace around key and value", () => {
    expect(parseHeaders(["  Key  :  Value  "])).toEqual({ Key: "Value" });
  });

  test("handles value with colon", () => {
    expect(parseHeaders(["Time: 12:30:00"])).toEqual({ Time: "12:30:00" });
  });

  test("throws for invalid header format", () => {
    expect(() => parseHeaders(["invalid"])).toThrow(/Invalid header format/);
    expect(() => parseHeaders(["no-colon"])).toThrow(/Invalid header format/);
  });

  test("returns empty object for empty array", () => {
    expect(parseHeaders([])).toEqual({});
  });
});
