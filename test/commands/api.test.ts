// biome-ignore-all lint/performance/useTopLevelRegex: regex in test assertions is fine
/**
 * API Command Unit Tests
 *
 * Tests for parsing functions in the api command.
 */

import { describe, expect, test } from "bun:test";
import {
  buildBodyFromFields,
  buildQueryParams,
  normalizeEndpoint,
  parseFieldKey,
  parseFields,
  parseFieldValue,
  parseHeaders,
  parseMethod,
  prepareRequestOptions,
  setNestedValue,
  writeResponseBody,
  writeResponseHeaders,
  writeVerboseRequest,
  writeVerboseResponse,
} from "../../src/commands/api.js";
import type { Writer } from "../../src/types/index.js";

/**
 * Create a mock Writer that collects output into a string
 */
function createMockWriter(): Writer & { output: string } {
  const mock = {
    output: "",
    write(data: string): boolean {
      mock.output += data;
      return true;
    },
  };
  return mock;
}

describe("normalizeEndpoint", () => {
  test("adds trailing slash when missing", () => {
    expect(normalizeEndpoint("organizations")).toBe("organizations/");
    expect(normalizeEndpoint("issues/123")).toBe("issues/123/");
    expect(normalizeEndpoint("projects/my-org/my-project")).toBe(
      "projects/my-org/my-project/"
    );
  });

  test("preserves existing trailing slash", () => {
    expect(normalizeEndpoint("organizations/")).toBe("organizations/");
    expect(normalizeEndpoint("issues/123/")).toBe("issues/123/");
  });

  test("removes leading slash", () => {
    expect(normalizeEndpoint("/organizations")).toBe("organizations/");
    expect(normalizeEndpoint("/organizations/")).toBe("organizations/");
    expect(normalizeEndpoint("/issues/123")).toBe("issues/123/");
  });

  test("handles both leading and trailing slash", () => {
    expect(normalizeEndpoint("/organizations/")).toBe("organizations/");
  });

  test("handles empty string", () => {
    expect(normalizeEndpoint("")).toBe("/");
  });

  test("handles just a slash", () => {
    expect(normalizeEndpoint("/")).toBe("/");
  });
});

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

describe("parseFieldKey", () => {
  test("parses simple key", () => {
    expect(parseFieldKey("name")).toEqual(["name"]);
  });

  test("parses single bracket", () => {
    expect(parseFieldKey("user[name]")).toEqual(["user", "name"]);
  });

  test("parses multiple brackets", () => {
    expect(parseFieldKey("a[b][c]")).toEqual(["a", "b", "c"]);
  });

  test("parses array push syntax (empty bracket)", () => {
    expect(parseFieldKey("tags[]")).toEqual(["tags", ""]);
  });

  test("parses nested array push syntax", () => {
    expect(parseFieldKey("user[tags][]")).toEqual(["user", "tags", ""]);
  });

  test("throws for invalid format with unmatched brackets", () => {
    expect(() => parseFieldKey("user[name")).toThrow(
      /Invalid field key format/
    );
    expect(() => parseFieldKey("user]name[")).toThrow(
      /Invalid field key format/
    );
  });

  test("throws for nested brackets", () => {
    expect(() => parseFieldKey("user[[name]]")).toThrow(
      /Invalid field key format/
    );
  });

  test("throws for key starting with bracket", () => {
    expect(() => parseFieldKey("[name]")).toThrow(/Invalid field key format/);
  });

  test("throws for empty key", () => {
    expect(() => parseFieldKey("")).toThrow(/Invalid field key format/);
  });

  test("parses key with multiple consecutive empty brackets", () => {
    // This is valid syntax: creates path ["a", "", ""]
    // But validatePathSegments will reject it for having [] not at end
    // Testing that parsing itself works
    expect(parseFieldKey("a[][]")).toEqual(["a", "", ""]);
  });
});

describe("setNestedValue", () => {
  test("sets top-level value", () => {
    const obj: Record<string, unknown> = {};
    setNestedValue(obj, "key", "value");
    expect(obj).toEqual({ key: "value" });
  });

  test("sets nested value with bracket notation", () => {
    const obj: Record<string, unknown> = {};
    setNestedValue(obj, "a[b][c]", "value");
    expect(obj).toEqual({ a: { b: { c: "value" } } });
  });

  test("preserves existing nested structure", () => {
    const obj: Record<string, unknown> = { a: { existing: true } };
    setNestedValue(obj, "a[new]", "value");
    expect(obj).toEqual({ a: { existing: true, new: "value" } });
  });

  test("overwrites existing value", () => {
    const obj: Record<string, unknown> = { key: "old" };
    setNestedValue(obj, "key", "new");
    expect(obj).toEqual({ key: "new" });
  });

  test("handles array push syntax", () => {
    const obj: Record<string, unknown> = {};
    setNestedValue(obj, "tags[]", "foo");
    setNestedValue(obj, "tags[]", "bar");
    expect(obj).toEqual({ tags: ["foo", "bar"] });
  });

  test("handles empty array initialization", () => {
    const obj: Record<string, unknown> = {};
    setNestedValue(obj, "tags[]", undefined);
    expect(obj).toEqual({ tags: [] });
  });

  test("handles nested array push", () => {
    const obj: Record<string, unknown> = {};
    setNestedValue(obj, "user[tags][]", "admin");
    setNestedValue(obj, "user[tags][]", "editor");
    expect(obj).toEqual({ user: { tags: ["admin", "editor"] } });
  });

  test("throws for __proto__ key (prototype pollution prevention)", () => {
    const obj: Record<string, unknown> = {};
    expect(() => setNestedValue(obj, "__proto__[evil]", true)).toThrow(
      /Invalid field key: "__proto__" is not allowed/
    );
    // Verify no pollution occurred
    expect(({} as Record<string, unknown>).evil).toBeUndefined();
  });

  test("throws for nested __proto__ key", () => {
    const obj: Record<string, unknown> = {};
    expect(() => setNestedValue(obj, "foo[__proto__][bar]", true)).toThrow(
      /Invalid field key: "__proto__" is not allowed/
    );
  });

  test("throws for constructor key", () => {
    const obj: Record<string, unknown> = {};
    expect(() =>
      setNestedValue(obj, "constructor[prototype][x]", true)
    ).toThrow(/Invalid field key: "constructor" is not allowed/);
  });

  test("throws for prototype key", () => {
    const obj: Record<string, unknown> = {};
    expect(() => setNestedValue(obj, "prototype[y]", true)).toThrow(
      /Invalid field key: "prototype" is not allowed/
    );
  });

  // Type conflict tests (matching gh api behavior)
  test("throws when traversing into string (simple then nested)", () => {
    const obj: Record<string, unknown> = {};
    setNestedValue(obj, "user", "John");
    expect(() => setNestedValue(obj, "user[name]", "Jane")).toThrow(
      /expected map type under "user", got string/
    );
  });

  test("throws when traversing into number", () => {
    const obj: Record<string, unknown> = {};
    setNestedValue(obj, "count", 42);
    expect(() => setNestedValue(obj, "count[value]", 100)).toThrow(
      /expected map type under "count", got number/
    );
  });

  test("throws when pushing to non-array (simple then array)", () => {
    const obj: Record<string, unknown> = {};
    setNestedValue(obj, "tags", "foo");
    expect(() => setNestedValue(obj, "tags[]", "bar")).toThrow(
      /expected array type under "tags", got string/
    );
  });

  test("throws when pushing to object", () => {
    const obj: Record<string, unknown> = {};
    setNestedValue(obj, "tags[name]", "foo");
    expect(() => setNestedValue(obj, "tags[]", "bar")).toThrow(
      /expected array type under "tags", got map/
    );
  });

  test("throws when nesting into array", () => {
    const obj: Record<string, unknown> = {};
    setNestedValue(obj, "items[]", "first");
    expect(() => setNestedValue(obj, "items[key]", "value")).toThrow(
      /expected map type under "items", got array/
    );
  });

  test("allows overwriting nested with simple value", () => {
    const obj: Record<string, unknown> = {};
    setNestedValue(obj, "user[name]", "Jane");
    setNestedValue(obj, "user", "John");
    expect(obj).toEqual({ user: "John" });
  });

  // Invalid bracket position tests (prevents silent data loss)
  test("throws for empty brackets in middle of path (a[][b])", () => {
    const obj: Record<string, unknown> = {};
    expect(() => setNestedValue(obj, "a[][b]", "value")).toThrow(
      /empty brackets \[\] can only appear at the end/
    );
  });

  test("throws for deeply nested empty brackets in middle", () => {
    const obj: Record<string, unknown> = {};
    expect(() => setNestedValue(obj, "a[b][][c]", "value")).toThrow(
      /empty brackets \[\] can only appear at the end/
    );
  });

  test("allows empty brackets at end with nested path", () => {
    const obj: Record<string, unknown> = {};
    setNestedValue(obj, "a[b][]", "value1");
    setNestedValue(obj, "a[b][]", "value2");
    expect(obj).toEqual({ a: { b: ["value1", "value2"] } });
  });

  // Additional edge cases for internal function coverage
  test("throws when traversing into boolean", () => {
    const obj: Record<string, unknown> = {};
    setNestedValue(obj, "flag", true);
    expect(() => setNestedValue(obj, "flag[value]", "test")).toThrow(
      /expected map type under "flag", got boolean/
    );
  });

  test("throws when traversing into null", () => {
    const obj: Record<string, unknown> = {};
    setNestedValue(obj, "empty", null);
    expect(() => setNestedValue(obj, "empty[value]", "test")).toThrow(
      /expected map type under "empty", got/
    );
  });

  test("throws when pushing to boolean", () => {
    const obj: Record<string, unknown> = {};
    setNestedValue(obj, "flag", false);
    expect(() => setNestedValue(obj, "flag[]", "item")).toThrow(
      /expected array type under "flag", got boolean/
    );
  });

  test("throws when pushing to null", () => {
    const obj: Record<string, unknown> = {};
    setNestedValue(obj, "empty", null);
    expect(() => setNestedValue(obj, "empty[]", "item")).toThrow(
      /expected array type under "empty", got/
    );
  });

  test("handles deeply nested type conflict with correct path in error", () => {
    const obj: Record<string, unknown> = {};
    setNestedValue(obj, "a[b][c]", "value");
    expect(() => setNestedValue(obj, "a[b][c][d]", "nested")).toThrow(
      /expected map type under "a\[b\]\[c\]", got string/
    );
  });

  test("handles array type conflict at nested level with correct path", () => {
    const obj: Record<string, unknown> = {};
    setNestedValue(obj, "a[b][]", "item");
    expect(() => setNestedValue(obj, "a[b][key]", "value")).toThrow(
      /expected map type under "a\[b\]", got array/
    );
  });

  test("handles simple key with undefined value", () => {
    const obj: Record<string, unknown> = {};
    setNestedValue(obj, "key", undefined);
    expect(obj).toEqual({ key: undefined });
  });

  test("handles nested key with null value", () => {
    const obj: Record<string, unknown> = {};
    setNestedValue(obj, "a[b]", null);
    expect(obj).toEqual({ a: { b: null } });
  });
});

describe("parseFields", () => {
  test("parses single field", () => {
    expect(parseFields(["key=value"])).toEqual({ key: "value" });
  });

  test("parses multiple fields", () => {
    expect(parseFields(["a=1", "b=2"])).toEqual({ a: 1, b: 2 });
  });

  test("parses nested fields with bracket notation", () => {
    expect(parseFields(["user[name]=John", "user[age]=30"])).toEqual({
      user: { name: "John", age: 30 },
    });
  });

  test("parses deeply nested fields", () => {
    expect(parseFields(["a[b][c][d]=value"])).toEqual({
      a: { b: { c: { d: "value" } } },
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

  test("handles array push syntax", () => {
    expect(parseFields(["tags[]=foo", "tags[]=bar"])).toEqual({
      tags: ["foo", "bar"],
    });
  });

  test("handles empty array syntax", () => {
    expect(parseFields(["tags[]"])).toEqual({ tags: [] });
  });

  test("handles mixed object and array fields", () => {
    expect(
      parseFields([
        "user[name]=John",
        "user[roles][]=admin",
        "user[roles][]=editor",
      ])
    ).toEqual({
      user: { name: "John", roles: ["admin", "editor"] },
    });
  });

  test("throws for invalid field format without equals", () => {
    expect(() => parseFields(["invalid"])).toThrow(/Invalid field format/);
    expect(() => parseFields(["no-equals"])).toThrow(/Invalid field format/);
  });

  test("allows empty array syntax without equals", () => {
    // This should NOT throw - it's valid empty array syntax
    expect(() => parseFields(["items[]"])).not.toThrow();
  });

  test("returns empty object for empty array", () => {
    expect(parseFields([])).toEqual({});
  });

  test("handles field with empty key", () => {
    // Empty string before = should throw
    expect(() => parseFields(["=value"])).toThrow(/Invalid field key format/);
  });

  test("handles deeply nested array push", () => {
    expect(parseFields(["a[b][c][]=item1", "a[b][c][]=item2"])).toEqual({
      a: { b: { c: ["item1", "item2"] } },
    });
  });

  test("handles overwriting array with object", () => {
    // First create array, then try to treat it as object - should throw
    expect(() => parseFields(["items[]=first", "items[key]=value"])).toThrow(
      /expected map type/
    );
  });

  test("handles overwriting object with array", () => {
    // First create object, then try to treat it as array - should throw
    expect(() => parseFields(["items[key]=value", "items[]=item"])).toThrow(
      /expected array type/
    );
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
    expect(parseFields(["user[age]=30"], true)).toEqual({
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

describe("buildQueryParams", () => {
  test("builds simple key=value params", () => {
    expect(buildQueryParams(["status=resolved", "limit=10"])).toEqual({
      status: "resolved",
      limit: "10",
    });
  });

  test("handles arrays as repeated keys", () => {
    expect(buildQueryParams(["tags=[1,2,3]"])).toEqual({
      tags: ["1", "2", "3"],
    });
  });

  test("handles arrays of strings", () => {
    expect(buildQueryParams(['names=["alice","bob"]'])).toEqual({
      names: ["alice", "bob"],
    });
  });

  test("converts all values to strings", () => {
    expect(buildQueryParams(["count=42", "active=true", "value=null"])).toEqual(
      {
        count: "42",
        active: "true",
        value: "null",
      }
    );
  });

  test("handles value with equals sign", () => {
    expect(buildQueryParams(["query=a=b"])).toEqual({ query: "a=b" });
  });

  test("throws for invalid field format", () => {
    expect(() => buildQueryParams(["invalid"])).toThrow(/Invalid field format/);
    expect(() => buildQueryParams(["no-equals"])).toThrow(
      /Invalid field format/
    );
  });

  test("returns empty object for empty array", () => {
    expect(buildQueryParams([])).toEqual({});
  });

  test("handles objects by JSON stringifying them", () => {
    expect(buildQueryParams(['data={"key":"value"}'])).toEqual({
      data: '{"key":"value"}',
    });
  });

  test("handles nested objects by JSON stringifying them", () => {
    expect(buildQueryParams(['filter={"user":{"name":"john"}}'])).toEqual({
      filter: '{"user":{"name":"john"}}',
    });
  });

  test("handles arrays of objects by JSON stringifying each element", () => {
    expect(
      buildQueryParams(['filters=[{"key":"value"},{"key2":"value2"}]'])
    ).toEqual({
      filters: ['{"key":"value"}', '{"key2":"value2"}'],
    });
  });

  test("handles mixed arrays with objects and primitives", () => {
    expect(buildQueryParams(['data=[1,{"obj":true},"string"]'])).toEqual({
      data: ["1", '{"obj":true}', "string"],
    });
  });
});

describe("prepareRequestOptions", () => {
  test("GET with no fields returns undefined for both body and params", () => {
    const result = prepareRequestOptions("GET", undefined);
    expect(result.body).toBeUndefined();
    expect(result.params).toBeUndefined();
  });

  test("GET with empty fields returns undefined for both body and params", () => {
    const result = prepareRequestOptions("GET", []);
    expect(result.body).toBeUndefined();
    expect(result.params).toBeUndefined();
  });

  test("GET with fields returns params (not body)", () => {
    const result = prepareRequestOptions("GET", [
      "status=resolved",
      "limit=10",
    ]);
    expect(result.body).toBeUndefined();
    expect(result.params).toEqual({
      status: "resolved",
      limit: "10",
    });
  });

  test("POST with fields returns body (not params)", () => {
    const result = prepareRequestOptions("POST", ["status=resolved"]);
    expect(result.body).toEqual({ status: "resolved" });
    expect(result.params).toBeUndefined();
  });

  test("PUT with fields returns body (not params)", () => {
    const result = prepareRequestOptions("PUT", ["name=test"]);
    expect(result.body).toEqual({ name: "test" });
    expect(result.params).toBeUndefined();
  });

  test("PATCH with fields returns body (not params)", () => {
    const result = prepareRequestOptions("PATCH", ["active=true"]);
    expect(result.body).toEqual({ active: true });
    expect(result.params).toBeUndefined();
  });

  test("DELETE with fields returns body (not params)", () => {
    const result = prepareRequestOptions("DELETE", ["force=true"]);
    expect(result.body).toEqual({ force: true });
    expect(result.params).toBeUndefined();
  });

  test("POST with no fields returns undefined for both body and params", () => {
    const result = prepareRequestOptions("POST", undefined);
    expect(result.body).toBeUndefined();
    expect(result.params).toBeUndefined();
  });

  test("GET with array field converts to string array in params", () => {
    const result = prepareRequestOptions("GET", ["tags=[1,2,3]"]);
    expect(result.params).toEqual({ tags: ["1", "2", "3"] });
  });

  test("POST with nested fields creates nested body object", () => {
    const result = prepareRequestOptions("POST", [
      "user[name]=John",
      "user[age]=30",
    ]);
    expect(result.body).toEqual({ user: { name: "John", age: 30 } });
  });
});

describe("buildBodyFromFields", () => {
  test("returns undefined for no fields", () => {
    expect(buildBodyFromFields(undefined, undefined)).toBeUndefined();
    expect(buildBodyFromFields([], [])).toBeUndefined();
    expect(buildBodyFromFields([], undefined)).toBeUndefined();
    expect(buildBodyFromFields(undefined, [])).toBeUndefined();
  });

  test("builds body from typed fields only", () => {
    expect(buildBodyFromFields(["name=John", "age=30"], undefined)).toEqual({
      name: "John",
      age: 30,
    });
  });

  test("builds body from raw fields only", () => {
    expect(buildBodyFromFields(undefined, ["name=John", "age=30"])).toEqual({
      name: "John",
      age: "30",
    });
  });

  test("merges typed and raw fields", () => {
    expect(buildBodyFromFields(["typed=123"], ["raw=456"])).toEqual({
      typed: 123,
      raw: "456",
    });
  });

  test("raw fields can overwrite typed fields", () => {
    // Typed field first parses "123" as number
    // Raw field then overwrites with string "456"
    expect(buildBodyFromFields(["value=123"], ["value=456"])).toEqual({
      value: "456",
    });
  });

  test("handles nested fields from both typed and raw", () => {
    expect(buildBodyFromFields(["user[name]=John"], ["user[age]=30"])).toEqual({
      user: { name: "John", age: "30" },
    });
  });

  test("handles array push from both typed and raw", () => {
    expect(buildBodyFromFields(["tags[]=foo"], ["tags[]=bar"])).toEqual({
      tags: ["foo", "bar"],
    });
  });
});

describe("writeResponseHeaders", () => {
  test("writes status and headers", () => {
    const writer = createMockWriter();
    const headers = new Headers({
      "Content-Type": "application/json",
      "X-Custom": "value",
    });

    writeResponseHeaders(writer, 200, headers);

    expect(writer.output).toMatch(/^HTTP 200\n/);
    expect(writer.output).toMatch(/content-type: application\/json/i);
    expect(writer.output).toMatch(/x-custom: value/i);
    expect(writer.output).toMatch(/\n$/);
  });

  test("handles different status codes", () => {
    const writer = createMockWriter();
    const headers = new Headers();

    writeResponseHeaders(writer, 404, headers);

    expect(writer.output).toMatch(/^HTTP 404\n/);
  });

  test("handles empty headers", () => {
    const writer = createMockWriter();
    const headers = new Headers();

    writeResponseHeaders(writer, 200, headers);

    expect(writer.output).toBe("HTTP 200\n\n");
  });
});

describe("writeResponseBody", () => {
  test("writes JSON object with formatting", () => {
    const writer = createMockWriter();

    writeResponseBody(writer, { key: "value", num: 42 });

    expect(writer.output).toBe('{\n  "key": "value",\n  "num": 42\n}\n');
  });

  test("writes JSON array with formatting", () => {
    const writer = createMockWriter();

    writeResponseBody(writer, [1, 2, 3]);

    expect(writer.output).toBe("[\n  1,\n  2,\n  3\n]\n");
  });

  test("writes string directly", () => {
    const writer = createMockWriter();

    writeResponseBody(writer, "plain text response");

    expect(writer.output).toBe("plain text response\n");
  });

  test("writes number as string", () => {
    const writer = createMockWriter();

    writeResponseBody(writer, 42);

    expect(writer.output).toBe("42\n");
  });

  test("writes boolean as string", () => {
    const writer = createMockWriter();

    writeResponseBody(writer, true);

    expect(writer.output).toBe("true\n");
  });

  test("does not write null", () => {
    const writer = createMockWriter();

    writeResponseBody(writer, null);

    expect(writer.output).toBe("");
  });

  test("does not write undefined", () => {
    const writer = createMockWriter();

    writeResponseBody(writer, undefined);

    expect(writer.output).toBe("");
  });
});

describe("writeVerboseRequest", () => {
  test("writes method and endpoint", () => {
    const writer = createMockWriter();

    writeVerboseRequest(writer, "GET", "organizations/", undefined);

    expect(writer.output).toBe("> GET /api/0/organizations/\n>\n");
  });

  test("writes headers when provided", () => {
    const writer = createMockWriter();

    writeVerboseRequest(writer, "POST", "issues/", {
      "Content-Type": "application/json",
      "X-Custom": "value",
    });

    expect(writer.output).toMatch(/^> POST \/api\/0\/issues\/\n/);
    expect(writer.output).toMatch(/> Content-Type: application\/json\n/);
    expect(writer.output).toMatch(/> X-Custom: value\n/);
    expect(writer.output).toMatch(/>\n$/);
  });

  test("handles empty headers object", () => {
    const writer = createMockWriter();

    writeVerboseRequest(writer, "DELETE", "issues/123/", {});

    expect(writer.output).toBe("> DELETE /api/0/issues/123/\n>\n");
  });
});

describe("writeVerboseResponse", () => {
  test("writes status and headers with < prefix", () => {
    const writer = createMockWriter();
    const headers = new Headers({
      "Content-Type": "application/json",
      "X-Request-Id": "abc123",
    });

    writeVerboseResponse(writer, 200, headers);

    expect(writer.output).toMatch(/^< HTTP 200\n/);
    expect(writer.output).toMatch(/< content-type: application\/json/i);
    expect(writer.output).toMatch(/< x-request-id: abc123/i);
    expect(writer.output).toMatch(/<\n$/);
  });

  test("handles error status codes", () => {
    const writer = createMockWriter();
    const headers = new Headers();

    writeVerboseResponse(writer, 500, headers);

    expect(writer.output).toMatch(/^< HTTP 500\n/);
  });

  test("handles empty headers", () => {
    const writer = createMockWriter();
    const headers = new Headers();

    writeVerboseResponse(writer, 204, headers);

    expect(writer.output).toBe("< HTTP 204\n<\n");
  });
});
