/**
 * Sentry API Types
 *
 * Types representing Sentry API resources.
 *
 * SDK-backed types (Organization, Project, Issue, Event, ProjectKey) are derived
 * from `@sentry/api` response types using `Partial<SdkType> & RequiredCore`.
 * This keeps all SDK-documented fields available with correct types while making
 * non-core fields optional for flexibility (test mocks, partial API responses).
 *
 * Internal types not covered by the SDK (Region, User, logs) use Zod schemas
 * for runtime validation. Event entry types (exceptions, breadcrumbs, etc.)
 * are plain TypeScript interfaces since they are only used for type annotations.
 */

import type {
  IssueEventDetailsResponse,
  RetrieveAnIssueResponse as SdkIssueDetail,
  ListOrganizations as SdkOrganizationList,
  ProjectKey as SdkProjectKey,
  OrganizationProjectResponseDict as SdkProjectList,
} from "@sentry/api";
import { z } from "zod";

// SDK-derived types

// Organization

/**
 * A Sentry organization.
 *
 * Based on the `@sentry/api` list-organizations response type.
 * Core identifiers are required; other SDK fields are available but optional,
 * allowing test mocks and list-endpoint responses to omit them.
 */
export type SentryOrganization = Partial<SdkOrganizationList[number]> & {
  id: string;
  slug: string;
  name: string;
};

// Project

/** Element type of the SDK's list-projects response */
type SdkProjectListItem = SdkProjectList[number];

/**
 * A Sentry project.
 *
 * Based on the `@sentry/api` list-projects response type.
 * The `organization` field is present in detail responses but absent in list responses,
 * so it is declared as an optional extension.
 */
export type SentryProject = Partial<SdkProjectListItem> & {
  id: string;
  slug: string;
  name: string;
  /** Organization context (present in detail responses, absent in list) */
  organization?: {
    id: string;
    slug: string;
    name: string;
    [key: string]: unknown;
  };
  /** Project status (returned by API but not in the OpenAPI spec) */
  status?: string;
};

// Issue Constants

export const ISSUE_STATUSES = ["resolved", "unresolved", "ignored"] as const;
export type IssueStatus = (typeof ISSUE_STATUSES)[number];

export const ISSUE_LEVELS = [
  "fatal",
  "error",
  "warning",
  "info",
  "debug",
] as const;
export type IssueLevel = (typeof ISSUE_LEVELS)[number];

// Issue

/**
 * A Sentry issue.
 *
 * Based on the `@sentry/api` retrieve-issue response type.
 * Core identifiers are required; other SDK fields are available but optional.
 * Includes extensions for fields returned by the API but not in the OpenAPI spec.
 *
 * The `metadata` field is overridden from the SDK's discriminated union to a single
 * object with all optional fields, matching how the API actually returns data.
 */
export type SentryIssue = Omit<Partial<SdkIssueDetail>, "metadata"> & {
  id: string;
  shortId: string;
  title: string;
  /** Issue metadata (value, filename, function, etc.) */
  metadata?: {
    value?: string;
    type?: string;
    filename?: string;
    function?: string;
    title?: string;
    display_title_with_tree_label?: boolean;
    [key: string]: unknown;
  };
  /** Issue substatus (not in OpenAPI spec) */
  substatus?: string | null;
  /** Issue priority (not in OpenAPI spec) */
  priority?: string;
  /** Whether the issue is unhandled (not in OpenAPI spec) */
  isUnhandled?: boolean;
  /** Platform of the issue (not in OpenAPI spec) */
  platform?: string;
};

// Event

/**
 * A Sentry event.
 *
 * Based on the `@sentry/api` IssueEventDetailsResponse type.
 * Core identifier (eventID) is required; other SDK fields are available but optional.
 *
 * The `contexts` field is overridden from the SDK's generic `Record<string,unknown>`
 * to include typed sub-contexts (trace, browser, os, device) that our formatters access.
 * Additional fields not in the OpenAPI spec are also included.
 */
export type SentryEvent = Omit<
  Partial<IssueEventDetailsResponse>,
  "contexts"
> & {
  eventID: string;
  /** Event contexts with typed sub-contexts */
  contexts?: {
    trace?: TraceContext;
    browser?: BrowserContext;
    os?: OsContext;
    device?: DeviceContext;
    [key: string]: unknown;
  } | null;
  /** Date the event was created (not in OpenAPI spec) */
  dateCreated?: string;
  /** Event fingerprints (not in OpenAPI spec) */
  fingerprints?: string[];
  /** Release associated with the event (not in OpenAPI spec) */
  release?: {
    version: string;
    shortVersion?: string;
    dateCreated?: string;
    dateReleased?: string | null;
    [key: string]: unknown;
  } | null;
  /** SDK update suggestions (not in OpenAPI spec) */
  sdkUpdates?: Array<{
    type?: string;
    sdkName?: string;
    newSdkVersion?: string;
    sdkUrl?: string;
    [key: string]: unknown;
  }>;
  /** URL/function where the error occurred (not in OpenAPI spec for events) */
  culprit?: string | null;
};

// Project Keys (DSN)

/**
 * A Sentry project key (DSN).
 *
 * Based on the `@sentry/api` ProjectKey type.
 * Core fields are required; other SDK fields are available but optional.
 */
export type ProjectKey = Partial<SdkProjectKey> & {
  id: string;
  name: string;
  isActive: boolean;
  dsn: {
    public: string;
    secret: string;
    [key: string]: unknown;
  };
};

// Internal types with Zod schemas (runtime-validated, not in @sentry/api)

// Region

/** A Sentry region (e.g., US, EU) */
export const RegionSchema = z.object({
  name: z.string(),
  url: z.string().url(),
});

export type Region = z.infer<typeof RegionSchema>;

/** Response from /api/0/users/me/regions/ endpoint */
export const UserRegionsResponseSchema = z.object({
  regions: z.array(RegionSchema),
});

export type UserRegionsResponse = z.infer<typeof UserRegionsResponseSchema>;

// User

export const SentryUserSchema = z
  .object({
    id: z.string(),
    email: z.string().optional(),
    username: z.string().optional(),
    name: z.string().optional(),
  })
  .passthrough();

export type SentryUser = z.infer<typeof SentryUserSchema>;

// Plain TypeScript interfaces (type annotations only, no runtime validation)

// Event Contexts

/** Trace context from event.contexts.trace */
export type TraceContext = {
  trace_id?: string;
  span_id?: string;
  parent_span_id?: string | null;
  op?: string;
  status?: string;
  description?: string | null;
  [key: string]: unknown;
};

/** Browser context from event.contexts.browser */
export type BrowserContext = {
  name?: string;
  version?: string;
  type?: "browser";
  [key: string]: unknown;
};

/** Operating system context from event.contexts.os */
export type OsContext = {
  name?: string;
  version?: string;
  type?: "os";
  [key: string]: unknown;
};

/** Device context from event.contexts.device */
export type DeviceContext = {
  family?: string;
  model?: string;
  brand?: string;
  type?: "device";
  [key: string]: unknown;
};

// Trace Spans

/**
 * Span from /trace/{traceId}/ endpoint with nested children.
 * This endpoint returns a hierarchical structure unlike /events-trace/.
 *
 * The API may return either `timestamp` or `end_timestamp` (or both) depending
 * on the span source. Code should check both fields when reading the end time.
 */
export type TraceSpan = {
  span_id: string;
  parent_span_id?: string | null;
  op?: string;
  description?: string | null;
  start_timestamp: number;
  /** End timestamp in seconds (legacy field, prefer end_timestamp) */
  timestamp?: number;
  /** End timestamp in seconds (preferred over timestamp) */
  end_timestamp?: number;
  /** Duration in milliseconds (when provided by the API) */
  duration?: number;
  transaction?: string;
  "transaction.op"?: string;
  project_slug?: string;
  event_id?: string;
  /** Nested child spans */
  children?: TraceSpan[];
};

// Stack Frame & Exception Entry

/** A single frame in a stack trace */
export type StackFrame = {
  filename?: string | null;
  absPath?: string | null;
  module?: string | null;
  package?: string | null;
  platform?: string | null;
  function?: string | null;
  rawFunction?: string | null;
  symbol?: string | null;
  lineNo?: number | null;
  colNo?: number | null;
  /** Whether this frame is in the user's application code */
  inApp?: boolean | null;
  /** Surrounding code lines: [[lineNo, code], ...] */
  context?: [number, string][] | null;
  vars?: Record<string, unknown> | null;
  instructionAddr?: string | null;
  symbolAddr?: string | null;
  trust?: string | null;
  errors?: unknown[] | null;
  [key: string]: unknown;
};

/** Stack trace containing frames */
export type Stacktrace = {
  frames?: StackFrame[];
  framesOmitted?: number[] | null;
  registers?: Record<string, string> | null;
  hasSystemFrames?: boolean;
  [key: string]: unknown;
};

/** Exception mechanism (how the error was captured) */
export type Mechanism = {
  type?: string;
  handled?: boolean;
  synthetic?: boolean;
  description?: string | null;
  data?: Record<string, unknown>;
  [key: string]: unknown;
};

/** A single exception value in the exception entry */
export type ExceptionValue = {
  type?: string | null;
  value?: string | null;
  module?: string | null;
  threadId?: string | number | null;
  mechanism?: Mechanism | null;
  stacktrace?: Stacktrace | null;
  rawStacktrace?: Stacktrace | null;
  [key: string]: unknown;
};

/** Exception entry in event.entries */
export type ExceptionEntry = {
  type: "exception";
  data: {
    values?: ExceptionValue[];
    excOmitted?: number[] | null;
    hasSystemFrames?: boolean;
    [key: string]: unknown;
  };
};

// Breadcrumbs Entry

/** A single breadcrumb */
export type Breadcrumb = {
  type?: string;
  category?: string | null;
  level?: string;
  message?: string | null;
  timestamp?: string;
  event_id?: string | null;
  data?: Record<string, unknown> | null;
  [key: string]: unknown;
};

/** Breadcrumbs entry in event.entries */
export type BreadcrumbsEntry = {
  type: "breadcrumbs";
  data: {
    values?: Breadcrumb[];
    [key: string]: unknown;
  };
};

// Request Entry

/** HTTP request entry in event.entries */
export type RequestEntry = {
  type: "request";
  data: {
    url?: string | null;
    method?: string | null;
    fragment?: string | null;
    query?: [string, string][] | string | Record<string, string> | null;
    data?: unknown;
    headers?: [string, string][] | null;
    cookies?: [string, string][] | Record<string, string> | null;
    env?: Record<string, string> | null;
    inferredContentType?: string | null;
    apiTarget?: string | null;
    [key: string]: unknown;
  };
};

// Log types (runtime-validated, internal explore API)

/**
 * Individual log entry from the logs dataset.
 * Fields match the Sentry Explore/Events API response for dataset=logs.
 */
export const SentryLogSchema = z
  .object({
    /** Unique identifier for deduplication */
    "sentry.item_id": z.string(),
    /** ISO timestamp of the log entry */
    timestamp: z.string(),
    /** Nanosecond-precision timestamp for accurate ordering and filtering */
    timestamp_precise: z.number(),
    /** Log message content */
    message: z.string().nullable().optional(),
    /** Log severity level (error, warning, info, debug, etc.) */
    severity: z.string().nullable().optional(),
    /** Trace ID for correlation with traces */
    trace: z.string().nullable().optional(),
  })
  .passthrough();

export type SentryLog = z.infer<typeof SentryLogSchema>;

/** Response from the logs events endpoint */
export const LogsResponseSchema = z.object({
  data: z.array(SentryLogSchema),
  meta: z
    .object({
      fields: z.record(z.string()).optional(),
    })
    .passthrough()
    .optional(),
});

export type LogsResponse = z.infer<typeof LogsResponseSchema>;

/**
 * Detailed log entry with all available fields from the logs dataset.
 * Used by the `log view` command for comprehensive log display.
 */
export const DetailedSentryLogSchema = z
  .object({
    /** Unique identifier for deduplication */
    "sentry.item_id": z.string(),
    /** ISO timestamp of the log entry */
    timestamp: z.string(),
    /** Nanosecond-precision timestamp for accurate ordering */
    timestamp_precise: z.number(),
    /** Log message content */
    message: z.string().nullable().optional(),
    /** Log severity level (error, warning, info, debug, etc.) */
    severity: z.string().nullable().optional(),
    /** Trace ID for correlation with traces */
    trace: z.string().nullable().optional(),
    /** Project slug */
    project: z.string().nullable().optional(),
    /** Environment name */
    environment: z.string().nullable().optional(),
    /** Release version */
    release: z.string().nullable().optional(),
    /** SDK name */
    "sdk.name": z.string().nullable().optional(),
    /** SDK version */
    "sdk.version": z.string().nullable().optional(),
    /** Span ID for correlation with spans */
    span_id: z.string().nullable().optional(),
    /** Function name where log was emitted */
    "code.function": z.string().nullable().optional(),
    /** File path where log was emitted */
    "code.file.path": z.string().nullable().optional(),
    /** Line number where log was emitted */
    "code.line.number": z.string().nullable().optional(),
    /** OpenTelemetry span kind */
    "sentry.otel.kind": z.string().nullable().optional(),
    /** OpenTelemetry status code */
    "sentry.otel.status_code": z.string().nullable().optional(),
    /** OpenTelemetry instrumentation scope name */
    "sentry.otel.instrumentation_scope.name": z.string().nullable().optional(),
  })
  .passthrough();

export type DetailedSentryLog = z.infer<typeof DetailedSentryLogSchema>;

/** Response from the detailed log query endpoint */
export const DetailedLogsResponseSchema = z.object({
  data: z.array(DetailedSentryLogSchema),
  meta: z
    .object({
      fields: z.record(z.string()).optional(),
    })
    .passthrough()
    .optional(),
});

export type DetailedLogsResponse = z.infer<typeof DetailedLogsResponseSchema>;

// Transaction (for trace listing)

/**
 * Transaction list item from the Explore/Events API (dataset=transactions).
 * Fields match the response when querying trace, id, transaction, timestamp, etc.
 */
export const TransactionListItemSchema = z
  .object({
    /** Trace ID this transaction belongs to */
    trace: z.string(),
    /** Event ID of the transaction */
    id: z.string(),
    /** Transaction name (e.g., "GET /api/users") */
    transaction: z.string(),
    /** ISO timestamp of the transaction */
    timestamp: z.string(),
    /** Transaction duration in milliseconds */
    "transaction.duration": z.number(),
    /** Project slug */
    project: z.string(),
  })
  .passthrough();

export type TransactionListItem = z.infer<typeof TransactionListItemSchema>;

/** Response from the transactions events endpoint */
export const TransactionsResponseSchema = z.object({
  data: z.array(TransactionListItemSchema),
  meta: z
    .object({
      fields: z.record(z.string()).optional(),
    })
    .passthrough()
    .optional(),
});

export type TransactionsResponse = z.infer<typeof TransactionsResponseSchema>;

// Repository

/** Repository provider (e.g., GitHub, GitLab) */
export const RepositoryProviderSchema = z.object({
  id: z.string(),
  name: z.string(),
});

export type RepositoryProvider = z.infer<typeof RepositoryProviderSchema>;

/** A repository connected to a Sentry organization */
export const SentryRepositorySchema = z
  .object({
    // Core identifiers (required)
    id: z.string(),
    name: z.string(),
    url: z.string().nullable(),
    provider: RepositoryProviderSchema,
    status: z.string(),
    // Optional metadata
    dateCreated: z.string().optional(),
    integrationId: z.string().optional(),
    externalSlug: z.string().nullable().optional(),
    externalId: z.string().nullable().optional(),
  })
  .passthrough();

export type SentryRepository = z.infer<typeof SentryRepositorySchema>;
