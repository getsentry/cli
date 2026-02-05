/**
 * Property-Based Tests for API Command Parsing Functions
 *
 * Uses fast-check to verify invariants of pure parsing functions
 * that are difficult to exhaustively test with example-based tests.
 */

import { describe, expect, test } from "bun:test";
import {
  array,
  constantFrom,
  assert as fcAssert,
  oneof,
  property,
  stringMatching,
  tuple,
} from "fast-check";
import {
  normalizeEndpoint,
  parseFieldKey,
  parseFieldValue,
  parseMethod,
  setNestedValue,
} from "../../src/commands/api.js";
import { DEFAULT_NUM_RUNS } from "../model-based/helpers.js";

// Arbitraries for generating valid inputs

/** Valid HTTP methods (any case) */
const validMethodArb = constantFrom(
  "GET",
  "POST",
  "PUT",
  "DELETE",
  "PATCH",
  "get",
  "post",
  "put",
  "delete",
  "patch",
  "Get",
  "pOsT"
);

/** Invalid HTTP methods */
const invalidMethodArb = constantFrom(
  "HEAD",
  "OPTIONS",
  "CONNECT",
  "TRACE",
  "INVALID",
  "",
  "GETS",
  "POSTING"
);

/** Path segments (alphanumeric with hyphens, no slashes) */
const pathSegmentArb = stringMatching(/^[a-z0-9][a-z0-9-]{0,20}[a-z0-9]$/);

/** Simple endpoint paths without query strings */
const simplePathArb = array(pathSegmentArb, { minLength: 1, maxLength: 5 }).map(
  (segments) => segments.join("/")
);

/** Query string (starts with ?, contains valid chars) */
const queryStringArb = stringMatching(/^\?[a-zA-Z0-9_=&%-]{1,50}$/).map((q) =>
  q.length > 1 ? q : "?q=1"
);

/** Endpoint with optional query string */
const endpointArb = tuple(
  simplePathArb,
  oneof(constantFrom(""), queryStringArb)
).map(([path, query]) => path + query);

/** Valid field key base (alphanumeric with underscores) */
const fieldKeyBaseArb = stringMatching(/^[a-zA-Z_][a-zA-Z0-9_]{0,15}$/);

/** Bracket segment (alphanumeric key or empty for array push) */
const bracketSegmentArb = oneof(
  fieldKeyBaseArb.map((k) => `[${k}]`),
  constantFrom("[]") // array push
);

/** Valid nested field key like "user[name]" or "tags[]" */
const nestedFieldKeyArb = tuple(
  fieldKeyBaseArb,
  array(bracketSegmentArb, { minLength: 0, maxLength: 3 })
).map(([base, brackets]) => {
  // Ensure empty brackets only at end
  const emptyIdx = brackets.indexOf("[]");
  if (emptyIdx !== -1 && emptyIdx < brackets.length - 1) {
    // Move empty bracket to end
    const filtered = brackets.filter((b) => b !== "[]");
    return `${base}${filtered.join("")}[]`;
  }
  return `${base}${brackets.join("")}`;
});

/** JSON-parseable values */
const jsonValueArb = oneof(
  constantFrom(
    "true",
    "false",
    "null",
    "123",
    "3.14",
    '"hello"',
    "[1,2,3]",
    '{"a":1}'
  )
);

/**
 * Non-JSON string values that won't be parsed as JSON.
 * Excludes: "true", "false", "null", pure numbers, and anything starting with JSON delimiters.
 * Uses a prefix that ensures the string can't be valid JSON.
 */
const plainStringArb = stringMatching(/^[a-zA-Z][a-zA-Z0-9 ]{0,20}$/).filter(
  (s) =>
    s !== "true" &&
    s !== "false" &&
    s !== "null" &&
    !/^\d+(\.\d+)?$/.test(s) &&
    !s.startsWith('"') &&
    !s.startsWith("[") &&
    !s.startsWith("{")
);

describe("normalizeEndpoint properties", () => {
  test("result never has leading slash (except for root)", async () => {
    await fcAssert(
      property(endpointArb, (endpoint) => {
        const result = normalizeEndpoint(endpoint);
        // Root "/" is the only case where leading slash is allowed
        if (result !== "/") {
          expect(result.startsWith("/")).toBe(false);
        }
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("result always has trailing slash before query string", async () => {
    await fcAssert(
      property(endpointArb, (endpoint) => {
        const result = normalizeEndpoint(endpoint);
        const queryIdx = result.indexOf("?");

        if (queryIdx === -1) {
          // No query string - must end with /
          expect(result.endsWith("/")).toBe(true);
        } else {
          // Has query string - char before ? must be /
          expect(result[queryIdx - 1]).toBe("/");
        }
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("query string is always preserved unchanged", async () => {
    await fcAssert(
      property(tuple(simplePathArb, queryStringArb), ([path, query]) => {
        const input = path + query;
        const result = normalizeEndpoint(input);

        // Query string should be preserved exactly
        expect(result.endsWith(query)).toBe(true);
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("idempotent: normalizing twice equals normalizing once", async () => {
    await fcAssert(
      property(endpointArb, (endpoint) => {
        const once = normalizeEndpoint(endpoint);
        const twice = normalizeEndpoint(once);
        expect(twice).toBe(once);
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("leading slash is always stripped", async () => {
    await fcAssert(
      property(simplePathArb, (path) => {
        const withLeading = `/${path}`;
        const withoutLeading = path;

        const resultWith = normalizeEndpoint(withLeading);
        const resultWithout = normalizeEndpoint(withoutLeading);

        expect(resultWith).toBe(resultWithout);
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });
});

describe("parseMethod properties", () => {
  test("valid methods always succeed and return uppercase", async () => {
    await fcAssert(
      property(validMethodArb, (method) => {
        const result = parseMethod(method);
        expect(result).toBe(method.toUpperCase() as typeof result);
        expect(["GET", "POST", "PUT", "DELETE", "PATCH"]).toContain(
          result as string
        );
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("invalid methods always throw", async () => {
    await fcAssert(
      property(invalidMethodArb, (method) => {
        expect(() => parseMethod(method)).toThrow(/Invalid method/);
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("result is always uppercase", async () => {
    await fcAssert(
      property(validMethodArb, (method) => {
        const result = parseMethod(method);
        expect(result).toBe((result as string).toUpperCase() as typeof result);
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });
});

describe("parseFieldKey properties", () => {
  test("first segment is always the base key", async () => {
    await fcAssert(
      property(nestedFieldKeyArb, (key) => {
        const segments = parseFieldKey(key);
        // First segment should be the base (before any brackets)
        const expectedBase = key.split("[")[0];
        expect(segments[0]).toBe(expectedBase);
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("empty key always throws", async () => {
    expect(() => parseFieldKey("")).toThrow(/Invalid field key format/);
  });

  test("key starting with bracket always throws", async () => {
    await fcAssert(
      property(fieldKeyBaseArb, (key) => {
        expect(() => parseFieldKey(`[${key}]`)).toThrow(
          /Invalid field key format/
        );
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("segment count equals bracket count plus one", async () => {
    await fcAssert(
      property(nestedFieldKeyArb, (key) => {
        const segments = parseFieldKey(key);
        const bracketCount = (key.match(/\[/g) || []).length;
        expect(segments.length).toBe(bracketCount + 1);
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });
});

describe("setNestedValue security properties", () => {
  test("__proto__ at any depth throws", async () => {
    await fcAssert(
      property(fieldKeyBaseArb, (key) => {
        const obj: Record<string, unknown> = {};

        // __proto__ as base key
        expect(() => setNestedValue(obj, "__proto__", "value")).toThrow(
          /"__proto__" is not allowed/
        );

        // __proto__ in brackets
        expect(() => setNestedValue(obj, `${key}[__proto__]`, "value")).toThrow(
          /"__proto__" is not allowed/
        );

        // __proto__ deeply nested
        expect(() =>
          setNestedValue(obj, `${key}[nested][__proto__]`, "value")
        ).toThrow(/"__proto__" is not allowed/);
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("constructor at any depth throws", async () => {
    await fcAssert(
      property(fieldKeyBaseArb, (key) => {
        const obj: Record<string, unknown> = {};

        expect(() => setNestedValue(obj, "constructor", "value")).toThrow(
          /"constructor" is not allowed/
        );

        expect(() =>
          setNestedValue(obj, `${key}[constructor]`, "value")
        ).toThrow(/"constructor" is not allowed/);
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("prototype at any depth throws", async () => {
    await fcAssert(
      property(fieldKeyBaseArb, (key) => {
        const obj: Record<string, unknown> = {};

        expect(() => setNestedValue(obj, "prototype", "value")).toThrow(
          /"prototype" is not allowed/
        );

        expect(() => setNestedValue(obj, `${key}[prototype]`, "value")).toThrow(
          /"prototype" is not allowed/
        );
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("no prototype pollution occurs even if error handling fails", async () => {
    // Verify that even after attempting dangerous operations, no pollution occurred
    const testObj = {};
    const dangerousKeys = [
      "__proto__[polluted]",
      "constructor[prototype][polluted]",
    ];

    for (const key of dangerousKeys) {
      try {
        setNestedValue({}, key, true);
      } catch {
        // Expected to throw
      }
    }

    // Verify no pollution
    expect((testObj as Record<string, unknown>).polluted).toBeUndefined();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe("setNestedValue behavior properties", () => {
  test("simple key sets top-level value", async () => {
    await fcAssert(
      property(tuple(fieldKeyBaseArb, plainStringArb), ([key, value]) => {
        const obj: Record<string, unknown> = {};
        setNestedValue(obj, key, value);
        expect(obj[key]).toBe(value);
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("nested key creates nested structure", async () => {
    await fcAssert(
      property(
        tuple(fieldKeyBaseArb, fieldKeyBaseArb, plainStringArb),
        ([base, nested, value]) => {
          const obj: Record<string, unknown> = {};
          setNestedValue(obj, `${base}[${nested}]`, value);

          expect(obj[base]).toBeDefined();
          expect(typeof obj[base]).toBe("object");
          expect((obj[base] as Record<string, unknown>)[nested]).toBe(value);
        }
      ),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("array push syntax creates array", async () => {
    await fcAssert(
      property(tuple(fieldKeyBaseArb, plainStringArb), ([key, value]) => {
        const obj: Record<string, unknown> = {};
        setNestedValue(obj, `${key}[]`, value);

        expect(Array.isArray(obj[key])).toBe(true);
        expect((obj[key] as unknown[])[0]).toBe(value);
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("multiple array pushes append to array", async () => {
    await fcAssert(
      property(
        tuple(fieldKeyBaseArb, plainStringArb, plainStringArb),
        ([key, value1, value2]) => {
          const obj: Record<string, unknown> = {};
          setNestedValue(obj, `${key}[]`, value1);
          setNestedValue(obj, `${key}[]`, value2);

          expect(Array.isArray(obj[key])).toBe(true);
          const arr = obj[key] as unknown[];
          expect(arr.length).toBe(2);
          expect(arr[0]).toBe(value1);
          expect(arr[1]).toBe(value2);
        }
      ),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("empty brackets in middle of path throws", async () => {
    await fcAssert(
      property(tuple(fieldKeyBaseArb, fieldKeyBaseArb), ([base, end]) => {
        const obj: Record<string, unknown> = {};
        expect(() => setNestedValue(obj, `${base}[][${end}]`, "value")).toThrow(
          /empty brackets \[\] can only appear at the end/
        );
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });
});

describe("parseFieldValue properties", () => {
  test("valid JSON is parsed correctly", async () => {
    await fcAssert(
      property(jsonValueArb, (jsonStr) => {
        const result = parseFieldValue(jsonStr);
        const expected = JSON.parse(jsonStr);
        expect(result).toEqual(expected);
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("non-JSON strings are returned as-is", async () => {
    await fcAssert(
      property(plainStringArb, (str) => {
        const result = parseFieldValue(str);
        expect(result).toBe(str);
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("empty string returns empty string", () => {
    expect(parseFieldValue("")).toBe("");
  });

  test("JSON round-trip: stringify then parse returns equivalent value", async () => {
    const values = [true, false, null, 123, 3.14, "hello", [1, 2, 3], { a: 1 }];

    for (const value of values) {
      const jsonStr = JSON.stringify(value);
      const result = parseFieldValue(jsonStr);
      expect(result).toEqual(value);
    }
  });
});
