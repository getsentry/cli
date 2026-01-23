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

/**
 * Set a nested value in an object using dot notation key.
 * Creates intermediate objects as needed.
 *
 * @param obj - Target object to modify
 * @param key - Dot-notation key (e.g., "user.name")
 * @param value - Value to set
 * @throws {Error} When key contains dangerous segments (__proto__, constructor, prototype)
 * @internal Exported for testing
 */
export function setNestedValue(
  obj: Record<string, unknown>,
  key: string,
  value: unknown
): void {
  const keys = key.split(".");

  // Validate all key segments to prevent prototype pollution
  for (const k of keys) {
    if (DANGEROUS_KEYS.has(k)) {
      throw new Error(`Invalid field key: "${k}" is not allowed`);
    }
  }

  let current = obj;

  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i];
    if (!k) {
      continue; // Skip empty segments from consecutive dots
    }
    if (!Object.hasOwn(current, k)) {
      current[k] = {};
    }
    current = current[k] as Record<string, unknown>;
  }

  const lastKey = keys.at(-1);
  if (lastKey) {
    current[lastKey] = value;
  }
}

/**
 * Parse field arguments into request body object.
 * Supports dot notation for nested keys and JSON values.
 *
 * @param fields - Array of "key=value" strings
 * @param raw - If true, treat all values as strings (no JSON parsing)
 * @returns Parsed object with nested structure
 * @throws {Error} When field doesn't contain "="
 * @internal Exported for testing
 */
export function parseFields(
  fields: string[],
  raw = false
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const field of fields) {
    const eqIndex = field.indexOf("=");
    if (eqIndex === -1) {
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
 * Build request body from --field and --raw-field flags.
 * Returns undefined if no fields are provided.
 */
function buildBodyFromFields(
  typedFields: string[] | undefined,
  rawFields: string[] | undefined
): Record<string, unknown> | undefined {
  const typed =
    typedFields && typedFields.length > 0
      ? parseFields(typedFields, false)
      : {};
  const raw =
    rawFields && rawFields.length > 0 ? parseFields(rawFields, true) : {};

  const merged = { ...typed, ...raw };
  return Object.keys(merged).length > 0 ? merged : undefined;
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
      "Examples:\n" +
      "  sentry api organizations/\n" +
      "  sentry api issues/123/ --method PUT --field status=resolved\n" +
      "  sentry api projects/my-org/my-project/issues/",
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
        brief: "Add a typed parameter in key=value format",
        variadic: true,
        optional: true,
      },
      "raw-field": {
        kind: "parsed",
        parse: String,
        brief: "Add a string parameter in key=value format",
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

    // Verbose mode: show request details
    if (flags.verbose) {
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
