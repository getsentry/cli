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

// Sentry API types and schemas
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
  Release,
  // Request types
  RequestEntry,
  // Event types
  SentryEvent,
  SentryIssue,
  // Organization & Project
  SentryOrganization,
  SentryProject,
  StackFrame,
  Stacktrace,
  TraceContext,
  UserGeo,
} from "./sentry.js";
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
  ReleaseSchema,
  RequestEntrySchema,
  SentryEventSchema,
  SentryIssueSchema,
  SentryOrganizationSchema,
  SentryProjectSchema,
  StackFrameSchema,
  StacktraceSchema,
  TraceContextSchema,
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
