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

export {
  BreadcrumbSchema,
  BreadcrumbsEntrySchema,
  BrowserContextSchema,
  DeviceContextSchema,
  ExceptionEntrySchema,
  ExceptionValueSchema,
  ISSUE_LEVELS,
  ISSUE_PRIORITIES,
  ISSUE_STATUSES,
  MechanismSchema,
  OrganizationLinksSchema,
  OsContextSchema,
  ProjectKeySchema,
  RegionSchema,
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
  UserRegionsResponseSchema,
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
