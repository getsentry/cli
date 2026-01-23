// biome-ignore-all lint/performance/noBarrelFile: intentional public API
/**
 * Type definitions for the Sentry CLI
 *
 * Re-exports all types from domain-specific modules.
 */

// DSN types
export type { DetectedDsn, DsnSource, ParsedDsn } from "../lib/dsn/types.js";
export type {
  AutofixResponse,
  AutofixState,
  RootCause,
  SolutionArtifact,
} from "./autofix.js";
// Autofix types
export {
  extractRootCauses,
  extractSolution,
  isTerminalStatus,
  SolutionArtifactSchema,
  TERMINAL_STATUSES,
} from "./autofix.js";
export type { CachedProject, SentryConfig } from "./config.js";
// Configuration types
export { SentryConfigSchema } from "./config.js";
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
  IssueLevel,
  IssueStatus,
  SentryEvent,
  SentryIssue,
  SentryOrganization,
  SentryProject,
} from "./sentry.js";
// Sentry API types and schemas
export {
  ISSUE_LEVELS,
  ISSUE_STATUSES,
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
