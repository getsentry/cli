// biome-ignore-all lint/performance/noBarrelFile: intentional public API
/**
 * Type definitions for the Sentry CLI
 *
 * Re-exports all types from domain-specific modules.
 */

// DSN types
export type { DetectedDsn, DsnSource, ParsedDsn } from "../lib/dsn/types.js";
// AI Conversations types
export type {
  AIConversationSpan,
  ConversationListItem,
} from "./ai-conversations.js";
export {
  AIConversationSpanSchema,
  ConversationListItemSchema,
} from "./ai-conversations.js";
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
// Dashboard types
export type {
  DashboardDetail,
  DashboardListItem,
  DashboardWidget,
  DashboardWidgetLayout,
  DashboardWidgetQuery,
} from "./dashboard.js";
export {
  DashboardDetailSchema,
  DashboardListItemSchema,
  DashboardWidgetLayoutSchema,
  DashboardWidgetQuerySchema,
  DashboardWidgetSchema,
} from "./dashboard.js";
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
// Replay types and schemas
export type {
  ReplayActivityEvent,
  ReplayBrowser,
  ReplayDetails,
  ReplayDetailsResponse,
  ReplayDevice,
  ReplayGeo,
  ReplayIdsByResource,
  ReplayListItem,
  ReplayListResponse,
  ReplayOs,
  ReplayOtaUpdates,
  ReplayRecordingSegments,
  ReplayRelatedIssue,
  ReplayRelatedTrace,
  ReplaySdk,
  ReplayUser,
} from "./replay.js";
export {
  REPLAY_LIST_FIELDS,
  ReplayActivityEventSchema,
  ReplayBrowserSchema,
  ReplayDetailsOutputSchema,
  ReplayDetailsResponseSchema,
  ReplayDetailsSchema,
  ReplayDeviceSchema,
  ReplayGeoSchema,
  ReplayIdsByResourceSchema,
  ReplayListItemOutputSchema,
  ReplayListItemSchema,
  ReplayListResponseSchema,
  ReplayOsSchema,
  ReplayOtaUpdatesSchema,
  ReplayRecordingSegmentsSchema,
  ReplayRelatedIssueSchema,
  ReplayRelatedTraceSchema,
  ReplaySdkSchema,
  ReplayUserSchema,
  ReplayViewOutputSchema,
} from "./replay.js";
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
  CustomerTrialInfo,
  DetailedLogsResponse,
  DetailedSentryLog,
  DeviceContext,
  ExceptionEntry,
  ExceptionValue,
  IssueEvent,
  IssueLevel,
  IssueStatus,
  LogsResponse,
  Mechanism,
  OsContext,
  ProductTrial,
  ProjectKey,
  Region,
  ReplayContext,
  RepositoryProvider,
  RequestEntry,
  SentryDeploy,
  SentryEvent,
  SentryIssue,
  SentryLog,
  SentryOrganization,
  SentryProject,
  SentryRelease,
  SentryRepository,
  SentryTeam,
  SentryUser,
  SpanListItem,
  SpansResponse,
  StackFrame,
  Stacktrace,
  TraceContext,
  TraceItemAttribute,
  TraceItemDetail,
  TraceLog,
  TraceLogsResponse,
  TraceMeta,
  TraceSpan,
  TransactionListItem,
  TransactionsResponse,
  UserRegionsResponse,
} from "./sentry.js";
export {
  CustomerTrialInfoSchema,
  DetailedLogsResponseSchema,
  DetailedSentryLogSchema,
  ISSUE_LEVELS,
  ISSUE_STATUSES,
  IssueEventSchema,
  LogsResponseSchema,
  ProductTrialSchema,
  RegionSchema,
  RepositoryProviderSchema,
  SentryIssueSchema,
  SentryLogSchema,
  SentryRepositorySchema,
  SentryTeamSchema,
  SentryUserSchema,
  SpanListItemSchema,
  SpansResponseSchema,
  TraceItemAttributeSchema,
  TraceItemDetailSchema,
  TraceLogSchema,
  TraceLogsResponseSchema,
  TraceMetaSchema,
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
  /**
   * Zero-copy object capture for library mode.
   * When set, JSON objects are passed directly instead of serialized.
   */
  captureObject?: (obj: unknown) => void;
};
