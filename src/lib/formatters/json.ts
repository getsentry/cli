/**
 * JSON output utilities
 *
 * Provides formatting, field filtering, and streaming helpers for
 * `--json` output across all CLI commands.
 */

import type { Writer } from "../../types/index.js";

/**
 * Get a nested value from an object using a dot-notated path.
 *
 * Returns `{ found: true, value }` when the path resolves, even if the
 * leaf value is `undefined` or `null`. Returns `{ found: false }` when
 * any intermediate segment is not an object (or is missing).
 *
 * @param obj - Source object to traverse
 * @param path - Dot-separated key path (e.g. `"contexts.trace.traceId"`)
 */
function getNestedValue(
  obj: unknown,
  path: string
): { found: true; value: unknown } | { found: false } {
  let current: unknown = obj;
  for (const segment of path.split(".")) {
    if (
      current === null ||
      current === undefined ||
      typeof current !== "object"
    ) {
      return { found: false };
    }
    if (!Object.hasOwn(current, segment)) {
      return { found: false };
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return { found: true, value: current };
}

/**
 * Set a nested value in an object, creating intermediate objects as needed.
 *
 * @param target - Target object to write into (mutated in place)
 * @param path - Dot-separated key path
 * @param value - Value to set at the leaf
 */
function setNestedValue(
  target: Record<string, unknown>,
  path: string,
  value: unknown
): void {
  const segments = path.split(".");
  let current: Record<string, unknown> = target;
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments.at(i);
    if (seg === undefined) {
      continue;
    }
    if (
      current[seg] === undefined ||
      current[seg] === null ||
      typeof current[seg] !== "object"
    ) {
      current[seg] = {};
    }
    current = current[seg] as Record<string, unknown>;
  }
  const lastSeg = segments.at(-1);
  if (lastSeg !== undefined) {
    current[lastSeg] = value;
  }
}

/**
 * Filter an object (or array of objects) to include only the specified fields.
 *
 * Supports dot-notation for nested field access:
 * ```ts
 * filterFields({ a: 1, b: { c: 2, d: 3 } }, ["a", "b.c"])
 * // → { a: 1, b: { c: 2 } }
 * ```
 *
 * When `data` is an array, each element is filtered independently.
 * Fields that don't exist in the source are silently skipped.
 *
 * @param data - Source data to filter
 * @param fields - List of field paths to include (dot-separated for nesting)
 * @returns Filtered copy of the data — original is never mutated
 */
export function filterFields<T>(data: T, fields: string[]): Partial<T> {
  if (Array.isArray(data)) {
    return data.map((item) =>
      filterFields(item, fields)
    ) as unknown as Partial<T>;
  }

  if (data === null || data === undefined || typeof data !== "object") {
    return data as Partial<T>;
  }

  const result: Record<string, unknown> = {};

  for (const field of fields) {
    const lookup = getNestedValue(data, field);
    if (lookup.found) {
      setNestedValue(result, field, lookup.value);
    }
  }

  return result as Partial<T>;
}

/**
 * Parse a comma-separated fields string into a trimmed, deduplicated array.
 *
 * Handles whitespace around commas and filters out empty segments:
 * ```ts
 * parseFieldsList("id, title , status")  // → ["id", "title", "status"]
 * parseFieldsList("id,,title")           // → ["id", "title"]
 * ```
 *
 * @param input - Raw `--fields` flag value
 * @returns Parsed field path list (may be empty if input is all whitespace/commas)
 */
export function parseFieldsList(input: string): string[] {
  return [
    ...new Set(
      input
        .split(",")
        .map((f) => f.trim())
        .filter(Boolean)
    ),
  ];
}

/**
 * Format data as pretty-printed JSON
 */
export function formatJson<T>(data: T): string {
  return JSON.stringify(data, null, 2);
}

/**
 * Output JSON to a write stream.
 *
 * When `fields` is provided, the output is filtered to include only
 * the specified field paths before serialization. This supports the
 * `--fields` flag for reducing token consumption in agent workflows.
 *
 * @param stream - Output writer (typically stdout)
 * @param data - Data to serialize
 * @param fields - Optional field paths to include (dot-notation supported)
 */
export function writeJson<T>(stream: Writer, data: T, fields?: string[]): void {
  const output =
    fields && fields.length > 0 ? filterFields(data, fields) : data;
  stream.write(`${formatJson(output)}\n`);
}

/**
 * Output a paginated list as JSON with metadata wrapper.
 *
 * Wraps an array of items in a `{ data, hasMore, nextCursor? }` envelope.
 * When `fields` is provided, filtering is applied to each **array element**
 * inside `data`, not to the wrapper itself. This ensures that
 * `--fields id,title` filters each item, while metadata keys (`hasMore`,
 * `nextCursor`) are always preserved.
 *
 * @param stream - Output writer (typically stdout)
 * @param items - Array of items to wrap in `data`
 * @param options - Pagination metadata and optional field filtering
 *
 * @example
 * ```ts
 * // Without fields: full output
 * writeJsonList(stdout, issues, { hasMore: true, nextCursor: "abc" });
 * // → { "data": [...], "nextCursor": "abc", "hasMore": true }
 *
 * // With fields: each item filtered, wrapper preserved
 * writeJsonList(stdout, issues, { hasMore: true, fields: ["id", "title"] });
 * // → { "data": [{ "id": "1", "title": "Bug" }, ...], "hasMore": true }
 * ```
 */
export function writeJsonList<T>(
  stream: Writer,
  items: T[],
  options: {
    hasMore: boolean;
    nextCursor?: string | null;
    errors?: unknown[];
    fields?: string[];
    /** Arbitrary extra metadata to include in the wrapper (e.g. `{ hint }`) */
    extra?: Record<string, unknown>;
  }
): void {
  const { hasMore, nextCursor, errors, fields, extra } = options;
  const filtered =
    fields && fields.length > 0
      ? items.map((item) => filterFields(item, fields))
      : items;

  const output: Record<string, unknown> = { data: filtered, hasMore };
  if (nextCursor !== null && nextCursor !== undefined && nextCursor !== "") {
    output.nextCursor = nextCursor;
  }
  if (errors && errors.length > 0) {
    output.errors = errors;
  }
  if (extra) {
    Object.assign(output, extra);
  }

  stream.write(`${formatJson(output)}\n`);
}
