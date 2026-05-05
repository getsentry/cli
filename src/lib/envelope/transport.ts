/**
 * DSN-based envelope transport for Sentry's event ingestion pipeline.
 *
 * Unlike the Web API (which uses Bearer token auth), envelope ingestion
 * authenticates via the DSN's public key embedded in the request URL.
 * This is the same mechanism all Sentry SDKs use when reporting errors.
 *
 * Endpoint pattern:
 *   POST https://<host>/api/<projectId>/envelope/
 *        ?sentry_key=<publicKey>&sentry_version=7
 *   Content-Type: application/x-sentry-envelope
 */

import { getEnvelopeEndpointWithUrlEncodedAuth, makeDsn } from "@sentry/core";
import { ApiError, ConfigError, ValidationError } from "../errors.js";

const SENTRY_CLIENT = "sentry-cli/dev";

/** Flags subset relevant to DSN resolution. */
export type DsnFlags = {
  dsn?: string;
};

/**
 * Build the ingest URL for a given DSN.
 *
 * Returns the full URL including auth query params, ready to POST to.
 * Throws ValidationError on an unparseable DSN.
 */
export function buildEnvelopeUrl(dsn: string): string {
  const dsnComponents = makeDsn(dsn);
  if (!dsnComponents) {
    throw new ValidationError(`Invalid DSN: ${dsn}`, "dsn");
  }
  return getEnvelopeEndpointWithUrlEncodedAuth(dsnComponents, undefined, {
    name: SENTRY_CLIENT,
    version: "dev",
  });
}

/**
 * Resolve the DSN to use for sending, in priority order:
 *   1. `--dsn` flag
 *   2. `SENTRY_DSN` environment variable
 *   3. Returns `undefined` (caller decides whether to auto-detect or error)
 */
export function resolveDsn(flags: DsnFlags, _cwd: string): string | undefined {
  if (flags.dsn) {
    return flags.dsn;
  }
  const envDsn = process.env.SENTRY_DSN;
  if (envDsn) {
    return envDsn;
  }
  return;
}

/**
 * Require a DSN to be available, throwing a helpful ConfigError if not.
 *
 * Auto-detection via project scanning is intentionally deferred — callers
 * that want it can call the DSN detector before this.
 */
export function requireDsn(flags: DsnFlags, cwd: string): string {
  const dsn = resolveDsn(flags, cwd);
  if (dsn) {
    return dsn;
  }
  throw new ConfigError(
    "No DSN found. Provide one via --dsn, SENTRY_DSN env var, or ensure your project has a Sentry DSN configured.",
    "sentry send-event --dsn <your-dsn>"
  );
}

/**
 * POST a serialized envelope to Sentry's ingest endpoint using DSN auth.
 *
 * No Bearer token is required — the DSN public key serves as authentication.
 * Throws ApiError on non-2xx responses.
 */
export async function sendEnvelopeRequest(
  dsn: string,
  body: string | Uint8Array
): Promise<void> {
  const url = buildEnvelopeUrl(dsn);

  const response = await fetch(
    new Request(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-sentry-envelope" },
      body,
    })
  );

  if (!response.ok) {
    let detail = `HTTP ${response.status}`;
    try {
      const json = (await response.json()) as Record<string, unknown>;
      if (typeof json.detail === "string") {
        detail = json.detail;
      }
    } catch {
      // Non-JSON error body — keep the HTTP status message
    }
    throw new ApiError(detail, response.status, detail, url);
  }
}
