/**
 * Central error reporting for CLI command failures.
 *
 * Provides two things:
 *
 * 1. **Silencing rules** — `OutputError`, expected-state `AuthError`, and
 *    401–499 `ApiError` are not sent to Sentry as issues. A
 *    `cli.error.silenced` metric preserves volume + user/org context.
 *
 * 2. **Grouping tags** — enriches every error event with `cli_error.*` tags
 *    that Sentry's server-side fingerprint rules use for stable grouping.
 *    The rules live in Settings → Issue Grouping → Fingerprint Rules and
 *    can be adjusted without a deploy.
 *
 * Fingerprint normalization is handled server-side, NOT in code. See the
 * project's fingerprint rules for the active grouping policy.
 */

// biome-ignore lint/performance/noNamespaceImport: Sentry SDK recommends namespace import
import * as Sentry from "@sentry/node-core/light";
import {
  ApiError,
  AuthError,
  ContextError,
  DeviceFlowError,
  OutputError,
  ResolutionError,
  SeerError,
  TimeoutError,
  UpgradeError,
  ValidationError,
} from "./errors.js";

// ---------------------------------------------------------------------------
// Silencing
// ---------------------------------------------------------------------------

/**
 * Reasons an error may be silenced (not sent to Sentry as an issue).
 * Exposed as the `reason` attribute on the `cli.error.silenced` metric.
 */
type SilenceReason = "output_error" | "auth_expected" | "api_user_error";

/**
 * Classify whether an error should be silenced.
 * Returns the reason string when silenced, `null` when it should be captured.
 *
 * @internal Exported for `telemetry.ts` (session-crash decision) and testing.
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

/** Emit a metric for silenced errors so volume remains visible. */
function recordSilencedError(error: unknown, reason: SilenceReason): void {
  const attributes: Record<string, string | number> = {
    error_class: error instanceof Error ? error.name : typeof error,
    reason,
  };
  if (error instanceof ApiError) {
    attributes.api_status = error.status;
  }
  if (error instanceof AuthError) {
    attributes.auth_reason = error.reason;
  }

  try {
    Sentry.metrics.distribution("cli.error.silenced", 1, { attributes });
  } catch {
    // Metric emission must never block error handling.
  }

  // Structured log for user API errors — `detail` is often the most actionable
  // field and is searchable in Sentry Logs.
  if (reason === "api_user_error" && error instanceof ApiError) {
    try {
      Sentry.logger.info("cli.api_error_silenced", {
        status: error.status,
        endpoint: error.endpoint,
        detail: error.detail,
      });
    } catch {
      // Logger may not be initialized — ignore.
    }
  }
}

// ---------------------------------------------------------------------------
// Grouping tags
// ---------------------------------------------------------------------------

/**
 * Strip quoted substrings and numeric/hex IDs from a resource string to
 * produce a stable "kind" for grouping.
 *
 * `"Project 'my-app' not found"` → `"Project not found"`
 * `"Issue 7420431306 not found."` → `"Issue not found."`
 */
export function extractResourceKind(resource: string): string {
  return resource
    .replace(/'[^']*'/g, "")
    .replace(/"[^"]*"/g, "")
    .replace(/\b[0-9a-f]{16,32}\b/gi, "")
    .replace(/\b\d{6,}\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Set `cli_error.*` tags on a Sentry scope for an error that will be
 * captured. These tags are matched by server-side fingerprint rules to
 * achieve stable grouping without SDK-side fingerprint logic.
 *
 * Tags set:
 * - `cli_error.class` — error class name (e.g. `"ContextError"`)
 * - `cli_error.kind`  — stable grouping key derived from structured fields
 * - `cli_error.api_status` — HTTP status (ApiError only)
 */
function setGroupingTags(scope: Sentry.Scope, error: unknown): void {
  if (!(error instanceof Error)) {
    return;
  }

  scope.setTag("cli_error.class", error.name);

  if (error instanceof ContextError) {
    scope.setTag("cli_error.kind", error.resource);
  } else if (error instanceof ResolutionError) {
    scope.setTag(
      "cli_error.kind",
      extractResourceKind(error.resource) +
        " " +
        extractResourceKind(error.headline)
    );
  } else if (error instanceof ValidationError) {
    scope.setTag("cli_error.kind", error.field ?? "");
  } else if (error instanceof ApiError) {
    scope.setTag("cli_error.api_status", String(error.status));
    scope.setTag("cli_error.kind", String(error.status));
  } else if (error instanceof SeerError) {
    scope.setTag("cli_error.kind", error.reason);
  } else if (error instanceof AuthError) {
    scope.setTag("cli_error.kind", error.reason);
  } else if (error instanceof UpgradeError) {
    scope.setTag("cli_error.kind", error.reason);
  } else if (error instanceof DeviceFlowError) {
    scope.setTag("cli_error.kind", error.code);
  } else if (error instanceof TimeoutError) {
    scope.setTag("cli_error.kind", "timeout");
  }
}

// ---------------------------------------------------------------------------
// Structured context
// ---------------------------------------------------------------------------

/** Attach a `cli_error` context with full structured details for Discover. */
function setCliErrorContext(scope: Sentry.Scope, error: unknown): void {
  if (error instanceof ApiError) {
    scope.setContext("api_error", {
      status: error.status,
      endpoint: error.endpoint,
      detail: error.detail,
    });
  } else if (error instanceof ContextError) {
    scope.setContext("cli_error", {
      resource: error.resource,
      command: error.command,
    });
  } else if (error instanceof ResolutionError) {
    scope.setContext("cli_error", {
      resource: error.resource,
      headline: error.headline,
      hint: error.hint,
    });
  } else if (error instanceof SeerError) {
    scope.setContext("cli_error", {
      reason: error.reason,
      org_slug: error.orgSlug,
    });
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Report a command-level error to Sentry.
 *
 * - Silenced errors emit a metric and return without calling `captureException`.
 * - Captured errors get grouping tags + structured context on a fresh scope.
 */
export function reportCliError(error: unknown): void {
  const silenced = classifySilenced(error);
  if (silenced) {
    recordSilencedError(error, silenced);
    return;
  }

  Sentry.withScope((scope) => {
    setGroupingTags(scope, error);
    setCliErrorContext(scope, error);
    Sentry.captureException(error);
  });
}

/**
 * Enrich an error event with `cli_error.*` tags for server-side fingerprinting.
 *
 * Called from `beforeSend` to catch events that bypass {@link reportCliError}
 * (uncaught exceptions, unhandled rejections, best-effort background captures).
 * Only sets tags when `cli_error.class` isn't already present (events from
 * `reportCliError` already have them).
 */
export function enrichEventWithGroupingTags(
  event: Sentry.ErrorEvent
): Sentry.ErrorEvent {
  // Skip if reportCliError already set the tags via withScope.
  if (event.tags?.["cli_error.class"]) {
    return event;
  }

  // Use the last (outermost/thrown) exception in the chain, not the first
  // (innermost/root cause). Per the Sentry protocol, values[0] is the root
  // cause and values[n-1] is the actually-thrown exception.
  const values = event.exception?.values;
  const exc = values?.[values.length - 1];
  if (!exc?.type) {
    return event;
  }

  event.tags = event.tags ?? {};
  event.tags["cli_error.class"] = exc.type;

  return event;
}
