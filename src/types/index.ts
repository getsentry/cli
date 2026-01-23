// biome-ignore-all lint/performance/noBarrelFile: intentional public API
/**
 * Type definitions for the Sentry CLI
 *
 * Re-exports all types from domain-specific modules.
 */

// DSN types
export type { DetectedDsn, DsnSource, ParsedDsn } from "../lib/dsn/types.js";
// Autofix types
export type {
  AutofixResponse,
  AutofixState,
  AutofixStatus,
  AutofixStep,
  AutofixTriggerResponse,
  AutofixUpdatePayload,
  RootCause,
  SolutionArtifact,
  SolutionData,
  SolutionStep,
  StoppingPoint,
} from "./autofix.js";
export {
  AUTOFIX_STATUSES,
  AutofixResponseSchema,
  AutofixStateSchema,
  AutofixStepSchema,
  AutofixTriggerResponseSchema,
  extractPrUrl,
  extractRootCauses,
  extractSolution,
  getLatestProgress,
  isTerminalStatus,
  RootCauseSchema,
  SolutionArtifactSchema,
  SolutionDataSchema,
  SolutionStepSchema,
  STOPPING_POINTS,
  TERMINAL_STATUSES,
} from "./autofix.js";
// Configuration types
export type { CachedProject, SentryConfig } from "./config.js";
export { SentryConfigSchema } from "./config.js";

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
  IssueLevel,
  IssueStatus,
  IssueSummary,
  IssueSummaryScores,
  SentryEvent,
  SentryIssue,
  SentryOrganization,
  SentryProject,
} from "./sentry.js";
export {
  ISSUE_LEVELS,
  ISSUE_STATUSES,
  IssueSummarySchema,
  IssueSummaryScoresSchema,
  SentryEventSchema,
  SentryIssueSchema,
  SentryOrganizationSchema,
  SentryProjectSchema,
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
