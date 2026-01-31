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
    if (this.detail && this.detail !== this.message) {
      msg += `\n  ${this.detail}`;
    }
    return msg;
  }
}

export type AuthErrorReason = "not_authenticated" | "expired" | "invalid";

/**
 * Authentication errors.
 *
 * @param reason - Type of auth failure
 * @param message - Custom message (uses default if not provided)
 */
export class AuthError extends CliError {
  readonly reason: AuthErrorReason;

  constructor(reason: AuthErrorReason, message?: string) {
    const defaultMessages: Record<AuthErrorReason, string> = {
      not_authenticated: "Not authenticated. Run 'sentry auth login' first.",
      expired:
        "Authentication expired. Run 'sentry auth login' to re-authenticate.",
      invalid: "Invalid authentication token.",
    };
    super(message ?? defaultMessages[reason]);
    this.name = "AuthError";
    this.reason = reason;
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

const DEFAULT_CONTEXT_ALTERNATIVES = [
  "Run from a directory with a Sentry-configured project",
  "Set SENTRY_DSN environment variable",
] as const;

/**
 * Build the formatted context error message with usage hints.
 *
 * @param resource - What is required (e.g., "Organization")
 * @param command - Usage example command
 * @param alternatives - Alternative ways to provide the context
 * @returns Formatted multi-line error message
 */
function buildContextMessage(
  resource: string,
  command: string,
  alternatives: string[]
): string {
  const lines = [
    `${resource} is required.`,
    "",
    "Specify it using:",
    `  ${command}`,
  ];
  if (alternatives.length > 0) {
    lines.push("", "Or:");
    for (const alt of alternatives) {
      lines.push(`  - ${alt}`);
    }
  }
  return lines.join("\n");
}

/**
 * Missing required context errors (org, project, etc).
 *
 * Provides consistent error formatting with usage hints and alternatives.
 *
 * @param resource - What is required (e.g., "Organization", "Organization and project")
 * @param command - Primary usage example (e.g., "sentry org view <org-slug>")
 * @param alternatives - Alternative ways to resolve (defaults to DSN/project detection hints)
 */
export class ContextError extends CliError {
  readonly resource: string;
  readonly command: string;
  readonly alternatives: string[];

  constructor(
    resource: string,
    command: string,
    alternatives: string[] = [...DEFAULT_CONTEXT_ALTERNATIVES]
  ) {
    // Include full formatted message so it's shown even when caught by external handlers
    super(buildContextMessage(resource, command, alternatives));
    this.name = "ContextError";
    this.resource = resource;
    this.command = command;
    this.alternatives = alternatives;
  }

  override format(): string {
    // Message already contains the formatted output
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

// ─────────────────────────────────────────────────────────────────────────────
// Upgrade Errors
// ─────────────────────────────────────────────────────────────────────────────

export type UpgradeErrorReason =
  | "unknown_method"
  | "network_error"
  | "execution_failed"
  | "version_not_found";

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
      network_error: "Failed to fetch version information.",
      execution_failed: "Upgrade command failed.",
      version_not_found: "The specified version was not found.",
    };
    super(message ?? defaultMessages[reason]);
    this.name = "UpgradeError";
    this.reason = reason;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Seer Errors
// ─────────────────────────────────────────────────────────────────────────────

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
    // When org slug is known, provide direct URLs to settings
    if (this.orgSlug) {
      const suggestions: Record<SeerErrorReason, string> = {
        not_enabled: `To enable Seer:\n  ${buildSeerSettingsUrl(this.orgSlug)}`,
        no_budget: `To use Seer features, upgrade your plan:\n  ${buildBillingUrl(this.orgSlug, "seer")}`,
        ai_disabled: `To enable AI features:\n  ${buildOrgSettingsUrl(this.orgSlug, "hideAiFeatures")}`,
      };
      return `${this.message}\n\n${suggestions[this.reason]}`;
    }

    // Fallback when org slug is unknown - give generic guidance
    const fallbackSuggestions: Record<SeerErrorReason, string> = {
      not_enabled:
        "To enable Seer, visit your organization's Seer settings in Sentry.",
      no_budget:
        "To use Seer features, upgrade your plan in your organization's billing settings.",
      ai_disabled:
        "To enable AI features, check the 'Hide AI Features' setting in your organization settings.",
    };
    return `${this.message}\n\n${fallbackSuggestions[this.reason]}`;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Error Utilities
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Format any error for user display.
 * Uses CliError.format() for CLI errors, message for standard errors.
 *
 * @param error - Any thrown value
 * @returns Formatted error string
 */
export function formatError(error: unknown): string {
  if (error instanceof CliError) {
    return error.format();
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
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
