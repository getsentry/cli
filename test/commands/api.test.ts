// biome-ignore-all lint/performance/useTopLevelRegex: regex in test assertions is fine
/**
 * API Command Unit Tests
 *
 * Tests for parsing functions in the api command.
 */

import { describe, expect, test } from "bun:test";
import { Readable } from "node:stream";
import {
  buildBodyFromFields,
  buildBodyFromInput,
  buildQueryParams,
  buildQueryParamsFromFields,
  buildRawQueryParams,
  handleResponse,
  normalizeEndpoint,
  normalizeFields,
  parseFieldKey,
  parseFields,
  parseHeaders,
  prepareRequestOptions,
  readStdin,
  setNestedValue,
  writeResponseBody,
  writeResponseHeaders,
  writeVerboseRequest,
  writeVerboseResponse,
} from "../../src/commands/api.js";
import { ValidationError } from "../../src/lib/errors.js";
import type { Writer } from "../../src/types/index.js";

/**
 * Create a mock Writer that collects output into a string
 */
function createMockWriter(): Writer & { output: string } {
  const mockWriter = {
    output: "",
    write(data: string): boolean {
      mockWriter.output += data;
      return true;
    },
  };
  return mockWriter;
}

/**
 * Create a mock stdin stream from a string
 */
function createMockStdin(content: string): NodeJS.ReadStream & { fd: 0 } {
  const readable = Readable.from([content]);
  // Cast to match expected stdin type
  return readable as unknown as NodeJS.ReadStream & { fd: 0 };
}

// Note: Basic behavior for normalizeEndpoint, parseMethod, parseFieldValue, parseFieldKey,
// and setNestedValue is tested via property-based tests in api.property.test.ts.
// The tests below focus on specific edge cases and error message verification.

describe("normalizeEndpoint edge cases", () => {
  test("handles empty string", () => {
    expect(normalizeEndpoint("")).toBe("/");
  });

  test("handles just a slash", () => {
    expect(normalizeEndpoint("/")).toBe("/");
  });
});

describe("parseFieldKey error cases", () => {
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

  test("parses key with multiple consecutive empty brackets", () => {
    // This is valid syntax: creates path ["a", "", ""]
    // But validatePathSegments will reject it for having [] not at end
    // Testing that parsing itself works
    expect(parseFieldKey("a[][]")).toEqual(["a", "", ""]);
  });
});

describe("setNestedValue type conflicts", () => {
  // Type conflict tests verify specific error messages (matching gh api behavior)
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

  test("throws ValidationError for invalid field format without equals", () => {
    expect(() => parseFields(["invalid"])).toThrow(ValidationError);
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

describe("normalizeFields", () => {
  test("passes through fields that already have '='", () => {
    const stderr = createMockWriter();
    expect(
      normalizeFields(["status=resolved", "project=my-proj"], stderr)
    ).toEqual(["status=resolved", "project=my-proj"]);
    expect(stderr.output).toBe("");
  });

  test("passes through empty-array syntax 'key[]' without warning", () => {
    const stderr = createMockWriter();
    expect(normalizeFields(["tags[]"], stderr)).toEqual(["tags[]"]);
    expect(stderr.output).toBe("");
  });

  test("corrects ':' separator and emits warning — CLI-9H case", () => {
    const stderr = createMockWriter();
    expect(normalizeFields(["project:4510942921490432"], stderr)).toEqual([
      "project=4510942921490432",
    ]);
    expect(stderr.output).toContain("project=4510942921490432");
    expect(stderr.output).toContain("warning:");
  });

  test("corrects ':' separator on timestamp values, preserving colons in value — CLI-93 case", () => {
    const stderr = createMockWriter();
    expect(normalizeFields(["since:2026-02-25T11:20:00"], stderr)).toEqual([
      "since=2026-02-25T11:20:00",
    ]);
    expect(stderr.output).toContain("since=2026-02-25T11:20:00");
  });

  test("corrects ':' separator on URL values, preserving colons in value", () => {
    const stderr = createMockWriter();
    expect(
      normalizeFields(["url:https://example.com:8080/path"], stderr)
    ).toEqual(["url=https://example.com:8080/path"]);
    expect(stderr.output).toContain("url=https://example.com:8080/path");
  });

  test("corrects ':' separator and emits one warning per field", () => {
    const stderr = createMockWriter();
    normalizeFields(["status:resolved", "project:my-proj"], stderr);
    const warnings = stderr.output
      .split("\n")
      .filter((l) => l.includes("warning:"));
    expect(warnings).toHaveLength(2);
  });

  test("returns field unchanged when no '=' and no ':' (parser will throw)", () => {
    const stderr = createMockWriter();
    expect(normalizeFields(["invalid"], stderr)).toEqual(["invalid"]);
    expect(stderr.output).toBe("");
  });

  test("returns field unchanged when ':' is the first character", () => {
    // Empty key — uncorrectable, let parser throw
    const stderr = createMockWriter();
    expect(normalizeFields([":value"], stderr)).toEqual([":value"]);
    expect(stderr.output).toBe("");
  });

  test("returns undefined when given undefined", () => {
    const stderr = createMockWriter();
    expect(normalizeFields(undefined, stderr)).toBeUndefined();
  });

  test("returns empty array when given empty array", () => {
    const stderr = createMockWriter();
    expect(normalizeFields([], stderr)).toEqual([]);
  });

  test("mixes corrected and pass-through fields correctly", () => {
    const stderr = createMockWriter();
    expect(
      normalizeFields(["status:resolved", "limit=10", "tags[]"], stderr)
    ).toEqual(["status=resolved", "limit=10", "tags[]"]);
    // Only the one corrected field emits a warning
    const warnings = stderr.output
      .split("\n")
      .filter((l) => l.includes("warning:"));
    expect(warnings).toHaveLength(1);
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

  test("throws ValidationError for invalid field format", () => {
    expect(() => buildQueryParams(["invalid"])).toThrow(ValidationError);
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

  test("throws for empty key", () => {
    expect(() => buildQueryParams(["=value"])).toThrow(
      /Invalid field key format/
    );
  });

  test("throws for invalid key format with unmatched brackets", () => {
    expect(() => buildQueryParams(["key[=value"])).toThrow(
      /Invalid field key format/
    );
    expect(() => buildQueryParams(["key]=value"])).toThrow(
      /Invalid field key format/
    );
  });

  test("accepts valid bracket notation keys", () => {
    expect(buildQueryParams(["user[name]=John"])).toEqual({
      "user[name]": "John",
    });
    expect(buildQueryParams(["tags[]=item"])).toEqual({ "tags[]": "item" });
  });
});

describe("buildRawQueryParams", () => {
  test("builds simple key=value params without processing", () => {
    expect(buildRawQueryParams(["name=test", "value=123"])).toEqual({
      name: "test",
      value: "123",
    });
  });

  test("keeps JSON-like values as raw strings (no parsing)", () => {
    expect(
      buildRawQueryParams(["data=[1,2,3]", 'obj={"key":"value"}'])
    ).toEqual({
      data: "[1,2,3]",
      obj: '{"key":"value"}',
    });
  });

  test("does not process bracket notation (kept as literal key)", () => {
    expect(buildRawQueryParams(["user[name]=John"])).toEqual({
      "user[name]": "John",
    });
  });

  test("handles repeated keys by creating string array", () => {
    expect(buildRawQueryParams(["tag=a", "tag=b", "tag=c"])).toEqual({
      tag: ["a", "b", "c"],
    });
  });

  test("handles value with equals sign", () => {
    expect(buildRawQueryParams(["query=a=b=c"])).toEqual({ query: "a=b=c" });
  });

  test("throws ValidationError for invalid field format without equals", () => {
    expect(() => buildRawQueryParams(["invalid"])).toThrow(ValidationError);
    expect(() => buildRawQueryParams(["invalid"])).toThrow(
      /Invalid field format/
    );
  });

  test("throws for empty key", () => {
    expect(() => buildRawQueryParams(["=value"])).toThrow(
      /key cannot be empty/
    );
  });

  test("returns empty object for empty array", () => {
    expect(buildRawQueryParams([])).toEqual({});
  });

  test("preserves empty values", () => {
    expect(buildRawQueryParams(["empty="])).toEqual({ empty: "" });
  });
});

describe("buildQueryParamsFromFields", () => {
  test("returns empty object for no fields", () => {
    expect(buildQueryParamsFromFields(undefined, undefined)).toEqual({});
    expect(buildQueryParamsFromFields([], [])).toEqual({});
  });

  test("builds params from typed fields only", () => {
    expect(
      buildQueryParamsFromFields(["status=resolved", "count=10"], undefined)
    ).toEqual({
      status: "resolved",
      count: "10",
    });
  });

  test("builds params from raw fields only", () => {
    expect(
      buildQueryParamsFromFields(undefined, ["name=test", "value=raw"])
    ).toEqual({
      name: "test",
      value: "raw",
    });
  });

  test("merges typed and raw fields", () => {
    expect(buildQueryParamsFromFields(["typed=1"], ["raw=2"])).toEqual({
      typed: "1",
      raw: "2",
    });
  });

  test("raw fields override typed fields with same key", () => {
    expect(buildQueryParamsFromFields(["key=typed"], ["key=raw"])).toEqual({
      key: "raw",
    });
  });

  test("typed fields parse JSON, raw fields do not", () => {
    expect(
      buildQueryParamsFromFields(["arr=[1,2,3]"], ["raw=[1,2,3]"])
    ).toEqual({
      arr: ["1", "2", "3"], // typed: parsed as JSON array, stringified
      raw: "[1,2,3]", // raw: kept as literal string
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

  test("POST with raw fields keeps values as strings", () => {
    const result = prepareRequestOptions("POST", undefined, ["count=123"]);
    expect(result.body).toEqual({ count: "123" });
  });

  test("POST merges typed and raw fields", () => {
    const result = prepareRequestOptions("POST", ["typed=123"], ["raw=456"]);
    expect(result.body).toEqual({ typed: 123, raw: "456" });
  });

  test("GET includes both typed and raw fields in query params", () => {
    const result = prepareRequestOptions(
      "GET",
      ["status=resolved"],
      ["raw=value"]
    );
    expect(result.params).toEqual({ status: "resolved", raw: "value" });
    expect(result.body).toBeUndefined();
  });

  test("GET with only raw fields creates params", () => {
    const result = prepareRequestOptions("GET", [], ["name=test", "limit=10"]);
    expect(result.params).toEqual({ name: "test", limit: "10" });
    expect(result.body).toBeUndefined();
  });

  test("GET raw fields override typed fields with same key", () => {
    const result = prepareRequestOptions(
      "GET",
      ["value=123"], // typed: parsed as number, stringified back
      ["value=raw-string"] // raw: kept as-is, overrides typed
    );
    expect(result.params).toEqual({ value: "raw-string" });
  });

  test("POST with only raw fields creates body", () => {
    const result = prepareRequestOptions("POST", [], ["data=value"]);
    expect(result.body).toEqual({ data: "value" });
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

describe("readStdin", () => {
  test("reads content from stdin stream", async () => {
    const mockStdin = createMockStdin("hello world");
    const result = await readStdin(mockStdin);
    expect(result).toBe("hello world");
  });

  test("handles empty stdin", async () => {
    const mockStdin = createMockStdin("");
    const result = await readStdin(mockStdin);
    expect(result).toBe("");
  });

  test("handles multi-line content", async () => {
    const content = "line 1\nline 2\nline 3";
    const mockStdin = createMockStdin(content);
    const result = await readStdin(mockStdin);
    expect(result).toBe(content);
  });

  test("handles JSON content", async () => {
    const json = JSON.stringify({ key: "value", num: 42 });
    const mockStdin = createMockStdin(json);
    const result = await readStdin(mockStdin);
    expect(result).toBe(json);
  });
});

describe("buildBodyFromInput", () => {
  test("reads JSON from stdin when path is '-'", async () => {
    const json = JSON.stringify({ status: "resolved" });
    const mockStdin = createMockStdin(json);

    const result = await buildBodyFromInput("-", mockStdin);

    expect(result).toEqual({ status: "resolved" });
  });

  test("reads non-JSON from stdin when path is '-'", async () => {
    const mockStdin = createMockStdin("plain text content");

    const result = await buildBodyFromInput("-", mockStdin);

    expect(result).toBe("plain text content");
  });

  test("reads JSON from file", async () => {
    // Create a temp file using test config dir (which is writable)
    const { createTestConfigDir, cleanupTestDir } = await import(
      "../helpers.js"
    );
    const testDir = await createTestConfigDir("test-api-file-");
    const tempFile = `${testDir}/test-input.json`;
    await Bun.write(tempFile, JSON.stringify({ key: "value" }));

    try {
      const mockStdin = createMockStdin("");
      const result = await buildBodyFromInput(tempFile, mockStdin);
      expect(result).toEqual({ key: "value" });
    } finally {
      await cleanupTestDir(testDir);
    }
  });

  test("reads non-JSON from file", async () => {
    // Create a temp file using test config dir (which is writable)
    const { createTestConfigDir, cleanupTestDir } = await import(
      "../helpers.js"
    );
    const testDir = await createTestConfigDir("test-api-file-");
    const tempFile = `${testDir}/test-input.txt`;
    await Bun.write(tempFile, "plain text from file");

    try {
      const mockStdin = createMockStdin("");
      const result = await buildBodyFromInput(tempFile, mockStdin);
      expect(result).toBe("plain text from file");
    } finally {
      await cleanupTestDir(testDir);
    }
  });

  test("throws for non-existent file", async () => {
    const mockStdin = createMockStdin("");

    await expect(
      buildBodyFromInput("/nonexistent/path/file.json", mockStdin)
    ).rejects.toThrow(/File not found/);
  });
});

describe("handleResponse", () => {
  // Mock process.exit for tests
  const originalExit = process.exit;

  test("outputs body for successful response", () => {
    const writer = createMockWriter();
    const response = {
      status: 200,
      headers: new Headers(),
      body: { success: true },
    };

    handleResponse(writer, response, {
      silent: false,
      verbose: false,
      include: false,
    });

    expect(writer.output).toContain('"success": true');
  });

  test("outputs headers with --include flag", () => {
    const writer = createMockWriter();
    const response = {
      status: 200,
      headers: new Headers({ "Content-Type": "application/json" }),
      body: { data: "test" },
    };

    handleResponse(writer, response, {
      silent: false,
      verbose: false,
      include: true,
    });

    expect(writer.output).toMatch(/^HTTP 200\n/);
    expect(writer.output).toMatch(/content-type:/i);
  });

  test("outputs verbose format with --verbose flag", () => {
    const writer = createMockWriter();
    const response = {
      status: 200,
      headers: new Headers({ "Content-Type": "application/json" }),
      body: { data: "test" },
    };

    handleResponse(writer, response, {
      silent: false,
      verbose: true,
      include: false,
    });

    expect(writer.output).toMatch(/^< HTTP 200\n/);
    expect(writer.output).toMatch(/< content-type:/i);
  });

  test("verbose takes precedence over include", () => {
    const writer = createMockWriter();
    const response = {
      status: 200,
      headers: new Headers(),
      body: "test",
    };

    handleResponse(writer, response, {
      silent: false,
      verbose: true,
      include: true,
    });

    // Should use verbose format (< prefix), not include format
    expect(writer.output).toMatch(/^< HTTP/);
  });

  test("silent mode produces no output for success", () => {
    const writer = createMockWriter();
    const response = {
      status: 200,
      headers: new Headers(),
      body: { data: "test" },
    };

    handleResponse(writer, response, {
      silent: true,
      verbose: false,
      include: false,
    });

    expect(writer.output).toBe("");
  });

  test("silent mode with error calls process.exit(1)", () => {
    const writer = createMockWriter();
    const response = {
      status: 500,
      headers: new Headers(),
      body: { error: "Internal Server Error" },
    };

    let exitCode: number | undefined;
    process.exit = ((code?: number) => {
      exitCode = code;
      throw new Error("process.exit called");
    }) as typeof process.exit;

    try {
      expect(() =>
        handleResponse(writer, response, {
          silent: true,
          verbose: false,
          include: false,
        })
      ).toThrow("process.exit called");
      expect(exitCode).toBe(1);
    } finally {
      process.exit = originalExit;
    }
  });

  test("error response calls process.exit(1) after output", () => {
    const writer = createMockWriter();
    const response = {
      status: 404,
      headers: new Headers(),
      body: { detail: "Not found" },
    };

    let exitCode: number | undefined;
    process.exit = ((code?: number) => {
      exitCode = code;
      throw new Error("process.exit called");
    }) as typeof process.exit;

    try {
      expect(() =>
        handleResponse(writer, response, {
          silent: false,
          verbose: false,
          include: false,
        })
      ).toThrow("process.exit called");
      expect(exitCode).toBe(1);
      // Should have output the body before exiting
      expect(writer.output).toContain("Not found");
    } finally {
      process.exit = originalExit;
    }
  });
});
