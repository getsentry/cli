/**
 * CLI Error Hierarchy
 *
 * Unified error classes for consistent error handling across the CLI.
 */

import {
  buildBillingUrl,
  buildOrgSettingsUrl,
  buildSeerSettingsUrl,
} from "./sentry-urls.js";

/**
 * Base class for all CLI errors.
 *
 * @param message - Error message for display
 * @param exitCode - Process exit code (default: 1)
 */
export class CliError extends Error {
  readonly exitCode: number;

  constructor(message: string, exitCode = 1) {
    super(message);
    this.name = "CliError";
    this.exitCode = exitCode;
  }

  /**
   * Format error for user display. Override in subclasses to add details.
   */
  format(): string {
    return this.message;
  }
}

/**
 * API request errors from Sentry.
 *
 * @param message - Error summary
 * @param status - HTTP status code
 * @param detail - Detailed error message from API response
 * @param endpoint - API endpoint that failed
 */
export class ApiError extends CliError {
  readonly status: number;
  readonly detail?: string;
  readonly endpoint?: string;

  constructor(
    message: string,
    status: number,
    detail?: string,
    endpoint?: string
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
    this.endpoint = endpoint;
  }

  override format(): string {
    let msg = this.message;
    if (this.endpoint) {
      msg += `\n  Endpoint: ${this.endpoint}`;
    }
    if (this.detail && this.detail !== this.message) {
      msg += `\n  ${this.detail}`;
    }
    return msg;
  }
}

export type AuthErrorReason = "not_authenticated" | "expired" | "invalid";

/** Options for AuthError */
export type AuthErrorOptions = {
  /** Skip auto-login flow when this error is caught (for auth commands) */
  skipAutoAuth?: boolean;
};

/**
 * Authentication errors.
 *
 * @param reason - Type of auth failure
 * @param message - Custom message (uses default if not provided)
 * @param options - Additional options (e.g., skipAutoAuth for auth commands)
 */
export class AuthError extends CliError {
  readonly reason: AuthErrorReason;
  /** When true, the auto-login flow should not be triggered for this error */
  readonly skipAutoAuth: boolean;

  constructor(
    reason: AuthErrorReason,
    message?: string,
    options?: AuthErrorOptions
  ) {
    const defaultMessages: Record<AuthErrorReason, string> = {
      not_authenticated: "Not authenticated. Run 'sentry auth login' first.",
      expired:
        "Authentication expired. Run 'sentry auth login' to re-authenticate.",
      invalid: "Invalid authentication token.",
    };
    super(message ?? defaultMessages[reason]);
    this.name = "AuthError";
    this.reason = reason;
    this.skipAutoAuth = options?.skipAutoAuth ?? false;
  }
}

/**
 * Configuration or DSN errors.
 *
 * @param message - Error description
 * @param suggestion - Helpful hint for resolving the error
 */
export class ConfigError extends CliError {
  readonly suggestion?: string;

  constructor(message: string, suggestion?: string) {
    super(message);
    this.name = "ConfigError";
    this.suggestion = suggestion;
  }

  override format(): string {
    let msg = this.message;
    if (this.suggestion) {
      msg += `\n\nSuggestion: ${this.suggestion}`;
    }
    return msg;
  }
}

/**
 * Thrown when a command produces valid output but should exit non-zero.
 *
 * Unlike other errors, the output data is rendered to stdout (not stderr)
 * through the normal output system — the `buildCommand` wrapper catches
 * this before it reaches the global error handler. Think "HTTP 404 body":
 * useful data, but the operation itself failed.
 *
 * @param data - The output data to render (same type as CommandOutput.data)
 */
export class OutputError extends CliError {
  readonly data: unknown;

  constructor(data: unknown) {
    super("", 1);
    this.name = "OutputError";
    this.data = data;
  }
}

const DEFAULT_CONTEXT_ALTERNATIVES = [
  "Run from a directory with a Sentry DSN in source code or .env files",
  "Set SENTRY_ORG and SENTRY_PROJECT (or SENTRY_DSN) environment variables",
  "Run 'sentry org list' to find your organization slug",
  "Run 'sentry project list <org>/' to find project slugs",
] as const;

/**
 * Build the formatted context error message with usage hints.
 *
 * @param resource - What is required (e.g., "Organization", "Trace ID and span ID")
 * @param command - Single-line CLI usage example (e.g., "sentry org view <org-slug>")
 * @param alternatives - Alternative ways to provide the context
 * @param note - Optional informational context (e.g., "Found 2 DSN(s) that could not be resolved").
 *   Rendered as a separate "Note:" section after alternatives. Use this for diagnostic
 *   information that explains what the CLI tried — keep alternatives purely actionable.
 * @param isAutoDetect - When true, the headline explains that auto-detection was attempted
 *   and failed rather than stating the value "is required". Callers that omit `alternatives`
 *   (using defaults) trigger this automatically via the {@link ContextError} constructor.
 * @returns Formatted multi-line error message
 */
function buildContextMessage(
  resource: string,
  command: string,
  alternatives: string[],
  options?: { note?: string; isAutoDetect?: boolean }
): string {
  const { note, isAutoDetect } = options ?? {};
  // Compound resources ("X and Y") need plural grammar
  const isPlural = resource.includes(" and ");
  const pronoun = isPlural ? "them" : "it";

  const lines = isAutoDetect
    ? [
        `Could not auto-detect ${resource.toLowerCase()}.`,
        "",
        `Provide ${pronoun} explicitly:`,
        `  ${command}`,
      ]
    : [
        `${resource} ${isPlural ? "are" : "is"} required.`,
        "",
        `Specify ${pronoun} using:`,
        `  ${command}`,
      ];

  if (alternatives.length > 0) {
    lines.push("", "Or:");
    for (const alt of alternatives) {
      lines.push(`  - ${alt}`);
    }
  }
  if (note) {
    lines.push("", `Note: ${note}`);
  }
  return lines.join("\n");
}

/**
 * Build the formatted resolution error message for entities that could not be found or resolved.
 *
 * @param resource - The entity that could not be resolved (e.g., "Issue 99124558")
 * @param headline - Describes the failure (e.g., "not found", "is ambiguous", "could not be resolved")
 * @param hint - Primary usage example or suggestion
 * @param suggestions - Additional help bullets shown under "Or:"
 * @returns Formatted multi-line error message
 */
function buildResolutionMessage(
  resource: string,
  headline: string,
  hint: string,
  suggestions: string[]
): string {
  const lines = [`${resource} ${headline}.`, "", "Try:", `  ${hint}`];
  if (suggestions.length > 0) {
    lines.push("", "Or:");
    for (const s of suggestions) {
      lines.push(`  - ${s}`);
    }
  }
  return lines.join("\n");
}

/**
 * Missing required context errors (org, project, etc).
 *
 * Use when the user **omitted** a required value entirely. For cases where the
 * user **provided** a value that couldn't be matched, use {@link ResolutionError}
 * instead. For malformed input, use {@link ValidationError}.
 *
 * When `alternatives` is omitted (using defaults), the error assumes auto-detection
 * was attempted and produces a "Could not auto-detect ..." headline. When `alternatives`
 * is explicitly provided (including `[]`), the error uses "... is/are required." instead.
 *
 * @param resource - What is required (e.g., "Organization", "Organization and project").
 *   Use " and " to join compound resources — triggers plural grammar ("are required").
 * @param command - **Single-line** CLI usage example (e.g., "sentry org view <org-slug>").
 *   Must not contain newlines — multi-line messages indicate a resolution failure
 *   that should use {@link ResolutionError}.
 * @param alternatives - Alternative ways to resolve (defaults to DSN/project detection hints).
 *   Pass `[]` when the defaults are irrelevant (e.g., for missing positional IDs like Trace ID).
 * @param note - Optional informational context rendered as a separate "Note:" section.
 *   Use for diagnostic info (e.g., "Found 2 DSN(s) that could not be resolved").
 *   Keep alternatives purely actionable — put explanations here instead.
 */
export class ContextError extends CliError {
  readonly resource: string;
  readonly command: string;
  readonly alternatives: string[];
  readonly note?: string;

  constructor(
    resource: string,
    command: string,
    alternatives?: string[],
    note?: string
  ) {
    // When alternatives is omitted, auto-detection was tried and failed
    const isAutoDetect = alternatives === undefined;
    const resolvedAlternatives = alternatives ?? [
      ...DEFAULT_CONTEXT_ALTERNATIVES,
    ];

    // Include full formatted message so it's shown even when caught by external handlers
    super(
      buildContextMessage(resource, command, resolvedAlternatives, {
        note,
        isAutoDetect,
      })
    );
    this.name = "ContextError";
    this.resource = resource;
    this.command = command;
    this.alternatives = resolvedAlternatives;
    this.note = note;

    // Dev-time assertion: command must be a single-line CLI usage example.
    // Multi-line commands are a sign the caller should use ResolutionError.
    if (command.includes("\n")) {
      throw new Error(
        "ContextError command must be a single-line CLI usage hint. " +
          `Use ResolutionError for resolution failures. Got: "${command.slice(0, 80)}..."`
      );
    }
  }

  override format(): string {
    // Message already contains the formatted output
    return this.message;
  }
}

/**
 * Resolution errors for entities that could not be found or resolved.
 *
 * Use when the user **provided** a value but it couldn't be matched — as
 * opposed to {@link ContextError}, which is for when the user **omitted** a
 * required value entirely.
 *
 * Output format:
 * ```
 * Project 'cli' not found.
 *
 * Try:
 *   sentry issue list <org>/cli
 *
 * Or:
 *   - No project with this slug found in any accessible organization
 * ```
 *
 * @param resource - The entity that failed to resolve (e.g., "Issue 99124558", "Project 'cli'")
 * @param headline - Short phrase describing the failure (e.g., "not found", "is ambiguous", "could not be resolved")
 * @param hint - Primary usage example or suggestion (shown under "Try:")
 * @param suggestions - Additional help bullets shown under "Or:" (defaults to empty)
 */
export class ResolutionError extends CliError {
  readonly resource: string;
  readonly headline: string;
  readonly hint: string;
  readonly suggestions: string[];

  constructor(
    resource: string,
    headline: string,
    hint: string,
    suggestions: string[] = []
  ) {
    super(buildResolutionMessage(resource, headline, hint, suggestions));
    this.name = "ResolutionError";
    this.resource = resource;
    this.headline = headline;
    this.hint = hint;
    this.suggestions = suggestions;
  }

  override format(): string {
    return this.message;
  }
}

/**
 * Input validation errors.
 *
 * @param message - Validation failure description
 * @param field - Name of the invalid field
 */
export class ValidationError extends CliError {
  readonly field?: string;

  constructor(message: string, field?: string) {
    super(message);
    this.name = "ValidationError";
    this.field = field;
  }
}

/**
 * OAuth device flow errors (RFC 8628).
 *
 * @param code - OAuth error code (e.g., "authorization_pending", "slow_down")
 * @param description - Human-readable error description
 */
export class DeviceFlowError extends CliError {
  readonly code: string;

  constructor(code: string, description?: string) {
    super(description ?? code);
    this.name = "DeviceFlowError";
    this.code = code;
  }
}

// Upgrade Errors

export type UpgradeErrorReason =
  | "unknown_method"
  | "unsupported_operation"
  | "network_error"
  | "execution_failed"
  | "version_not_found"
  | "offline_cache_miss";

/**
 * Upgrade-related errors.
 *
 * @param reason - Type of upgrade failure
 * @param message - Custom message (uses default if not provided)
 */
export class UpgradeError extends CliError {
  readonly reason: UpgradeErrorReason;

  constructor(reason: UpgradeErrorReason, message?: string) {
    const defaultMessages: Record<UpgradeErrorReason, string> = {
      unknown_method:
        "Could not detect installation method. Use --method to specify.",
      unsupported_operation:
        "This operation is not supported for this installation method.",
      network_error: "Failed to fetch version information.",
      execution_failed: "Upgrade command failed.",
      version_not_found: "The specified version was not found.",
      offline_cache_miss:
        "Cannot upgrade offline — no pre-downloaded update is available.",
    };
    super(message ?? defaultMessages[reason]);
    this.name = "UpgradeError";
    this.reason = reason;
  }
}

// Seer Errors

export type SeerErrorReason = "not_enabled" | "no_budget" | "ai_disabled";

/**
 * Seer-specific errors with actionable suggestions.
 *
 * @param reason - Type of Seer failure
 * @param orgSlug - Organization slug for constructing settings URLs
 */
export class SeerError extends CliError {
  readonly reason: SeerErrorReason;
  readonly orgSlug?: string;

  constructor(reason: SeerErrorReason, orgSlug?: string) {
    const messages: Record<SeerErrorReason, string> = {
      not_enabled: "Seer is not enabled for this organization.",
      no_budget: "Seer requires a paid plan.",
      ai_disabled: "AI features are disabled for this organization.",
    };
    super(messages[reason]);
    this.name = "SeerError";
    this.reason = reason;
    this.orgSlug = orgSlug;
  }

  override format(): string {
    // When org slug is known, suggest the direct trial start command.
    // The interactive trial prompt in bin.ts handles TTY users; this
    // message is the fallback for non-interactive contexts (AI agents, CI)
    // where the prompt can't fire — hence the direct command suggestion
    // (CLI-1D/BW/98, 237 users combined).
    const trialHint = this.orgSlug
      ? `\n\nStart a free trial:\n  sentry trial start seer ${this.orgSlug}`
      : "\n\nYou may be eligible for a free trial:\n  sentry trial list";

    // When org slug is known, provide direct URLs to settings
    if (this.orgSlug) {
      const suggestions: Record<SeerErrorReason, string> = {
        not_enabled: `To enable Seer:\n  ${buildSeerSettingsUrl(this.orgSlug)}${trialHint}`,
        no_budget: `To use Seer features, upgrade your plan:\n  ${buildBillingUrl(this.orgSlug, "seer")}${trialHint}`,
        // ai_disabled is an admin decision — don't suggest trial
        ai_disabled: `To enable AI features:\n  ${buildOrgSettingsUrl(this.orgSlug, "hideAiFeatures")}`,
      };
      return `${this.message}\n\n${suggestions[this.reason]}`;
    }

    // Fallback when org slug is unknown - give generic guidance
    const fallbackSuggestions: Record<SeerErrorReason, string> = {
      not_enabled: `To enable Seer, visit your organization's Seer settings in Sentry.${trialHint}`,
      no_budget: `To use Seer features, upgrade your plan in your organization's billing settings.${trialHint}`,
      // ai_disabled is an admin decision — don't suggest trial
      ai_disabled:
        "To enable AI features, check the 'Hide AI Features' setting in your organization settings.",
    };
    return `${this.message}\n\n${fallbackSuggestions[this.reason]}`;
  }
}

/**
 * Timeout errors for long-running polling operations.
 *
 * Use when a polling loop exceeds its time budget. Provides structured
 * hints so the user knows the operation may still complete in the background.
 *
 * @param message - What timed out (e.g., "Operation timed out after 6 minutes.")
 * @param hint - Actionable suggestion (e.g., "Run the command again — the analysis may finish in the background.")
 */
export class TimeoutError extends CliError {
  readonly hint?: string;

  constructor(message: string, hint?: string) {
    super(message);
    this.name = "TimeoutError";
    this.hint = hint;
  }

  override format(): string {
    let msg = this.message;
    if (this.hint) {
      msg += `\n\n${this.hint}`;
    }
    return msg;
  }
}

/**
 * Error thrown by the init wizard when it has already displayed
 * the error via clack UI. The `rendered` flag tells the framework
 * error handler to skip its own formatting.
 */
export class WizardError extends CliError {
  readonly rendered: boolean;

  constructor(message: string, options?: { rendered?: boolean }) {
    super(message);
    this.name = "WizardError";
    this.rendered = options?.rendered ?? true;
  }
}

// Error Utilities

/**
 * Thrown when an operation is cancelled via an AbortSignal.
 *
 * Matches the `error.name === "AbortError"` convention used throughout the
 * codebase (version-check.ts, sentry-client.ts, binary.ts) to detect and
 * silently swallow cancellation errors.
 */
export class AbortError extends Error {
  override name = "AbortError" as const;
  constructor() {
    super("The operation was aborted");
  }
}

/**
 * Convert an unknown value to a human-readable string.
 *
 * Handles Error instances (`.message`), plain objects (`JSON.stringify`),
 * strings (as-is), and other primitives (`String()`).
 * Use this instead of bare `String(value)` when the value might be a
 * plain object — `String({})` produces the unhelpful `"[object Object]"`.
 *
 * @param value - Any thrown or unknown value
 * @returns Human-readable string representation
 */
export function stringifyUnknown(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value instanceof Error) {
    return value.message;
  }
  if (value && typeof value === "object") {
    // JSON.stringify can throw on circular references or BigInt values.
    // Fall back to String() which is always safe.
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

/**
 * Format any error for user display.
 * Uses CliError.format() for CLI errors, falls back to stringifyUnknown.
 *
 * @param error - Any thrown value
 * @returns Formatted error string
 */
export function formatError(error: unknown): string {
  if (error instanceof CliError) {
    return error.format();
  }
  return stringifyUnknown(error);
}

/**
 * Get process exit code for an error.
 *
 * @param error - Any thrown value
 * @returns Exit code (from CliError.exitCode or 1 for other errors)
 */
export function getExitCode(error: unknown): number {
  if (error instanceof CliError) {
    return error.exitCode;
  }
  return 1;
}

/** Result when the guarded operation succeeded */
export type AuthGuardSuccess<T> = { ok: true; value: T };

/** Result when a non-auth error was caught */
export type AuthGuardFailure = { ok: false; error: unknown };

/** Discriminated union returned by {@link withAuthGuard} */
export type AuthGuardResult<T> = AuthGuardSuccess<T> | AuthGuardFailure;

/**
 * Execute an async operation, rethrowing {@link AuthError} while capturing
 * all other failures in a discriminated result.
 *
 * This is the standard "safe fetch" pattern used throughout the CLI:
 * auth errors must propagate so the auto-login flow in bin.ts can
 * trigger, but transient failures (network, 404, permissions) should
 * degrade gracefully. Callers inspect `result.ok` to decide what to do
 * and have access to the caught error via `result.error` when needed.
 *
 * @param fn - Async operation that may throw
 * @returns `{ ok: true, value }` on success, `{ ok: false, error }` on non-auth failure
 * @throws {AuthError} Always re-thrown so the auto-login flow can trigger
 */
export async function withAuthGuard<T>(
  fn: () => Promise<T>
): Promise<AuthGuardResult<T>> {
  try {
    return { ok: true, value: await fn() };
  } catch (error) {
    if (error instanceof AuthError) {
      throw error;
    }
    return { ok: false, error };
  }
}
