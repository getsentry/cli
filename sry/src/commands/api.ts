import { buildCommand } from "@stricli/core";
import type { SryContext } from "../context.js";
import { rawApiRequest } from "../lib/api-client.js";

type ApiFlags = {
  readonly method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  readonly field: string[];
  readonly header: string[];
  readonly include: boolean;
  readonly silent: boolean;
};

function parseFields(fields: string[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const field of fields) {
    const eqIndex = field.indexOf("=");
    if (eqIndex === -1) {
      throw new Error(`Invalid field format: ${field}. Expected key=value`);
    }

    const key = field.substring(0, eqIndex);
    let value: unknown = field.substring(eqIndex + 1);

    // Try to parse as JSON for complex values
    try {
      value = JSON.parse(value as string);
    } catch {
      // Keep as string if not valid JSON
    }

    // Handle nested keys like "data.name"
    const keys = key.split(".");
    let current = result;
    for (let i = 0; i < keys.length - 1; i++) {
      const k = keys[i];
      if (!(k in current)) {
        current[k] = {};
      }
      current = current[k] as Record<string, unknown>;
    }
    current[keys.at(-1)] = value;
  }

  return result;
}

function parseHeaders(headers: string[]): Record<string, string> {
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

export const apiCommand = buildCommand({
  docs: {
    brief: "Make an authenticated API request",
    fullDescription:
      "Make a raw API request to the Sentry API. Similar to 'gh api' for GitHub. " +
      "The endpoint should start with '/api/0/' or be a full URL. " +
      "Authentication is handled automatically using your stored credentials.\n\n" +
      "Examples:\n" +
      "  sry api /api/0/organizations/\n" +
      "  sry api /api/0/issues/123/ --method PUT --field status=resolved\n" +
      "  sry api /api/0/projects/my-org/my-project/issues/",
  },
  parameters: {
    positional: {
      kind: "tuple",
      parameters: [
        {
          brief: "API endpoint (e.g., /api/0/organizations/)",
          parse: String,
        },
      ],
    },
    flags: {
      method: {
        kind: "parsed",
        parse: (value: string) => {
          const valid = ["GET", "POST", "PUT", "DELETE", "PATCH"];
          const upper = value.toUpperCase();
          if (!valid.includes(upper)) {
            throw new Error(
              `Invalid method: ${value}. Must be one of: ${valid.join(", ")}`
            );
          }
          return upper as "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
        },
        brief: "HTTP method (GET, POST, PUT, DELETE, PATCH)",
        default: "GET" as const,
        variableName: "X",
      },
      field: {
        kind: "parsed",
        parse: String,
        brief: "Request body field (key=value). Can be repeated.",
        optional: true,
        variadic: true,
      },
      header: {
        kind: "parsed",
        parse: String,
        brief: "Additional header (Key: Value). Can be repeated.",
        optional: true,
        variadic: true,
      },
      include: {
        kind: "boolean",
        brief: "Include response headers in output",
        default: false,
      },
      silent: {
        kind: "boolean",
        brief: "Suppress output, only set exit code",
        default: false,
      },
    },
  },
  async func(
    this: SryContext,
    flags: ApiFlags,
    endpoint: string
  ): Promise<void> {
    const { process } = this;

    try {
      // Parse request body from fields
      const body =
        flags.field && flags.field.length > 0
          ? parseFields(flags.field)
          : undefined;

      // Parse additional headers
      const headers =
        flags.header && flags.header.length > 0
          ? parseHeaders(flags.header)
          : undefined;

      // Make the request
      const response = await rawApiRequest(endpoint, {
        method: flags.method,
        body,
        headers,
      });

      // Silent mode - just set exit code
      if (flags.silent) {
        if (response.status >= 400) {
          process.exitCode = 1;
        }
        return;
      }

      // Include headers in output
      if (flags.include) {
        process.stdout.write(`HTTP ${response.status}\n`);
        response.headers.forEach((value, key) => {
          process.stdout.write(`${key}: ${value}\n`);
        });
        process.stdout.write("\n");
      }

      // Output body
      if (response.body !== null && response.body !== undefined) {
        if (typeof response.body === "object") {
          process.stdout.write(`${JSON.stringify(response.body, null, 2)}\n`);
        } else {
          process.stdout.write(`${String(response.body)}\n`);
        }
      }

      // Set exit code for error responses
      if (response.status >= 400) {
        process.exitCode = 1;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`Error: ${message}\n`);
      process.exitCode = 1;
    }
  },
});
