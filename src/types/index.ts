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
// OAuth types and schemas
export {
  DeviceCodeResponseSchema,
  TokenErrorResponseSchema,
  TokenResponseSchema,
} from "./oauth.js";
export type {
  AutofixResponse,
  AutofixState,
  RootCause,
  SolutionArtifact,
} from "./seer.js";
// Seer types
export {
  extractRootCauses,
  extractSolution,
  isTerminalStatus,
  SolutionArtifactSchema,
  TERMINAL_STATUSES,
} from "./seer.js";
export type {
  // Breadcrumb types
  Breadcrumb,
  BreadcrumbsEntry,
  // Context types
  BrowserContext,
  DeviceContext,
  // Stack trace types
  ExceptionEntry,
  ExceptionValue,
  // Issue types
  IssueLevel,
  IssuePriority,
  IssueStatus,
  IssueSubstatus,
  Mechanism,
  OsContext,
  // Project Key types
  ProjectKey,
  Release,
  // Request types
  RequestEntry,
  // Event types
  SentryEvent,
  SentryIssue,
  // Organization & Project
  SentryOrganization,
  SentryProject,
  // User
  SentryUser,
  // Span/Trace types
  Span,
  StackFrame,
  Stacktrace,
  TraceContext,
  TraceEvent,
  TraceResponse,
  TraceSpan,
  UserGeo,
} from "./sentry.js";
// Sentry API types and schemas
export {
  // Schemas
  BreadcrumbSchema,
  BreadcrumbsEntrySchema,
  BrowserContextSchema,
  DeviceContextSchema,
  ExceptionEntrySchema,
  ExceptionValueSchema,
  // Constants
  ISSUE_LEVELS,
  ISSUE_PRIORITIES,
  ISSUE_STATUSES,
  MechanismSchema,
  OsContextSchema,
  ProjectKeySchema,
  ReleaseSchema,
  RequestEntrySchema,
  SentryEventSchema,
  SentryIssueSchema,
  SentryOrganizationSchema,
  SentryProjectSchema,
  SentryUserSchema,
  SpanSchema,
  StackFrameSchema,
  StacktraceSchema,
  TraceContextSchema,
  TraceEventSchema,
  TraceResponseSchema,
  UserGeoSchema,
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
