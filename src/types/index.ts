// biome-ignore-all lint/performance/noBarrelFile: intentional public API
/**
 * Type definitions for the Sentry CLI
 *
 * Re-exports all types from domain-specific modules.
 */

// DSN types
export type { DetectedDsn, DsnSource, ParsedDsn } from "../lib/dsn/types.js";

// Configuration types
export type {
  CachedProject,
  ProjectAliasEntry,
  ProjectAliases,
  SentryConfig,
} from "./config.js";
export {
  ProjectAliasEntrySchema,
  ProjectAliasesSchema,
  SentryConfigSchema,
} from "./config.js";

// OAuth types and schemas
export type {
  DeviceCodeResponse,
  TokenErrorResponse,
  TokenResponse,
} from "./oauth.js";
export {
  DeviceCodeResponseSchema,
  TokenErrorResponseSchema,
  TokenResponseSchema,
} from "./oauth.js";

// Seer types and helpers
export type {
  AutofixResponse,
  AutofixState,
  RootCause,
  SolutionArtifact,
} from "./seer.js";
export {
  extractRootCauses,
  extractSolution,
  isTerminalStatus,
  SolutionArtifactSchema,
  TERMINAL_STATUSES,
} from "./seer.js";

// Sentry API types
export type {
  Breadcrumb,
  BreadcrumbsEntry,
  BrowserContext,
  DeviceContext,
  ExceptionEntry,
  ExceptionValue,
  IssueLevel,
  IssuePriority,
  IssueStatus,
  IssueSubstatus,
  Mechanism,
  OrganizationLinks,
  OsContext,
  ProjectKey,
  Region,
  Release,
  RequestEntry,
  SentryEvent,
  SentryIssue,
  SentryOrganization,
  SentryProject,
  SentryUser,
  Span,
  StackFrame,
  Stacktrace,
  TraceContext,
  TraceEvent,
  TraceResponse,
  TraceSpan,
  UserGeo,
  UserRegionsResponse,
} from "./sentry.js";

// Sentry API constants and schemas (only those used for validation)
export {
  ISSUE_LEVELS,
  ISSUE_PRIORITIES,
  ISSUE_STATUSES,
  SentryOrganizationSchema,
} from "./sentry.js";

// I/O types

/**
 * Simple writer interface for output streams.
 * Compatible with process.stdout, process.stderr, and test mocks.
 * Avoids dependency on Node.js-specific types like NodeJS.WriteStream.
 */
export type Writer = {
  write(data: string): void;
};
