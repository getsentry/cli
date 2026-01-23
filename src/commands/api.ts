/**
 * sentry api
 *
 * Make raw authenticated API requests to Sentry.
 * Similar to 'gh api' for GitHub.
 */

import { buildCommand } from "@stricli/core";
import type { SentryContext } from "../context.js";
import { rawApiRequest } from "../lib/api-client.js";
import type { Writer } from "../types/index.js";

type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

type ApiFlags = {
  readonly method: HttpMethod;
  readonly field?: string[];
  readonly "raw-field"?: string[];
  readonly header?: string[];
  readonly input?: string;
  readonly include: boolean;
  readonly silent: boolean;
  readonly verbose: boolean;
};

// ─────────────────────────────────────────────────────────────────────────────
// Request Parsing
// ─────────────────────────────────────────────────────────────────────────────

const VALID_METHODS: HttpMethod[] = ["GET", "POST", "PUT", "DELETE", "PATCH"];

/**
 * Read all data from stdin as a string.
 * Uses Bun's native stream handling for efficiency.
 */
async function readStdin(
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
 * Validate path segments to prevent prototype pollution attacks.
 * @throws {Error} When a segment is __proto__, constructor, or prototype
 */
function validatePathSegments(path: string[]): void {
  for (const segment of path) {
    if (DANGEROUS_KEYS.has(segment)) {
      throw new Error(`Invalid field key: "${segment}" is not allowed`);
    }
  }
}

/**
 * Navigate/create nested structure to the parent of the target key.
 * @returns The object/array that will contain the final value
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
    if (!Object.hasOwn(currentObj, segment)) {
      // Create array if next segment is empty (array push syntax), else object
      currentObj[segment] = nextSegment === "" ? [] : {};
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
    const eqIndex = field.indexOf("=");

    // Handle empty array syntax: "key[]" without "="
    if (eqIndex === -1) {
      if (field.endsWith("[]")) {
        setNestedValue(result, field, undefined);
        continue;
      }
      throw new Error(`Invalid field format: ${field}. Expected key=value`);
    }

    const key = field.substring(0, eqIndex);
    const rawValue = field.substring(eqIndex + 1);
    const value = raw ? rawValue : parseFieldValue(rawValue);

    setNestedValue(result, key, value);
  }

  return result;
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

// ─────────────────────────────────────────────────────────────────────────────
// Request Body Building
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build request body from --input flag (file or stdin).
 * Tries to parse the content as JSON, otherwise returns as string.
 */
async function buildBodyFromInput(
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
 * Process a single field string and set its value in the result object.
 * @param result - Target object to modify
 * @param field - Field string in "key=value" or "key[]" format
 * @param raw - If true, keep value as string (no JSON parsing)
 * @throws {Error} When field format is invalid
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
    throw new Error(`Invalid field format: ${field}. Expected key=value`);
  }

  const key = field.substring(0, eqIndex);
  const rawValue = field.substring(eqIndex + 1);
  const value = raw ? rawValue : parseFieldValue(rawValue);
  setNestedValue(result, key, value);
}

/**
 * Build request body from --field and --raw-field flags.
 * Processes typed fields first, then raw fields, allowing raw fields
 * to overwrite typed fields at the same path. Both field types are
 * merged into a single object, properly handling nested keys.
 *
 * @returns Merged object or undefined if no fields provided
 */
function buildBodyFromFields(
  typedFields: string[] | undefined,
  rawFields: string[] | undefined
): Record<string, unknown> | undefined {
  const result: Record<string, unknown> = {};

  // Process typed fields first (with JSON parsing)
  for (const field of typedFields ?? []) {
    processField(result, field, false);
  }

  // Process raw fields second (no JSON parsing, can overwrite typed)
  for (const field of rawFields ?? []) {
    processField(result, field, true);
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// Response Output
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Write response headers to stdout (standard format)
 */
function writeResponseHeaders(
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
 * Write response body to stdout
 */
function writeResponseBody(stdout: Writer, body: unknown): void {
  if (body === null || body === undefined) {
    return;
  }

  if (typeof body === "object") {
    stdout.write(`${JSON.stringify(body, null, 2)}\n`);
  } else {
    stdout.write(`${String(body)}\n`);
  }
}

/**
 * Write verbose request output (curl-style format)
 */
function writeVerboseRequest(
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
 */
function writeVerboseResponse(
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

// ─────────────────────────────────────────────────────────────────────────────
// Command Definition
// ─────────────────────────────────────────────────────────────────────────────

export const apiCommand = buildCommand({
  docs: {
    brief: "Make an authenticated API request",
    fullDescription:
      "Make a raw API request to the Sentry API. Similar to 'gh api' for GitHub. " +
      "The endpoint is relative to /api/0/ (do not include the prefix). " +
      "Authentication is handled automatically using your stored credentials.\n\n" +
      "Field syntax (--field/-F):\n" +
      "  key=value          Simple field (values parsed as JSON if valid)\n" +
      "  key[sub]=value     Nested object: {key: {sub: value}}\n" +
      "  key[]=value        Array append: {key: [value]}\n" +
      "  key[]              Empty array: {key: []}\n\n" +
      "Use --raw-field/-f to send values as strings without JSON parsing.\n\n" +
      "Examples:\n" +
      "  sentry api organizations/\n" +
      "  sentry api issues/123/ -X PUT -F status=resolved\n" +
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
    },
    aliases: {
      X: "method",
      F: "field",
      f: "raw-field",
      H: "header",
      i: "include",
    },
  },
  async func(
    this: SentryContext,
    flags: ApiFlags,
    endpoint: string
  ): Promise<void> {
    const { stdout, stdin } = this;

    // Build request body from --input, --field, or --raw-field
    const body =
      flags.input !== undefined
        ? await buildBodyFromInput(flags.input, stdin)
        : buildBodyFromFields(flags.field, flags["raw-field"]);

    const headers =
      flags.header && flags.header.length > 0
        ? parseHeaders(flags.header)
        : undefined;

    // Verbose mode: show request details (unless silent)
    if (flags.verbose && !flags.silent) {
      writeVerboseRequest(stdout, flags.method, endpoint, headers);
    }

    const response = await rawApiRequest(endpoint, {
      method: flags.method,
      body,
      headers,
    });

    const isError = response.status >= 400;

    // Silent mode - only set exit code
    if (flags.silent) {
      if (isError) {
        process.exit(1);
      }
      return;
    }

    // Output headers (verbose or include mode)
    if (flags.verbose) {
      writeVerboseResponse(stdout, response.status, response.headers);
    } else if (flags.include) {
      writeResponseHeaders(stdout, response.status, response.headers);
    }

    // Output body
    writeResponseBody(stdout, response.body);

    // Exit with error code for error responses
    if (isError) {
      process.exit(1);
    }
  },
});
