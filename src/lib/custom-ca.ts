/**
 * Custom CA certificate loading for corporate TLS proxies.
 *
 * Reads CA bundles from (in priority order):
 * 1. `sentry cli defaults ca-cert` (stored path in SQLite)
 * 2. `NODE_EXTRA_CA_CERTS` env var
 * 3. `SSL_CERT_FILE` env var
 *
 * Returns a `tls` options object for Bun's `fetch()`. On the Node.js npm
 * distribution, Node natively honors `NODE_EXTRA_CA_CERTS` so the extra
 * `tls.ca` option is harmless (ignored by Node's fetch).
 *
 * Security model: When the CA source is an env var (not a stored default)
 * AND the target is SaaS (`*.sentry.io`), a one-time warning is logged.
 * `sentry cli defaults ca-cert` silences the warning — the user has
 * explicitly acknowledged the custom CA. See CLI-1K6 plan for the full
 * threat model discussion.
 */

import { getDefaultCaCert } from "./db/defaults.js";
import { getEnv } from "./env.js";
import { logger } from "./logger.js";
import { isSentrySaasUrl } from "./sentry-urls.js";

const log = logger.withTag("tls");

/** Where the loaded CA came from */
export type CaSource = "default" | "env" | "none";

/** Cached resolved state — computed once per process */
let resolved: { tls: { ca: string } } | undefined;
let resolvedSource: CaSource = "none";
let resolvePromise: Promise<void> | null = null;
let warnedSaas = false;

/**
 * Attempt to read a PEM file. Returns the file contents on success,
 * or undefined if the file doesn't exist or can't be read.
 * Never throws — a missing CA file shouldn't crash the CLI.
 */
async function tryReadPem(path: string): Promise<string | undefined> {
  try {
    const file = Bun.file(path);
    if (!(await file.exists())) {
      log.warn(`CA certificate file not found: ${path}`);
      return;
    }
    const content = await file.text();
    if (!content.includes("-----BEGIN")) {
      log.warn(
        `CA certificate file does not appear to contain PEM data: ${path}`
      );
      return;
    }
    return content;
  } catch {
    log.warn(`Failed to read CA certificate file: ${path}`);
    return;
  }
}

/**
 * Resolve custom CA certificates (inner implementation).
 *
 * Priority:
 * 1. Stored default (`sentry cli defaults ca-cert`)
 * 2. `NODE_EXTRA_CA_CERTS` env var
 * 3. `SSL_CERT_FILE` env var
 */
async function resolveInner(): Promise<void> {
  // 1. Stored default — highest priority, silences SaaS warning
  const storedPath = getDefaultCaCert();
  if (storedPath) {
    const pem = await tryReadPem(storedPath);
    if (pem) {
      resolved = { tls: { ca: pem } };
      resolvedSource = "default";
      log.debug(`Loaded CA certificates from stored default: ${storedPath}`);
      return;
    }
    // Stored path is stale/invalid — fall through to env vars
  }

  // 2. NODE_EXTRA_CA_CERTS
  const env = getEnv();
  const extraCerts = env.NODE_EXTRA_CA_CERTS?.trim();
  if (extraCerts) {
    const pem = await tryReadPem(extraCerts);
    if (pem) {
      resolved = { tls: { ca: pem } };
      resolvedSource = "env";
      log.debug(
        `Loaded CA certificates from NODE_EXTRA_CA_CERTS: ${extraCerts}`
      );
      return;
    }
  }

  // 3. SSL_CERT_FILE
  const sslCertFile = env.SSL_CERT_FILE?.trim();
  if (sslCertFile) {
    const pem = await tryReadPem(sslCertFile);
    if (pem) {
      resolved = { tls: { ca: pem } };
      resolvedSource = "env";
      log.debug(`Loaded CA certificates from SSL_CERT_FILE: ${sslCertFile}`);
      return;
    }
  }
}

/**
 * Resolve custom CA certificates. All concurrent callers await the same
 * promise so the second caller never sees stale `undefined` while I/O
 * is in flight.
 */
function resolve(): Promise<void> {
  if (!resolvePromise) {
    resolvePromise = resolveInner();
  }
  return resolvePromise;
}

/**
 * Get the `tls` options to spread into Bun's `fetch()` call.
 * Returns undefined when no custom CAs are configured.
 */
export async function getCustomTlsOptions(): Promise<
  { tls: { ca: string } } | undefined
> {
  await resolve();
  return resolved;
}

/** Get the source of the loaded CA certificates. */
export function getCustomCaSource(): CaSource {
  return resolvedSource;
}

/**
 * Log a one-time warning when env-sourced CAs are used for SaaS targets.
 *
 * Stored defaults (via `sentry cli defaults ca-cert`) are treated as
 * explicit user acknowledgment and do NOT trigger this warning.
 */
export function warnIfSaasWithEnvCa(targetUrl: string): void {
  if (warnedSaas || resolvedSource !== "env") {
    return;
  }
  if (!isSentrySaasUrl(targetUrl)) {
    return;
  }
  warnedSaas = true;

  const envVar = getEnv().NODE_EXTRA_CA_CERTS?.trim()
    ? "NODE_EXTRA_CA_CERTS"
    : "SSL_CERT_FILE";

  log.warn(
    `Using custom CA certificates from ${envVar} for sentry.io connections.\n` +
      "  If you intended this (e.g. corporate proxy), silence this warning:\n" +
      "    sentry cli defaults ca-cert /path/to/cert.pem"
  );
}

/**
 * TLS certificate CA trust error patterns — errors that indicate the
 * server's certificate chain cannot be verified against known CAs.
 * These are fixable by providing a custom CA bundle.
 *
 * Excludes `CERT_HAS_EXPIRED` and `ERR_TLS_CERT_ALTNAME_INVALID` which
 * are not CA trust issues (expired cert / hostname mismatch) and would
 * produce misleading "add your CA cert" guidance.
 */
const TLS_ERROR_PATTERNS = [
  "unable to get local issuer certificate",
  "unable to verify the first certificate",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
] as const;

/**
 * Check if an error is a TLS certificate verification failure.
 * Walks `error.cause` to handle Node.js `fetch` which wraps TLS errors
 * in `TypeError: fetch failed` with the real error in `.cause`.
 */
export function isTlsCertError(error: unknown): boolean {
  return getTlsCertErrorMessage(error) !== undefined;
}

/**
 * Walk the error cause chain and return the message of the first error
 * that matches a TLS CA trust pattern, or undefined if none match.
 *
 * Node.js `fetch` wraps TLS errors in `TypeError: fetch failed` with
 * the real error in `.cause` — this finds the root TLS message so
 * callers display it instead of the generic wrapper.
 */
export function getTlsCertErrorMessage(error: unknown): string | undefined {
  let current: unknown = error;
  while (current instanceof Error) {
    const msg = current.message;
    if (TLS_ERROR_PATTERNS.some((pattern) => msg.includes(pattern))) {
      return msg;
    }
    current = current.cause;
  }
  return;
}

/**
 * Reset all cached state. Test-only — not exported from the public API.
 * @internal
 */
export function __resetForTests(): void {
  resolved = undefined;
  resolvedSource = "none";
  resolvePromise = null;
  warnedSaas = false;
}
