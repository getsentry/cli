/**
 * sentry api
 *
 * Make raw authenticated API requests to Sentry.
 * Similar to 'gh api' for GitHub.
 */

import type { SentryContext } from "../context.js";
import { buildSearchParams, rawApiRequest } from "../lib/api-client.js";
import { buildCommand } from "../lib/command.js";
import { ValidationError } from "../lib/errors.js";
import { writeJson } from "../lib/formatters/json.js";
import { validateEndpoint } from "../lib/input-validation.js";
import { getDefaultSdkConfig } from "../lib/sentry-client.js";
import type { Writer } from "../types/index.js";

type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

type ApiFlags = {
  readonly method: HttpMethod;
  readonly data?: string;
  readonly field?: string[];
  readonly "raw-field"?: string[];
  readonly header?: string[];
  readonly input?: string;
  readonly include: boolean;
  readonly silent: boolean;
  readonly verbose: boolean;
  readonly "dry-run": boolean;
  /** Injected by buildCommand via output: { json: true } */
  readonly json: boolean;
  /** Injected by buildCommand via output: { json: true } */
  readonly fields?: string[];
};

// Request Parsing

const VALID_METHODS: HttpMethod[] = ["GET", "POST", "PUT", "DELETE", "PATCH"];

/**
 * Read all data from stdin as a string.
 * Uses Bun's native stream handling for efficiency.
 * @internal Exported for testing
 */
export async function readStdin(
  stdin: NodeJS.ReadStream & { fd: 0 }
): Promise<string> {
  const chunks: Buffer[] = [];

  for await (const chunk of stdin) {
    chunks.push(Buffer.from(chunk));
  }

  return Buffer.concat(chunks).toString("utf-8");
}

/**
 * Parse and validate HTTP method from string.
 *
 * @param value - HTTP method string (case-insensitive)
 * @returns Normalized uppercase HTTP method
 * @throws {Error} When method is not one of GET, POST, PUT, DELETE, PATCH
 * @internal Exported for testing
 */
export function parseMethod(value: string): HttpMethod {
  const upper = value.toUpperCase();
  if (!VALID_METHODS.includes(upper as HttpMethod)) {
    throw new Error(
      `Invalid method: ${value}. Must be one of: ${VALID_METHODS.join(", ")}`
    );
  }
  return upper as HttpMethod;
}

/**
 * Normalize an API endpoint to ensure the path has a trailing slash.
 * Sentry API requires trailing slashes on endpoints.
 * Handles query strings correctly by only modifying the path portion.
 *
 * @param endpoint - API endpoint path (may include query string)
 * @returns Endpoint with trailing slash on path, query string preserved
 * @internal Exported for testing
 */
export function normalizeEndpoint(endpoint: string): string {
  // Reject path traversal and control characters before processing
  validateEndpoint(endpoint);

  // Remove leading slash if present (rawApiRequest handles the base URL)
  const trimmed = endpoint.startsWith("/") ? endpoint.slice(1) : endpoint;

  // Split path and query string
  const queryIndex = trimmed.indexOf("?");
  if (queryIndex === -1) {
    // No query string - just ensure trailing slash
    return trimmed.endsWith("/") ? trimmed : `${trimmed}/`;
  }

  // Has query string - add trailing slash to path only
  const path = trimmed.substring(0, queryIndex);
  const query = trimmed.substring(queryIndex);
  const normalizedPath = path.endsWith("/") ? path : `${path}/`;
  return `${normalizedPath}${query}`;
}

/**
 * Parse a field value, attempting JSON parse first.
 *
 * @param value - Raw string value to parse
 * @returns Parsed JSON value, or original string if not valid JSON
 * @internal Exported for testing
 */
export function parseFieldValue(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/** Keys that could cause prototype pollution if used in nested object assignment */
const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/** Regex to match field key format: baseKey followed by zero or more [bracket] segments */
const FIELD_KEY_REGEX = /^([^[\]]+)((?:\[[^[\]]*\])*)$/;

/** Regex to extract bracket contents from a field key */
const BRACKET_CONTENTS_REGEX = /\[([^[\]]*)\]/g;

/**
 * Parse a field key into path segments.
 * Supports bracket notation: "user[name]" -> ["user", "name"]
 * Supports array syntax: "tags[]" -> ["tags", ""]
 * Supports deep nesting: "a[b][c]" -> ["a", "b", "c"]
 *
 * @param key - Field key with optional bracket notation
 * @returns Array of path segments
 * @throws {Error} When key format is invalid
 * @internal Exported for testing
 */
export function parseFieldKey(key: string): string[] {
  const match = key.match(FIELD_KEY_REGEX);
  if (!match?.[1]) {
    throw new Error(`Invalid field key format: ${key}`);
  }

  const baseKey = match[1];
  const brackets = match[2] ?? "";

  // Extract bracket contents: "[name][age]" -> ["name", "age"]
  // Empty brackets [] result in empty string "" for array push
  const segments: string[] = brackets
    ? [...brackets.matchAll(BRACKET_CONTENTS_REGEX)].map((m) => m[1] ?? "")
    : [];

  return [baseKey, ...segments];
}

/**
 * Validate path segments for security and correctness.
 * @throws {Error} When a segment is __proto__, constructor, or prototype
 * @throws {Error} When empty brackets appear before the last segment (e.g., a[][b])
 */
function validatePathSegments(path: string[]): void {
  for (let i = 0; i < path.length; i++) {
    const segment = path[i] as string; // Safe: loop bounds guarantee index exists

    // Check for prototype pollution
    if (DANGEROUS_KEYS.has(segment)) {
      throw new Error(`Invalid field key: "${segment}" is not allowed`);
    }

    // Empty brackets ("") are only valid at the end of the path (array push syntax)
    // Reject patterns like a[][b] which would silently lose data
    if (segment === "" && i < path.length - 1) {
      throw new Error(
        "Invalid field key: empty brackets [] can only appear at the end of a key"
      );
    }
  }
}

/**
 * Get a human-readable type name for error messages.
 * Returns "array" for arrays, "map" for objects, and typeof for primitives.
 */
function getTypeName(value: unknown): string {
  if (Array.isArray(value)) {
    return "array";
  }
  if (value !== null && typeof value === "object") {
    return "map";
  }
  return typeof value;
}

/**
 * Format path segments into a bracket-notation string for error messages.
 * E.g., ["user", "name"] at index 1 -> "user[name]"
 */
function formatPathForError(path: string[], endIndex: number): string {
  const segments = path.slice(0, endIndex + 1);
  if (segments.length === 1) {
    return segments[0] ?? "";
  }
  return `${segments[0]}[${segments.slice(1).join("][")}]`;
}

/**
 * Check if value can be traversed into (is a plain object, not array or primitive).
 */
function isTraversableObject(value: unknown): boolean {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Validate that existing value is compatible with expected traversal type.
 * @throws {Error} When type conflict is detected
 */
function validateTypeCompatibility(
  existing: unknown,
  expectsArray: boolean,
  path: string[],
  index: number
): void {
  const pathStr = formatPathForError(path, index);

  if (expectsArray && !Array.isArray(existing)) {
    throw new Error(
      `expected array type under "${pathStr}", got ${getTypeName(existing)}`
    );
  }

  if (!(expectsArray || isTraversableObject(existing))) {
    throw new Error(
      `expected map type under "${pathStr}", got ${getTypeName(existing)}`
    );
  }
}

/**
 * Navigate/create nested structure to the parent of the target key.
 * @returns The object/array that will contain the final value
 * @throws {Error} When attempting to traverse into a non-object (type conflict)
 */
function navigateToParent(
  obj: Record<string, unknown>,
  path: string[]
): unknown {
  let current: unknown = obj;

  for (let i = 0; i < path.length - 1; i++) {
    const segment = path[i] as string; // Safe: loop bounds guarantee index exists
    const nextSegment = path[i + 1] as string;

    // Empty segment only at end for arrays - skip if encountered mid-path
    if (segment === "") {
      continue;
    }

    const currentObj = current as Record<string, unknown>;
    const expectsArray = nextSegment === "";

    if (Object.hasOwn(currentObj, segment)) {
      validateTypeCompatibility(currentObj[segment], expectsArray, path, i);
    } else {
      currentObj[segment] = expectsArray ? [] : {};
    }

    current = currentObj[segment];
  }

  return current;
}

/**
 * Set a nested value in an object using bracket notation key.
 * Creates intermediate objects or arrays as needed.
 *
 * Supports:
 * - Simple keys: "name" -> { name: value }
 * - Nested objects: "user[name]" -> { user: { name: value } }
 * - Deep nesting: "a[b][c]" -> { a: { b: { c: value } } }
 * - Array push: "tags[]" with value -> { tags: [value] }
 * - Empty array: "tags[]" with undefined -> { tags: [] }
 *
 * @param obj - Target object to modify
 * @param key - Bracket-notation key (e.g., "user[name]", "tags[]")
 * @param value - Value to set (undefined for empty array initialization)
 * @throws {Error} When key contains dangerous segments (__proto__, constructor, prototype)
 * @internal Exported for testing
 */
export function setNestedValue(
  obj: Record<string, unknown>,
  key: string,
  value: unknown
): void {
  const path = parseFieldKey(key);
  validatePathSegments(path);

  const current = navigateToParent(obj, path);
  const lastSegment = path.at(-1);

  // Array push syntax: key[]=value
  if (lastSegment === "" && Array.isArray(current) && value !== undefined) {
    current.push(value);
  } else if (lastSegment !== undefined && lastSegment !== "") {
    (current as Record<string, unknown>)[lastSegment] = value;
  }
}

/**
 * Auto-correct fields that use ':' instead of '=' as the separator, and warn
 * the user on stderr.
 *
 * This recovers from a common mistake where users write Sentry search-query
 * style syntax (`-F status:resolved`) instead of the required key=value form
 * (`-F status=resolved`).  The correction is safe to apply unconditionally
 * because this function is only called for fields that have already been
 * confirmed to contain no '=' — at that point the request would fail anyway.
 *
 * Splitting on the *first* ':' is intentional so that values that themselves
 * contain colons (e.g. ISO timestamps, URLs) are preserved intact:
 *   `since:2026-02-25T11:20:00` → key=`since`, value=`2026-02-25T11:20:00`
 *
 * Fields with no ':' (truly uncorrectable) are returned unchanged so that the
 * downstream parser can throw its normal error.
 *
 * @param fields - Raw field strings from --field or --raw-field flags
 * @param stderr - Writer to emit warnings on (command's stderr)
 * @returns New array with corrected field strings (or the original array if no
 *   corrections were needed)
 * @internal Exported for testing
 */
export function normalizeFields(
  fields: string[] | undefined,
  stderr: Writer
): string[] | undefined {
  if (!fields || fields.length === 0) {
    return fields;
  }

  return fields.map((field) => {
    // Already valid: has '=' or is the empty-array syntax "key[]"
    if (field.includes("=") || field.endsWith("[]")) {
      return field;
    }

    // JSON-shaped strings (starting with { or [) must not be "corrected" —
    // the colon inside is JSON syntax, not a key:value separator.  Let the
    // downstream pipeline handle it (extractJsonBody or processField error).
    if (field.startsWith("{") || field.startsWith("[")) {
      return field;
    }

    const colonIndex = field.indexOf(":");
    // ':' must exist and not be the very first character (that would make an
    // empty key, which the parser rejects regardless)
    if (colonIndex > 0) {
      const key = field.substring(0, colonIndex);
      const value = field.substring(colonIndex + 1);
      const corrected = `${key}=${value}`;
      stderr.write(
        `warning: field '${field}' looks like it uses ':' instead of '=' — interpreting as '${corrected}'\n`
      );
      return corrected;
    }

    // No correction possible; let the downstream parser throw.
    return field;
  });
}

/**
 * Process a single field string and set its value in the result object.
 * @param result - Target object to modify
 * @param field - Field string in "key=value" or "key[]" format
 * @param raw - If true, keep value as string (no JSON parsing)
 * @throws {ValidationError} When field format is invalid
 */
function processField(
  result: Record<string, unknown>,
  field: string,
  raw: boolean
): void {
  const eqIndex = field.indexOf("=");

  // Handle empty array syntax: "key[]" without "="
  if (eqIndex === -1) {
    if (field.endsWith("[]")) {
      setNestedValue(result, field, undefined);
      return;
    }
    throw new ValidationError(
      `Invalid field format: ${field}. Expected key=value`,
      "field"
    );
  }

  const key = field.substring(0, eqIndex);
  const rawValue = field.substring(eqIndex + 1);
  const value = raw ? rawValue : parseFieldValue(rawValue);
  setNestedValue(result, key, value);
}

/**
 * Parse field arguments into request body object.
 * Supports bracket notation for nested keys (e.g., "user[name]=value")
 * and array syntax (e.g., "tags[]=value" or "tags[]" for empty array).
 *
 * @param fields - Array of "key=value" strings (or "key[]" for empty arrays)
 * @param raw - If true, treat all values as strings (no JSON parsing)
 * @returns Parsed object with nested structure
 * @throws {Error} When field format is invalid
 * @internal Exported for testing
 */
export function parseFields(
  fields: string[],
  raw = false
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const field of fields) {
    processField(result, field, raw);
  }

  return result;
}

/**
 * Convert a value to string, JSON-stringifying objects to avoid "[object Object]".
 * @internal
 */
function stringifyValue(value: unknown): string {
  if (typeof value === "object" && value !== null) {
    return JSON.stringify(value);
  }
  return String(value);
}

/**
 * Build query parameters from typed field strings (--field/-F) for GET requests.
 * Unlike parseFields(), this produces a flat structure suitable for URL query strings.
 * Arrays are represented as string[] for repeated keys (e.g., tags=1&tags=2&tags=3).
 *
 * @param fields - Array of "key=value" strings
 * @returns Record suitable for URLSearchParams
 * @throws {Error} When field doesn't contain "=" or key format is invalid
 * @internal Exported for testing
 */
export function buildQueryParams(
  fields: string[]
): Record<string, string | string[]> {
  const result: Record<string, string | string[]> = {};

  for (const field of fields) {
    const eqIndex = field.indexOf("=");
    if (eqIndex === -1) {
      throw new ValidationError(
        `Invalid field format: ${field}. Expected key=value`,
        "field"
      );
    }

    const key = field.substring(0, eqIndex);

    // Validate key format (same validation as parseFieldKey for consistency)
    if (!FIELD_KEY_REGEX.test(key)) {
      throw new ValidationError(`Invalid field key format: ${key}`, "field");
    }

    const rawValue = field.substring(eqIndex + 1);
    const value = parseFieldValue(rawValue);

    // Handle arrays by creating string[] for repeated keys
    // Use stringifyValue to handle objects (avoid "[object Object]")
    if (Array.isArray(value)) {
      result[key] = value.map(stringifyValue);
    } else {
      result[key] = stringifyValue(value);
    }
  }

  return result;
}

/**
 * Build query parameters from raw field strings (--raw-field/-f) for GET requests.
 * Raw fields are passed directly without any processing (no JSON parsing, no bracket
 * notation, no URI encoding). Values are kept exactly as provided.
 *
 * @param fields - Array of "key=value" strings
 * @returns Record suitable for URLSearchParams
 * @throws {ValidationError} When field doesn't contain "=" or key is empty
 * @internal Exported for testing
 */
export function buildRawQueryParams(
  fields: string[]
): Record<string, string | string[]> {
  const result: Record<string, string | string[]> = {};

  for (const field of fields) {
    const eqIndex = field.indexOf("=");
    if (eqIndex === -1) {
      throw new ValidationError(
        `Invalid field format: ${field}. Expected key=value`,
        "field"
      );
    }

    const key = field.substring(0, eqIndex);
    if (key === "") {
      throw new ValidationError(
        "Invalid field key format: key cannot be empty",
        "field"
      );
    }

    const value = field.substring(eqIndex + 1);

    // For raw fields, handle repeated keys by creating string[]
    const existing = result[key];
    if (existing !== undefined) {
      if (Array.isArray(existing)) {
        existing.push(value);
      } else {
        result[key] = [existing, value];
      }
    } else {
      result[key] = value;
    }
  }

  return result;
}

/**
 * Build query parameters from both typed and raw field strings for GET requests.
 * Typed fields (--field/-F) are parsed with JSON conversion and bracket notation.
 * Raw fields (--raw-field/-f) are passed directly without any processing.
 *
 * @param typedFields - Array of typed "key=value" strings (JSON parsed)
 * @param rawFields - Array of raw "key=value" strings (no processing)
 * @returns Merged record suitable for URLSearchParams
 * @internal Exported for testing
 */
export function buildQueryParamsFromFields(
  typedFields?: string[],
  rawFields?: string[]
): Record<string, string | string[]> {
  const typedParams =
    typedFields && typedFields.length > 0 ? buildQueryParams(typedFields) : {};
  const rawParams =
    rawFields && rawFields.length > 0 ? buildRawQueryParams(rawFields) : {};

  // Merge params: raw fields can override typed fields if same key
  return { ...typedParams, ...rawParams };
}

/**
 * Prepare request options by routing fields to body or params based on HTTP method.
 * GET requests send fields as query parameters, other methods send as JSON body.
 *
 * @param method - HTTP method
 * @param typedFields - Array of "key=value" field strings (--field, values parsed as JSON)
 * @param rawFields - Array of "key=value" field strings (--raw-field, values kept as strings)
 * @returns Object with either body or params set (or neither if no fields)
 * @internal Exported for testing
 */
export function prepareRequestOptions(
  method: HttpMethod,
  typedFields?: string[],
  rawFields?: string[]
): {
  body?: Record<string, unknown>;
  params?: Record<string, string | string[]>;
} {
  const hasTypedFields = typedFields && typedFields.length > 0;
  const hasRawFields = rawFields && rawFields.length > 0;
  const hasFields = hasTypedFields || hasRawFields;
  const isBodyMethod = method !== "GET";

  if (!hasFields) {
    return {};
  }

  if (isBodyMethod) {
    // For body methods (POST, PUT, etc.), merge typed and raw fields
    return { body: buildBodyFromFields(typedFields, rawFields) };
  }

  // For GET requests, build query params from both typed and raw fields
  return { params: buildQueryParamsFromFields(typedFields, rawFields) };
}

/**
 * Parse header arguments into headers object.
 *
 * @param headers - Array of "Key: Value" strings
 * @returns Object mapping header names to values
 * @throws {Error} When header doesn't contain ":"
 * @internal Exported for testing
 */
export function parseHeaders(headers: string[]): Record<string, string> {
  const result: Record<string, string> = {};

  for (const header of headers) {
    const colonIndex = header.indexOf(":");
    if (colonIndex === -1) {
      throw new Error(`Invalid header format: ${header}. Expected Key: Value`);
    }

    const key = header.substring(0, colonIndex).trim();
    const value = header.substring(colonIndex + 1).trim();
    result[key] = value;
  }

  return result;
}

// Request Body Building

/**
 * Parse an inline string as a request body.  Tries JSON first; falls back to
 * the raw string so non-JSON payloads still work.
 *
 * @param data - Raw string from --data flag
 * @returns Parsed JSON object/array, or the original string
 * @internal Exported for testing
 */
export function parseDataBody(
  data: string
): Record<string, unknown> | unknown[] | string {
  try {
    return JSON.parse(data) as Record<string, unknown> | unknown[];
  } catch {
    return data;
  }
}

/**
 * Parse a URL-encoded string into a query parameter map.
 * Duplicate keys are collected into arrays.
 */
function parseUrlEncodedParams(
  data: string
): Record<string, string | string[]> {
  const params: Record<string, string | string[]> = {};
  for (const [key, value] of new URLSearchParams(data)) {
    const existing = params[key];
    if (existing !== undefined) {
      params[key] = Array.isArray(existing)
        ? [...existing, value]
        : [existing, value];
    } else {
      params[key] = value;
    }
  }
  return params;
}

/**
 * Convert `--data` content to query parameters for bodyless HTTP methods
 * (GET, HEAD, OPTIONS).
 *
 * Handles two formats:
 * - URL-encoded strings: `"stat=received&resolution=1d"` → `{ stat: "received", resolution: "1d" }`
 * - JSON objects: `{ "stat": "received" }` → `{ stat: "received" }`
 *
 * Duplicate keys in URL-encoded strings are collected into arrays.
 *
 * @param data - Parsed output from {@link parseDataBody}
 * @returns Query parameter map suitable for `rawApiRequest`'s `params` option
 * @throws {ValidationError} When data is a JSON array or primitive (cannot be query params)
 * @internal Exported for testing
 */
export function dataToQueryParams(
  data: Record<string, unknown> | unknown[] | string
): Record<string, string | string[]> {
  if (typeof data === "string") {
    return parseUrlEncodedParams(data);
  }

  // JSON arrays and primitives (null, boolean, number) can't be query params.
  // parseDataBody uses `as` to narrow JSON.parse output, but primitives slip through.
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new ValidationError(
      "Cannot use --data with a JSON primitive or array for GET requests. " +
        "Only JSON objects and URL-encoded strings can be converted to query parameters. " +
        "Use --method POST to send this data as a request body.",
      "data"
    );
  }

  // JSON object: stringify non-string values
  const params: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(data)) {
    params[key] = typeof value === "string" ? value : JSON.stringify(value);
  }
  return params;
}

/**
 * Try to parse a single field as a bare JSON **object or array** body.
 *
 * The `startsWith` guard is intentional — not just an optimisation.  It
 * restricts detection to objects (`{`) and arrays (`[`), excluding JSON
 * primitives like `42`, `true`, `"string"`.  Without this guard those
 * primitives would be extracted as the body, and downstream code (e.g. the
 * `k in body` key-conflict check) would throw a `TypeError` because the `in`
 * operator requires an object on the right-hand side.
 *
 * @internal
 */
function tryParseJsonField(
  field: string
): Record<string, unknown> | unknown[] | undefined {
  if (field.includes("=")) {
    return;
  }
  if (!(field.startsWith("{") || field.startsWith("["))) {
    return;
  }

  try {
    return JSON.parse(field) as Record<string, unknown> | unknown[];
  } catch {
    return;
  }
}

/**
 * Scan a field list for bare JSON **object or array** values (no `=`) and
 * extract the first one as the intended request body.  This handles the
 * common mistake of passing `-f '{"status":"ignored"}'` instead of
 * `-d '{"status":"ignored"}'`.
 *
 * Detection is conservative: the field must have no `=`, start with `{` or
 * `[`, and parse as valid JSON.  Only one JSON body is allowed — multiple
 * JSON fields are ambiguous and produce a {@link ValidationError}.
 *
 * @returns An object with the extracted `body` (if any) and the `remaining`
 *   fields that are normal key=value entries, or `undefined` if the input
 *   was empty/undefined.
 * @internal Exported for testing
 */
export function extractJsonBody(
  fields: string[] | undefined,
  stderr: Writer
): { body?: Record<string, unknown> | unknown[]; remaining?: string[] } {
  if (!fields || fields.length === 0) {
    return {};
  }

  let jsonBody: Record<string, unknown> | unknown[] | undefined;
  const remaining: string[] = [];

  for (const field of fields) {
    const parsed = tryParseJsonField(field);

    if (parsed === undefined) {
      remaining.push(field);
      continue;
    }

    if (jsonBody !== undefined) {
      throw new ValidationError(
        "Multiple JSON bodies detected in field arguments. " +
          "Use --data/-d to pass an inline JSON body explicitly.",
        "field"
      );
    }

    jsonBody = parsed;
    const preview = field.length > 60 ? `${field.substring(0, 57)}...` : field;
    stderr.write(
      `hint: '${preview}' was used as the request body. ` +
        "Use --data/-d to pass inline JSON next time.\n"
    );
  }

  return {
    body: jsonBody,
    remaining: remaining.length > 0 ? remaining : undefined,
  };
}

/**
 * Build request body from --input flag (file or stdin).
 * Tries to parse the content as JSON, otherwise returns as string.
 * @internal Exported for testing
 */
export async function buildBodyFromInput(
  inputPath: string,
  stdin: NodeJS.ReadStream & { fd: 0 }
): Promise<Record<string, unknown> | string> {
  let content: string;

  if (inputPath === "-") {
    content = await readStdin(stdin);
  } else {
    const file = Bun.file(inputPath);
    if (!(await file.exists())) {
      throw new Error(`File not found: ${inputPath}`);
    }
    content = await file.text();
  }

  // Try to parse as JSON for the API client
  try {
    return JSON.parse(content) as Record<string, unknown>;
  } catch {
    return content;
  }
}

/**
 * Build request body from --field and --raw-field flags.
 * Processes typed fields first, then raw fields, allowing raw fields
 * to overwrite typed fields at the same path. Both field types are
 * merged into a single object, properly handling nested keys.
 *
 * @returns Merged object or undefined if no fields provided
 * @internal Exported for testing
 */
export function buildBodyFromFields(
  typedFields: string[] | undefined,
  rawFields: string[] | undefined
): Record<string, unknown> | undefined {
  const hasTypedFields = typedFields && typedFields.length > 0;
  const hasRawFields = rawFields && rawFields.length > 0;

  if (!(hasTypedFields || hasRawFields)) {
    return;
  }

  // Start with typed fields (JSON parsing enabled)
  const result = hasTypedFields ? parseFields(typedFields, false) : {};

  // Merge raw fields on top (no JSON parsing, can overwrite typed)
  if (hasRawFields) {
    for (const field of rawFields) {
      processField(result, field, true);
    }
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

// Response Output

/**
 * Write response headers to stdout (standard format)
 * @internal Exported for testing
 */
export function writeResponseHeaders(
  stdout: Writer,
  status: number,
  headers: Headers
): void {
  stdout.write(`HTTP ${status}\n`);
  headers.forEach((value, key) => {
    stdout.write(`${key}: ${value}\n`);
  });
  stdout.write("\n");
}

/**
 * Write verbose request output (curl-style format)
 * @internal Exported for testing
 */
export function writeVerboseRequest(
  stdout: Writer,
  method: string,
  endpoint: string,
  headers: Record<string, string> | undefined
): void {
  stdout.write(`> ${method} /api/0/${endpoint}\n`);
  if (headers) {
    for (const [key, value] of Object.entries(headers)) {
      stdout.write(`> ${key}: ${value}\n`);
    }
  }
  stdout.write(">\n");
}

/**
 * Write verbose response output (curl-style format)
 * @internal Exported for testing
 */
export function writeVerboseResponse(
  stdout: Writer,
  status: number,
  headers: Headers
): void {
  stdout.write(`< HTTP ${status}\n`);
  headers.forEach((value, key) => {
    stdout.write(`< ${key}: ${value}\n`);
  });
  stdout.write("<\n");
}

/**
 * Resolve the full URL that rawApiRequest would use for a request.
 *
 * Mirrors the URL construction in rawApiRequest:
 * `${baseUrl}/api/0/${endpoint}?${queryString}`
 * @internal Exported for testing
 */
export function resolveRequestUrl(
  endpoint: string,
  params?: Record<string, string | string[]>
): string {
  // Use getDefaultSdkConfig().baseUrl — same as rawApiRequest — to ensure
  // trailing slashes are stripped and the URL matches what would be sent.
  const { baseUrl } = getDefaultSdkConfig();
  const normalizedEndpoint = endpoint.startsWith("/")
    ? endpoint.slice(1)
    : endpoint;
  const searchParams = buildSearchParams(params);
  const queryString = searchParams ? `?${searchParams.toString()}` : "";
  return `${baseUrl}/api/0/${normalizedEndpoint}${queryString}`;
}

/**
 * Resolve effective request headers, mirroring rawApiRequest logic.
 *
 * Auto-adds Content-Type: application/json for non-string object bodies
 * when no Content-Type was explicitly provided.
 *
 * @internal Exported for testing
 */
export function resolveEffectiveHeaders(
  customHeaders: Record<string, string> | undefined,
  body: unknown
): Record<string, string> {
  const headers = { ...(customHeaders ?? {}) };
  if (
    body !== undefined &&
    body !== null &&
    typeof body !== "string" &&
    !Object.keys(headers).some((k) => k.toLowerCase() === "content-type")
  ) {
    headers["Content-Type"] = "application/json";
  }
  return headers;
}

/**
 * Build body and params from field flags, auto-detecting bare JSON bodies.
 *
 * Runs colon-to-equals normalization, extracts any JSON body passed as a
 * field value (with a stderr hint about `--data`), and routes the remaining
 * fields to body or query params based on the HTTP method.
 *
 * @internal Exported for testing
 */
export function buildFromFields(
  method: HttpMethod,
  flags: Pick<ApiFlags, "field" | "raw-field">,
  stderr: Writer
): {
  body?: Record<string, unknown> | unknown[];
  params?: Record<string, string | string[]>;
} {
  const field = normalizeFields(flags.field, stderr);
  let rawField = normalizeFields(flags["raw-field"], stderr);

  // Auto-detect bare JSON passed as a field value (common mistake).
  // GET requests don't have a body — skip detection so JSON-shaped values
  // fall through to query-param routing (which will throw a clear error).
  let body: Record<string, unknown> | unknown[] | undefined;
  if (method !== "GET") {
    const extracted = extractJsonBody(rawField, stderr);
    body = extracted.body;
    rawField = extracted.remaining;
  }

  // Route remaining fields to body (merge) or params based on HTTP method
  const options = prepareRequestOptions(method, field, rawField);
  if (options.body) {
    if (Array.isArray(body)) {
      // Can't meaningfully merge key=value fields into a JSON array body.
      throw new ValidationError(
        "Cannot combine a JSON array body with field flags (-F/-f). " +
          "Use --data/-d to pass the array as the full body without extra fields.",
        "field"
      );
    }
    if (body) {
      // Detect top-level key conflicts before merging — a shallow spread would
      // silently drop nested fields from the JSON body (e.g. statusDetails.ignoreCount
      // overwritten by statusDetails[minCount]=5).
      const conflicts = Object.keys(options.body).filter(
        (k) => k in (body as Record<string, unknown>)
      );
      if (conflicts.length > 0) {
        throw new ValidationError(
          `Field flag(s) conflict with detected JSON body at key(s): ${conflicts.join(", ")}. ` +
            "Use --data/-d to pass the full JSON body, or use only field flags (-F/-f).",
          "field"
        );
      }
    }
    // Merge field-built key=value entries into the auto-detected JSON object body
    body =
      body && typeof body === "object"
        ? { ...(body as Record<string, unknown>), ...options.body }
        : options.body;
  }

  return { body, params: options.params };
}

/**
 * Resolve the request body and query params from the user-provided flags.
 *
 * Priority order: `--data` > `--input` > field flags (`-F`/`-f`).
 * Mutually-exclusive combinations throw {@link ValidationError}.
 *
 * @returns body and params ready for the API request
 * @internal Exported for testing
 */
export async function resolveBody(
  flags: Pick<ApiFlags, "method" | "data" | "input" | "field" | "raw-field">,
  stdin: NodeJS.ReadStream & { fd: 0 },
  stderr: Writer
): Promise<{
  body?: Record<string, unknown> | unknown[] | string;
  params?: Record<string, string | string[]>;
}> {
  if (flags.data !== undefined && flags.input !== undefined) {
    throw new ValidationError(
      "Cannot use --data and --input together. " +
        "Use --data/-d for inline JSON, or --input for file/stdin.",
      "data"
    );
  }

  if (
    flags.data !== undefined &&
    (flags.field?.length || flags["raw-field"]?.length)
  ) {
    throw new ValidationError(
      "Cannot use --data with --field or --raw-field. " +
        "Use --data/-d for a full JSON body, or -F/-f for individual fields.",
      "data"
    );
  }

  if (flags.data !== undefined) {
    const parsed = parseDataBody(flags.data);

    // GET/HEAD/OPTIONS cannot have a body — convert data to query params
    if (flags.method === "GET") {
      return { params: dataToQueryParams(parsed) };
    }

    return { body: parsed };
  }

  if (flags.input !== undefined) {
    return { body: await buildBodyFromInput(flags.input, stdin) };
  }

  return buildFromFields(flags.method, flags, stderr);
}

// Command Definition

export const apiCommand = buildCommand({
  output: { json: true },
  docs: {
    brief: "Make an authenticated API request",
    fullDescription:
      "Make a raw API request to the Sentry API. Similar to 'gh api' for GitHub. " +
      "The endpoint is relative to /api/0/ (do not include the prefix). " +
      "Authentication is handled automatically using your stored credentials.\n\n" +
      "Body options:\n" +
      '  --data/-d \'{"key":"value"}\'   Inline JSON body (like curl -d)\n' +
      '  --input/-i file.json          Read body from file (or "-" for stdin)\n\n' +
      "Field syntax (--field/-F):\n" +
      "  key=value          Simple field (values parsed as JSON if valid)\n" +
      "  key[sub]=value     Nested object: {key: {sub: value}}\n" +
      "  key[]=value        Array append: {key: [value]}\n" +
      "  key[]              Empty array: {key: []}\n\n" +
      "Use --raw-field/-f to send values as strings without JSON parsing.\n\n" +
      "Examples:\n" +
      "  sentry api organizations/\n" +
      "  sentry api issues/123/ -X PUT -F status=resolved\n" +
      '  sentry api issues/123/ -X PUT -d \'{"status":"resolved"}\'\n' +
      "  sentry api projects/my-org/my-project/ -F options[sampleRate]=0.5\n" +
      "  sentry api teams/my-org/my-team/members/ -F user[email]=user@example.com",
  },
  parameters: {
    positional: {
      kind: "tuple",
      parameters: [
        {
          brief: "API endpoint relative to /api/0/ (e.g., organizations/)",
          parse: String,
          placeholder: "endpoint",
        },
      ],
    },
    flags: {
      method: {
        kind: "parsed",
        parse: parseMethod,
        brief: "The HTTP method for the request",
        default: "GET" as const,
        placeholder: "method",
      },
      data: {
        kind: "parsed",
        parse: String,
        brief: "Inline JSON body for the request (like curl -d)",
        optional: true,
        placeholder: "json",
      },
      field: {
        kind: "parsed",
        parse: String,
        brief: "Add a typed parameter (key=value, key[sub]=value, key[]=value)",
        variadic: true,
        optional: true,
      },
      "raw-field": {
        kind: "parsed",
        parse: String,
        brief: "Add a string parameter without JSON parsing",
        variadic: true,
        optional: true,
      },
      header: {
        kind: "parsed",
        parse: String,
        brief: "Add a HTTP request header in key:value format",
        variadic: true,
        optional: true,
      },
      input: {
        kind: "parsed",
        parse: String,
        brief:
          'The file to use as body for the HTTP request (use "-" to read from standard input)',
        optional: true,
        placeholder: "file",
      },
      include: {
        kind: "boolean",
        brief: "Include HTTP response status line and headers in the output",
        default: false,
      },
      silent: {
        kind: "boolean",
        brief: "Do not print the response body",
        default: false,
      },
      verbose: {
        kind: "boolean",
        brief: "Include full HTTP request and response in the output",
        default: false,
      },
      "dry-run": {
        kind: "boolean",
        brief: "Show the resolved request without sending it",
        default: false,
      },
    },
    aliases: {
      X: "method",
      d: "data",
      F: "field",
      f: "raw-field",
      H: "header",
      i: "include",
      n: "dry-run",
    },
  },
  async func(this: SentryContext, flags: ApiFlags, endpoint: string) {
    const { stdout, stderr, stdin } = this;

    // Normalize endpoint to ensure trailing slash (Sentry API requirement)
    const normalizedEndpoint = normalizeEndpoint(endpoint);

    // Resolve body and query params from flags (--data, --input, or fields)
    const { body, params } = await resolveBody(flags, stdin, stderr);

    const headers =
      flags.header && flags.header.length > 0
        ? parseHeaders(flags.header)
        : undefined;

    // Dry-run mode: preview the request that would be sent
    if (flags["dry-run"]) {
      return {
        data: {
          method: flags.method,
          url: resolveRequestUrl(normalizedEndpoint, params),
          headers: resolveEffectiveHeaders(headers, body),
          body: body ?? null,
        },
      };
    }

    // Verbose mode: show request details before the response
    if (flags.verbose && !flags.silent) {
      writeVerboseRequest(stdout, flags.method, normalizedEndpoint, headers);
    }

    const response = await rawApiRequest(normalizedEndpoint, {
      method: flags.method,
      body,
      params,
      headers,
    });

    const isError = response.status >= 400;

    // Silent mode — only set exit code, no output
    if (flags.silent) {
      if (isError) {
        process.exit(1);
      }
      return;
    }

    // Output response headers when requested (side-effect before body)
    if (flags.verbose) {
      writeVerboseResponse(stdout, response.status, response.headers);
    } else if (flags.include) {
      writeResponseHeaders(stdout, response.status, response.headers);
    }

    // Error responses: Stricli overwrites process.exitCode after the
    // command returns, so we must use process.exit(1) directly.
    // Return { data } for success so the output wrapper renders it.
    if (isError) {
      writeJson(stdout, response.body, flags.fields);
      process.exit(1);
    }

    return { data: response.body };
  },
});
