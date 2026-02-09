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
// Profile types
export type {
  Flamegraph,
  FlamegraphFrame,
  FlamegraphFrameInfo,
  FlamegraphProfile,
  FlamegraphProfileMetadata,
  HotPath,
  ProfileAnalysis,
  ProfileFunctionRow,
  ProfileFunctionsResponse,
  TransactionAliasEntry,
} from "./profile.js";
export {
  FlamegraphFrameInfoSchema,
  FlamegraphFrameSchema,
  FlamegraphProfileMetadataSchema,
  FlamegraphProfileSchema,
  FlamegraphSchema,
  ProfileFunctionRowSchema,
  ProfileFunctionsResponseSchema,
} from "./profile.js";
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
  DetailedLogsResponse,
  DetailedSentryLog,
  DeviceContext,
  ExceptionEntry,
  ExceptionValue,
  IssueLevel,
  IssuePriority,
  IssueStatus,
  IssueSubstatus,
  LogSeverity,
  LogsResponse,
  Mechanism,
  OrganizationLinks,
  OsContext,
  ProjectKey,
  Region,
  Release,
  RequestEntry,
  SentryEvent,
  SentryIssue,
  SentryLog,
  SentryOrganization,
  SentryProject,
  SentryUser,
  Span,
  StackFrame,
  Stacktrace,
  TraceContext,
  TraceSpan,
  UserGeo,
  UserRegionsResponse,
} from "./sentry.js";
export {
  BreadcrumbSchema,
  BreadcrumbsEntrySchema,
  BrowserContextSchema,
  DetailedLogsResponseSchema,
  DetailedSentryLogSchema,
  DeviceContextSchema,
  ExceptionEntrySchema,
  ExceptionValueSchema,
  ISSUE_LEVELS,
  ISSUE_PRIORITIES,
  ISSUE_STATUSES,
  LOG_SEVERITIES,
  LogsResponseSchema,
  MechanismSchema,
  OrganizationLinksSchema,
  OsContextSchema,
  ProjectKeySchema,
  RegionSchema,
  ReleaseSchema,
  RequestEntrySchema,
  SentryEventSchema,
  SentryIssueSchema,
  SentryLogSchema,
  SentryOrganizationSchema,
  SentryProjectSchema,
  SentryUserSchema,
  SpanSchema,
  StackFrameSchema,
  StacktraceSchema,
  TraceContextSchema,
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
