/**
 * Central error reporting helper for CLI command failures.
 *
 * Every command-level exception flows through {@link reportCliError}. This gives
 * us one place to:
 *
 * 1. **Apply silencing rules** — drop `OutputError`, expected-auth-state
 *    `AuthError`s, and 401–499 `ApiError`s from `captureException` so they
 *    don't create Sentry issues. Volume for the silenced classes is still
 *    emitted as a `cli.error.silenced` distribution metric with user/org
 *    context so we never lose visibility.
 *
 * 2. **Normalize fingerprints** — user-supplied data (slugs, IDs, endpoints,
 *    paths) in error messages caused Sentry to split one logical error into
 *    many issues (e.g. 13 separate issues for "Could not auto-detect
 *    organization and project"). Fingerprints here collapse those into a
 *    single issue per class + kind while keeping the per-event detail in a
 *    `cli_error` structured context that remains queryable in Discover.
 *
 * 3. **Attach structured context** — each captured event gets a `cli_error`
 *    context with the error's structured fields (status, endpoint, reason,
 *    resource, field, …). `ApiError` also gets the legacy `api_error` context
 *    for back-compat with existing Discover queries.
 *
 * Call sites that don't represent command failures (best-effort background
 * operations in `delta-upgrade.ts`, `teams.ts`, `version-check.ts`, etc.)
 * continue to call `Sentry.captureException` directly — their stack traces
 * are the correct grouping signal. The fallback fingerprint pass in
 * `beforeSend` still catches path-embedded messages for those paths.
 */

// biome-ignore lint/performance/noNamespaceImport: Sentry SDK recommends namespace import
import * as Sentry from "@sentry/node-core/light";
import {
  ApiError,
  AuthError,
  CliError,
  ConfigError,
  ContextError,
  DeviceFlowError,
  OutputError,
  ResolutionError,
  SeerError,
  TimeoutError,
  UpgradeError,
  ValidationError,
} from "./errors.js";

/**
 * Metric emitted for errors that are intentionally silenced (not sent as
 * Sentry issues). Call-count and user/org context are preserved so volume
 * signals remain visible in the tracemetrics dashboard.
 */
const SILENCED_ERROR_METRIC = "cli.error.silenced";

/** Whitespace splitter used across text-normalization helpers. */
const WHITESPACE_RE = /\s+/;

/**
 * Normalize a Sentry API endpoint by replacing dynamic segments with
 * placeholders. Used for fingerprinting so `/api/0/organizations/foo/` and
 * `/api/0/organizations/bar/` group together.
 *
 * Order matters — more specific patterns run before more general ones so we
 * don't double-replace (e.g. the `/issues/<numeric>` rule runs before the
 * generic numeric-ID rule).
 */
export function normalizeEndpoint(endpoint: string | undefined): string {
  if (!endpoint) {
    return "";
  }
  let out = endpoint.split("?")[0] ?? endpoint;
  // Strip trailing slash for stable output, re-add at end if original had one.
  const hadTrailingSlash = out.endsWith("/");
  if (hadTrailingSlash) {
    out = out.slice(0, -1);
  }
  out = out
    .replace(/\/organizations\/[^/]+/g, "/organizations/{slug}")
    .replace(/\/projects\/[^/]+\/[^/]+/g, "/projects/{slug}/{slug}")
    .replace(/\/teams\/[^/]+\/[^/]+/g, "/teams/{slug}/{slug}")
    .replace(/\/issues\/\d+/g, "/issues/{id}")
    .replace(/\/events\/[0-9a-f]{32}/gi, "/events/{hex_id}")
    .replace(/\/releases\/[^/]+/g, "/releases/{version}")
    // Generic hex/numeric IDs as standalone path segments
    .replace(/\/[0-9a-f]{32}(?=\/|$)/gi, "/{hex_id}")
    .replace(/\/[0-9a-f]{16}(?=\/|$)/gi, "/{span_id}");
  return hadTrailingSlash ? `${out}/` : out;
}

/**
 * Strip user-supplied identifiers from a `resource` field (used by
 * `ContextError` and `ResolutionError`).
 *
 * Removes quoted substrings (single and double), long hex IDs, multi-digit
 * numeric IDs, and collapses resulting whitespace. Preserves the structural
 * words that describe *what kind of* resource couldn't be resolved.
 *
 * Examples:
 * - `"Project 'api-track' not found in organization 'foo'"` → `"Project not found in organization"`
 * - `"Issue 7420431306 not found."` → `"Issue not found."`
 * - `"Event '130efe1f...' not found in mamiteam/okhome-api."` → `"Event not found in {slug}/{slug}."`
 */
export function extractResourceKind(resource: string): string {
  if (!resource) {
    return "";
  }
  let out = resource
    // Remove single- and double-quoted substrings
    .replace(/'[^']*'/g, "")
    .replace(/"[^"]*"/g, "")
    // Remove long hex IDs (32 or 16 chars, as standalone tokens)
    .replace(/\b[0-9a-f]{32}\b/gi, "")
    .replace(/\b[0-9a-f]{16}\b/gi, "")
    // Remove multi-digit numeric IDs (6+ digits; issue numeric IDs are typically 10+)
    .replace(/\b\d{6,}\b/g, "")
    // Normalize trailing org/project slug pairs that slip past the quote strip
    // (e.g., "not found in mamiteam/okhome-api") to a placeholder.
    .replace(
      /\b[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*(?=\.?$)/gi,
      "{slug}/{slug}"
    );
  // Collapse whitespace and trim trailing punctuation residue.
  out = out.replace(/\s+/g, " ").trim();
  return out;
}

/**
 * Lightweight prefix extractor for error messages without a structured
 * `resource`/`field`. Takes the first N words with quoted substrings replaced
 * by `<value>`, giving a stable-ish grouping key while still differentiating
 * distinct error templates.
 */
export function extractMessagePrefix(message: string, maxWords = 6): string {
  if (!message) {
    return "";
  }
  const stripped = message
    .replace(/'[^']*'/g, "<value>")
    .replace(/"[^"]*"/g, "<value>")
    .replace(/\b[0-9a-f]{32}\b/gi, "<hex>")
    .replace(/\b[0-9a-f]{16}\b/gi, "<hex>")
    .replace(/\b\d{4,}\b/g, "<num>");
  // First line only, then first maxWords words.
  const firstLine = stripped.split("\n")[0] ?? stripped;
  const words = firstLine.trim().split(WHITESPACE_RE).slice(0, maxWords);
  return words.join(" ");
}

/**
 * Normalize path-like substrings in a generic error message. Used by the
 * fallback fingerprint pass for non-`CliError` exceptions that contain user
 * paths (e.g. EPERM on `/Users/desert/.local/share/zsh/...`).
 */
export function normalizeErrorMessage(message: string): string {
  if (!message) {
    return "";
  }
  return message
    .replace(/C:\\Users\\[^\\]+\\/g, "C:\\Users\\<user>\\")
    .replace(/\/Users\/[^/\s'"]+/g, "/Users/<user>")
    .replace(/\/home\/[^/\s'"]+/g, "/home/<user>")
    .replace(/\/tmp\/[^/\s'"]+/g, "/tmp/<tempfile>")
    .replace(/0x[0-9a-f]+/gi, "0x<addr>");
}

/**
 * Fingerprint for `CliError` subclasses with a structured `reason`/`code`
 * enum. These are already low-cardinality and default grouping often works,
 * but being explicit keeps the mapping symmetric with the fallback pass in
 * `fingerprintFromEventPayload`.
 */
function fingerprintForEnumCliError(error: CliError): string[] | null {
  if (error instanceof SeerError) {
    return ["SeerError", error.reason];
  }
  if (error instanceof AuthError) {
    return ["AuthError", error.reason];
  }
  if (error instanceof DeviceFlowError) {
    return ["DeviceFlowError", error.code];
  }
  if (error instanceof UpgradeError) {
    return ["UpgradeError", error.reason];
  }
  if (error instanceof TimeoutError) {
    return ["TimeoutError"];
  }
  return null;
}

/**
 * Fingerprint for `CliError` subclasses whose structured `resource`/`field`
 * fields embed user data. These are the primary fragmentation sources —
 * `ContextError`, `ResolutionError`, `ValidationError`, `ApiError`.
 */
function fingerprintForStructuredCliError(error: CliError): string[] | null {
  if (error instanceof ContextError) {
    return ["ContextError", extractResourceKind(error.resource)];
  }
  if (error instanceof ResolutionError) {
    return [
      "ResolutionError",
      extractResourceKind(error.resource),
      extractResourceKind(error.headline),
    ];
  }
  if (error instanceof ValidationError) {
    return [
      "ValidationError",
      error.field ?? extractMessagePrefix(error.message),
    ];
  }
  if (error instanceof ApiError) {
    return [
      "ApiError",
      String(error.status),
      normalizeEndpoint(error.endpoint),
    ];
  }
  return null;
}

/**
 * Fingerprint for a generic (non-`CliError`) thrown Error. Returns `null`
 * when the message has no user-specific data — Sentry's default grouping is
 * appropriate for those. Otherwise normalizes the path-embedded message and
 * emits an explicit fingerprint so variants don't fragment.
 */
function fingerprintForGenericError(error: Error): string[] | null {
  const original = error.message ?? "";
  const normalized = normalizeErrorMessage(original);
  if (normalized === original) {
    return null;
  }
  return ["Error", error.name, extractMessagePrefix(normalized)];
}

/**
 * Fingerprint fallback for `CliError` subclasses that carry no structured
 * grouping field (`ConfigError`, `WizardError`, bare `CliError`). Groups by
 * class name + message-prefix so variants of the same template collapse.
 */
function fingerprintForGenericCliError(error: CliError): string[] {
  // Use the runtime class name when available (subclasses set `this.name` in
  // their constructors). Falls back to "CliError" for the base class.
  return [error.name || "CliError", extractMessagePrefix(error.message)];
}

/**
 * Compute a deterministic fingerprint array for a known error class. Returns
 * `null` for errors that should use Sentry's default grouping.
 *
 * @internal Exported for testing.
 */
export function computeFingerprint(error: unknown): string[] | null {
  if (error instanceof CliError) {
    return (
      fingerprintForStructuredCliError(error) ??
      fingerprintForEnumCliError(error) ??
      fingerprintForGenericCliError(error)
    );
  }
  if (error instanceof Error) {
    return fingerprintForGenericError(error);
  }
  return null;
}

/**
 * Build the structured `cli_error` context attached to every captured event.
 * Keeps user-supplied data queryable in Discover without leaking into the
 * fingerprint.
 */
export function buildCliErrorContext(
  error: unknown
): Record<string, unknown> | null {
  if (error instanceof ApiError) {
    return {
      kind: "ApiError",
      status: error.status,
      endpoint: error.endpoint,
      endpoint_template: normalizeEndpoint(error.endpoint),
      detail: error.detail,
    };
  }
  if (error instanceof ContextError) {
    return {
      kind: "ContextError",
      resource: error.resource,
      resource_kind: extractResourceKind(error.resource),
      command: error.command,
    };
  }
  if (error instanceof ResolutionError) {
    return {
      kind: "ResolutionError",
      resource: error.resource,
      resource_kind: extractResourceKind(error.resource),
      headline: error.headline,
      hint: error.hint,
    };
  }
  if (error instanceof ValidationError) {
    return {
      kind: "ValidationError",
      field: error.field,
      message: error.message,
    };
  }
  if (error instanceof SeerError) {
    return {
      kind: "SeerError",
      reason: error.reason,
      org_slug: error.orgSlug,
    };
  }
  if (error instanceof AuthError) {
    return {
      kind: "AuthError",
      reason: error.reason,
    };
  }
  if (error instanceof ConfigError) {
    return {
      kind: "ConfigError",
      suggestion: error.suggestion,
    };
  }
  if (error instanceof DeviceFlowError) {
    return {
      kind: "DeviceFlowError",
      code: error.code,
    };
  }
  if (error instanceof UpgradeError) {
    return {
      kind: "UpgradeError",
      reason: error.reason,
    };
  }
  if (error instanceof TimeoutError) {
    return {
      kind: "TimeoutError",
      hint: error.hint,
    };
  }
  if (error instanceof CliError) {
    return {
      kind: error.name,
    };
  }
  return null;
}

/**
 * Reasons an error may be silenced (not sent to Sentry as an issue).
 *
 * Used as the `reason` attribute on `cli.error.silenced` metrics so we can
 * split volume by policy in the tracemetrics dashboard.
 */
type SilenceReason =
  | "output_error" // OutputError — intentional non-zero exit (e.g., `sentry api` got 4xx/5xx)
  | "auth_expected" // AuthError(not_authenticated|expired) — expected state, auto-login kicks in
  | "api_user_error"; // ApiError(401–499) — user/permission/rate-limit, not a CLI bug

/**
 * Determine whether an error should be silenced (not captured as a Sentry
 * issue), and which reason code applies. Returns `null` when the error should
 * be captured normally.
 *
 * @internal Exported for testing.
 */
export function classifySilenced(error: unknown): SilenceReason | null {
  if (error instanceof OutputError) {
    return "output_error";
  }
  if (
    error instanceof AuthError &&
    (error.reason === "not_authenticated" || error.reason === "expired")
  ) {
    return "auth_expected";
  }
  if (error instanceof ApiError && error.status > 400 && error.status < 500) {
    return "api_user_error";
  }
  return null;
}

/**
 * Emit a `cli.error.silenced` metric (and a structured log for user API
 * errors, which carry actionable `detail`) so volume and user/org context
 * remain visible for errors we don't capture as Sentry issues.
 *
 * User identity (`user.id`, `user.email`) and org/project context are already
 * on the active Sentry scope via `setUser()`/`setTag()` from `initSentry`,
 * and Sentry attaches scope context to metrics automatically.
 */
function recordSilencedError(error: unknown, reason: SilenceReason): void {
  const attributes: Record<string, string | number> = {
    error_class: error instanceof Error ? error.name : typeof error,
    reason,
  };

  if (error instanceof ApiError) {
    attributes.api_status = error.status;
    attributes.endpoint = normalizeEndpoint(error.endpoint);
  }
  if (error instanceof AuthError) {
    attributes.auth_reason = error.reason;
  }

  try {
    Sentry.metrics.distribution(SILENCED_ERROR_METRIC, 1, { attributes });
  } catch {
    // Metric emission must never block error handling.
  }

  // For user API errors, also emit a structured log so the `detail` (often
  // the most actionable field) is searchable in Sentry Logs.
  if (reason === "api_user_error" && error instanceof ApiError) {
    try {
      Sentry.logger.info("cli.api_error_silenced", {
        status: error.status,
        endpoint: normalizeEndpoint(error.endpoint),
        detail: error.detail,
      });
    } catch {
      // Logger may not be initialized (telemetry disabled) — ignore.
    }
  }
}

/**
 * Report a command-level error to Sentry with stable fingerprinting.
 *
 * Entry point for command error reporting. See module-level docstring for
 * the full rationale.
 *
 * - If the error is silenced (see {@link classifySilenced}): emit a metric
 *   and structured log, then return without calling `captureException`.
 * - Otherwise: wrap the capture in a new scope that attaches a deterministic
 *   fingerprint and a structured `cli_error` context (plus `api_error` for
 *   back-compat with existing Discover queries).
 *
 * Safe to call with any thrown value — non-Error values fall through to
 * `Sentry.captureException` with no fingerprint override.
 *
 * @param error - The thrown value
 * @param options - Optional extra tags/contexts merged into the scope.
 *   Use sparingly — most context is already attached globally by
 *   `telemetry.ts` (command name, org/project, flags, user).
 */
/**
 * Apply extra `tags` / `contexts` passed through {@link reportCliError}'s
 * `options` onto the active scope.
 */
function applyCallerOptions(
  scope: Sentry.Scope,
  options: {
    tags?: Record<string, string>;
    contexts?: Record<string, Record<string, unknown>>;
  }
): void {
  if (options.tags) {
    for (const [key, value] of Object.entries(options.tags)) {
      scope.setTag(key, value);
    }
  }
  if (options.contexts) {
    for (const [key, value] of Object.entries(options.contexts)) {
      scope.setContext(key, value);
    }
  }
}

/**
 * Apply the fingerprint + structured context for a to-be-captured error on
 * the active scope. Extracted from {@link reportCliError} so the top-level
 * function stays under Biome's cognitive-complexity limit.
 */
function applyCapturedErrorScope(scope: Sentry.Scope, error: unknown): void {
  const fingerprint = computeFingerprint(error);
  if (fingerprint) {
    scope.setFingerprint(fingerprint);
  }
  const cliContext = buildCliErrorContext(error);
  if (cliContext) {
    scope.setContext("cli_error", cliContext);
  }
  if (error instanceof ApiError) {
    // Back-compat: existing Discover queries filter on `api_error.status`.
    scope.setContext("api_error", {
      status: error.status,
      endpoint: error.endpoint,
      detail: error.detail,
    });
  }
}

export function reportCliError(
  error: unknown,
  options?: {
    tags?: Record<string, string>;
    contexts?: Record<string, Record<string, unknown>>;
  }
): void {
  const silenced = classifySilenced(error);
  if (silenced) {
    recordSilencedError(error, silenced);
    return;
  }

  Sentry.withScope((scope) => {
    applyCapturedErrorScope(scope, error);
    if (options) {
      applyCallerOptions(scope, options);
    }
    Sentry.captureException(error);
  });
}

/**
 * Error class names that use `extractResourceKind` on the first line of the
 * serialized message. The message layout is `${resource} ${headline}.\n...`
 * so the resource-kind extractor is the right stripper.
 */
const RESOURCE_FINGERPRINT_TYPES = new Set(["ContextError", "ResolutionError"]);

/**
 * Error class names that use `extractMessagePrefix` on the serialized message
 * for the fallback fingerprint pass. Includes both structurally-rich errors
 * (where we can't reach the structured fields from the event payload) and
 * enum-keyed errors (where default grouping would also work but explicit
 * fingerprints keep behavior symmetric with `computeFingerprint`).
 */
const PREFIX_FINGERPRINT_TYPES = new Set([
  "ValidationError",
  "ConfigError",
  "WizardError",
  "CliError",
  "ApiError",
  "SeerError",
  "AuthError",
  "UpgradeError",
  "DeviceFlowError",
  "TimeoutError",
]);

/**
 * Derive a fallback fingerprint from a serialized Sentry event payload.
 *
 * Called from `beforeSend` to catch events that bypass {@link reportCliError}
 * — uncaught exceptions, unhandled rejections, and best-effort
 * `captureException` calls from background tasks (delta-upgrade, team fetch,
 * version-check, etc.) that already carry informative tags/contexts.
 *
 * Inspects `event.exception.values[0].type` (the error class name as a
 * string) and `.value` (the message) to reconstruct the same grouping keys
 * {@link computeFingerprint} would have used. Returns `null` when no
 * normalization is needed.
 *
 * @internal Exported for testing.
 */
export function fingerprintFromEventPayload(
  event: Sentry.ErrorEvent
): string[] | null {
  const exc = event.exception?.values?.[0];
  if (!exc) {
    return null;
  }
  const type = exc.type ?? "";
  const value = exc.value ?? "";

  if (RESOURCE_FINGERPRINT_TYPES.has(type)) {
    return [type, extractResourceKind(value.split("\n")[0] ?? value)];
  }
  if (PREFIX_FINGERPRINT_TYPES.has(type)) {
    return [type, extractMessagePrefix(value)];
  }

  // Generic Error with path-embedded message: normalize and fingerprint.
  const normalized = normalizeErrorMessage(value);
  if (normalized !== value) {
    return ["Error", type || "Error", extractMessagePrefix(normalized)];
  }

  return null;
}
