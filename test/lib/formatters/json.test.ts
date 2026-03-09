/**
 * Unit tests for JSON formatting and field filtering.
 */

import { describe, expect, test } from "bun:test";
import {
  filterFields,
  formatJson,
  parseFieldsList,
  writeJson,
} from "../../../src/lib/formatters/json.js";

/**
 * Helper: cast to Record so filterFields calls don't fight
 * TypeScript's strict `Partial<T>` return type on `toEqual`.
 */
function filter(data: unknown, fields: string[]): unknown {
  return filterFields(data, fields);
}

// ---------------------------------------------------------------------------
// filterFields — unit tests for specific behaviors
// ---------------------------------------------------------------------------

describe("filterFields", () => {
  test("picks top-level fields", () => {
    expect(
      filter({ id: 1, title: "bug", status: "open", count: 42 }, [
        "id",
        "title",
      ])
    ).toEqual({
      id: 1,
      title: "bug",
    });
  });

  test("picks nested fields via dot-notation", () => {
    const data = {
      id: 1,
      metadata: { type: "error", value: "ReferenceError" },
      contexts: { trace: { traceId: "abc" } },
    };
    expect(
      filter(data, ["id", "metadata.value", "contexts.trace.traceId"])
    ).toEqual({
      id: 1,
      metadata: { value: "ReferenceError" },
      contexts: { trace: { traceId: "abc" } },
    });
  });

  test("silently skips missing fields", () => {
    expect(
      filter({ id: 1, title: "bug" }, ["id", "nonexistent", "also.missing"])
    ).toEqual({
      id: 1,
    });
  });

  test("handles empty fields list", () => {
    expect(filter({ a: 1, b: 2 }, [])).toEqual({});
  });

  test("preserves null values", () => {
    expect(filter({ id: 1, value: null }, ["id", "value"])).toEqual({
      id: 1,
      value: null,
    });
  });

  test("preserves undefined values when key exists", () => {
    expect(filter({ id: 1, value: undefined }, ["id", "value"])).toEqual({
      id: 1,
      value: undefined,
    });
  });

  test("handles arrays of objects", () => {
    const data = [
      { id: 1, title: "first", extra: true },
      { id: 2, title: "second", extra: false },
    ];
    expect(filter(data, ["id", "title"])).toEqual([
      { id: 1, title: "first" },
      { id: 2, title: "second" },
    ]);
  });

  test("handles empty array", () => {
    expect(filter([], ["id"])).toEqual([]);
  });

  test("stops at null intermediate in dot-path", () => {
    expect(filter({ a: { b: null } }, ["a.b.c"])).toEqual({});
  });

  test("stops at primitive intermediate in dot-path", () => {
    expect(filter({ a: { b: 42 } }, ["a.b.c"])).toEqual({});
  });

  test("passes through null data unchanged", () => {
    expect(filter(null, ["id"])).toBeNull();
  });

  test("passes through undefined data unchanged", () => {
    expect(filter(undefined, ["id"])).toBeUndefined();
  });

  test("passes through string data unchanged", () => {
    expect(filter("hello", ["length"])).toBe("hello");
  });

  test("passes through number data unchanged", () => {
    expect(filter(42, ["id"])).toBe(42);
  });

  test("merges nested paths into shared parents", () => {
    expect(
      filter({ user: { name: "Alice", email: "alice@example.com", age: 30 } }, [
        "user.name",
        "user.email",
      ])
    ).toEqual({
      user: { name: "Alice", email: "alice@example.com" },
    });
  });

  test("handles boolean values in objects", () => {
    expect(
      filter({ active: true, deleted: false, name: "test" }, [
        "active",
        "deleted",
      ])
    ).toEqual({
      active: true,
      deleted: false,
    });
  });

  test("handles nested array values", () => {
    expect(
      filter({ id: 1, tags: ["bug", "critical"], title: "test" }, [
        "id",
        "tags",
      ])
    ).toEqual({
      id: 1,
      tags: ["bug", "critical"],
    });
  });
});

// ---------------------------------------------------------------------------
// parseFieldsList — unit tests
// ---------------------------------------------------------------------------

describe("parseFieldsList", () => {
  test("parses comma-separated fields", () => {
    expect(parseFieldsList("id,title,status")).toEqual([
      "id",
      "title",
      "status",
    ]);
  });

  test("trims whitespace around fields", () => {
    expect(parseFieldsList("  id , title , status  ")).toEqual([
      "id",
      "title",
      "status",
    ]);
  });

  test("handles dot-notation fields", () => {
    expect(parseFieldsList("id,metadata.value,contexts.trace.traceId")).toEqual(
      ["id", "metadata.value", "contexts.trace.traceId"]
    );
  });

  test("deduplicates fields", () => {
    expect(parseFieldsList("id,title,id,title")).toEqual(["id", "title"]);
  });

  test("filters empty segments from double commas", () => {
    expect(parseFieldsList("id,,title")).toEqual(["id", "title"]);
  });

  test("handles single field", () => {
    expect(parseFieldsList("id")).toEqual(["id"]);
  });

  test("returns empty array for empty string", () => {
    expect(parseFieldsList("")).toEqual([]);
  });

  test("returns empty array for whitespace-only", () => {
    expect(parseFieldsList("   ")).toEqual([]);
  });

  test("returns empty array for commas-only", () => {
    expect(parseFieldsList(",,,")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// writeJson with fields — integration tests
// ---------------------------------------------------------------------------

describe("writeJson with fields", () => {
  /** Capture stdout writes */
  function capture(): {
    writer: { write: (s: string) => void };
    output: () => string;
  } {
    let buf = "";
    return {
      writer: {
        write: (s: string) => {
          buf += s;
        },
      },
      output: () => buf,
    };
  }

  test("without fields: outputs full object", () => {
    const { writer, output } = capture();
    const data = { id: 1, title: "bug", status: "open" };
    writeJson(writer, data);
    expect(JSON.parse(output())).toEqual(data);
  });

  test("with fields: outputs filtered object", () => {
    const { writer, output } = capture();
    writeJson(writer, { id: 1, title: "bug", status: "open", extra: true }, [
      "id",
      "title",
    ]);
    expect(JSON.parse(output())).toEqual({ id: 1, title: "bug" });
  });

  test("with empty fields array: outputs full object", () => {
    const { writer, output } = capture();
    const data = { id: 1, title: "bug" };
    writeJson(writer, data, []);
    expect(JSON.parse(output())).toEqual(data);
  });

  test("with undefined fields: outputs full object", () => {
    const { writer, output } = capture();
    const data = { id: 1, title: "bug" };
    writeJson(writer, data, undefined);
    expect(JSON.parse(output())).toEqual(data);
  });

  test("with dot-notation fields: outputs nested subset", () => {
    const { writer, output } = capture();
    writeJson(
      writer,
      {
        issue: { id: 1, title: "bug" },
        event: { id: "abc", contexts: { trace: { traceId: "def" } } },
      },
      ["issue.id", "event.contexts.trace.traceId"]
    );
    expect(JSON.parse(output())).toEqual({
      issue: { id: 1 },
      event: { contexts: { trace: { traceId: "def" } } },
    });
  });

  test("with array data: filters each element", () => {
    const { writer, output } = capture();
    writeJson(
      writer,
      [
        { id: 1, title: "first", extra: true },
        { id: 2, title: "second", extra: false },
      ],
      ["id", "title"]
    );
    expect(JSON.parse(output())).toEqual([
      { id: 1, title: "first" },
      { id: 2, title: "second" },
    ]);
  });
});

// ---------------------------------------------------------------------------
// formatJson — basic sanity
// ---------------------------------------------------------------------------

describe("formatJson", () => {
  test("pretty-prints with 2-space indentation", () => {
    expect(formatJson({ a: 1 })).toBe('{\n  "a": 1\n}');
  });

  test("handles null", () => {
    expect(formatJson(null)).toBe("null");
  });

  test("handles arrays", () => {
    expect(formatJson([1, 2])).toBe("[\n  1,\n  2\n]");
  });
});
