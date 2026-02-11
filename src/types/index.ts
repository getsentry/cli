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
// Sentry API types (SDK-derived + internal)
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
  IssueStatus,
  LogsResponse,
  Mechanism,
  OsContext,
  ProjectKey,
  Region,
  RepositoryProvider,
  RequestEntry,
  SentryEvent,
  SentryIssue,
  SentryLog,
  SentryOrganization,
  SentryProject,
  SentryRepository,
  SentryUser,
  StackFrame,
  Stacktrace,
  TraceContext,
  TraceSpan,
  TransactionListItem,
  TransactionsResponse,
  UserRegionsResponse,
} from "./sentry.js";

export {
  DetailedLogsResponseSchema,
  DetailedSentryLogSchema,
  ISSUE_LEVELS,
  ISSUE_STATUSES,
  LogsResponseSchema,
  RegionSchema,
  RepositoryProviderSchema,
  SentryLogSchema,
  SentryRepositorySchema,
  SentryUserSchema,
  TransactionListItemSchema,
  TransactionsResponseSchema,
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
