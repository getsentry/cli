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
 * Internal types (Region, User, logs, event entries, traces) that are not covered
 * by the SDK use Zod schemas for runtime validation.
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
 * Organization links with region URL for multi-region support.
 * Derived from the SDK's organization `links` field.
 */
export type OrganizationLinks = {
  organizationUrl: string;
  regionUrl: string;
};

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

// Issue Status & Level Constants

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

export const ISSUE_PRIORITIES = ["high", "medium", "low"] as const;
export type IssuePriority = (typeof ISSUE_PRIORITIES)[number];

export const ISSUE_SUBSTATUSES = [
  "ongoing",
  "escalating",
  "regressed",
  "new",
  "archived_until_escalating",
  "archived_until_condition_met",
  "archived_forever",
] as const;
export type IssueSubstatus = (typeof ISSUE_SUBSTATUSES)[number];

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

// Internal types (not in @sentry/api SDK)

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
    // Core identifiers (required)
    id: z.string(),
    // Optional user info
    email: z.string().optional(),
    username: z.string().optional(),
    name: z.string().optional(),
  })
  .passthrough();

export type SentryUser = z.infer<typeof SentryUserSchema>;

// Trace Context

export const TraceContextSchema = z
  .object({
    trace_id: z.string().optional(),
    span_id: z.string().optional(),
    parent_span_id: z.string().nullable().optional(),
    op: z.string().optional(),
    status: z.string().optional(),
    description: z.string().nullable().optional(),
  })
  .passthrough();

export type TraceContext = z.infer<typeof TraceContextSchema>;

// Span (for trace tree display)

/** A single span in a trace */
export const SpanSchema = z
  .object({
    span_id: z.string(),
    parent_span_id: z.string().nullable().optional(),
    trace_id: z.string().optional(),
    op: z.string().optional(),
    description: z.string().nullable().optional(),
    /** Start time as Unix timestamp (seconds with fractional ms) */
    start_timestamp: z.number(),
    /** End time as Unix timestamp (seconds with fractional ms) */
    timestamp: z.number(),
    status: z.string().optional(),
    data: z.record(z.unknown()).optional(),
    tags: z.record(z.string()).optional(),
  })
  .passthrough();

export type Span = z.infer<typeof SpanSchema>;

/**
 * Span from /trace/{traceId}/ endpoint with nested children.
 * This endpoint returns a hierarchical structure unlike /events-trace/.
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
export const StackFrameSchema = z
  .object({
    filename: z.string().nullable().optional(),
    absPath: z.string().nullable().optional(),
    module: z.string().nullable().optional(),
    package: z.string().nullable().optional(),
    platform: z.string().nullable().optional(),
    function: z.string().nullable().optional(),
    rawFunction: z.string().nullable().optional(),
    symbol: z.string().nullable().optional(),
    lineNo: z.number().nullable().optional(),
    colNo: z.number().nullable().optional(),
    /** Whether this frame is in the user's application code */
    inApp: z.boolean().nullable().optional(),
    /** Surrounding code lines: [[lineNo, code], ...] */
    context: z
      .array(z.tuple([z.number(), z.string()]))
      .nullable()
      .optional(),
    vars: z.record(z.unknown()).nullable().optional(),
    instructionAddr: z.string().nullable().optional(),
    symbolAddr: z.string().nullable().optional(),
    trust: z.string().nullable().optional(),
    errors: z.array(z.unknown()).nullable().optional(),
  })
  .passthrough();

export type StackFrame = z.infer<typeof StackFrameSchema>;

/** Stack trace containing frames */
export const StacktraceSchema = z
  .object({
    frames: z.array(StackFrameSchema).optional(),
    framesOmitted: z.array(z.number()).nullable().optional(),
    registers: z.record(z.string()).nullable().optional(),
    hasSystemFrames: z.boolean().optional(),
  })
  .passthrough();

export type Stacktrace = z.infer<typeof StacktraceSchema>;

/** Exception mechanism (how the error was captured) */
export const MechanismSchema = z
  .object({
    type: z.string().optional(),
    handled: z.boolean().optional(),
    synthetic: z.boolean().optional(),
    description: z.string().nullable().optional(),
    data: z.record(z.unknown()).optional(),
  })
  .passthrough();

export type Mechanism = z.infer<typeof MechanismSchema>;

/** A single exception value in the exception entry */
export const ExceptionValueSchema = z
  .object({
    type: z.string().nullable().optional(),
    value: z.string().nullable().optional(),
    module: z.string().nullable().optional(),
    threadId: z.union([z.string(), z.number()]).nullable().optional(),
    mechanism: MechanismSchema.nullable().optional(),
    stacktrace: StacktraceSchema.nullable().optional(),
    rawStacktrace: StacktraceSchema.nullable().optional(),
  })
  .passthrough();

export type ExceptionValue = z.infer<typeof ExceptionValueSchema>;

/** Exception entry in event.entries */
export const ExceptionEntrySchema = z.object({
  type: z.literal("exception"),
  data: z
    .object({
      values: z.array(ExceptionValueSchema).optional(),
      excOmitted: z.array(z.number()).nullable().optional(),
      hasSystemFrames: z.boolean().optional(),
    })
    .passthrough(),
});

export type ExceptionEntry = z.infer<typeof ExceptionEntrySchema>;

// Breadcrumbs Entry

/** A single breadcrumb */
export const BreadcrumbSchema = z
  .object({
    type: z.string().optional(),
    category: z.string().nullable().optional(),
    level: z.string().optional(),
    message: z.string().nullable().optional(),
    timestamp: z.string().optional(),
    event_id: z.string().nullable().optional(),
    data: z.record(z.unknown()).nullable().optional(),
  })
  .passthrough();

export type Breadcrumb = z.infer<typeof BreadcrumbSchema>;

/** Breadcrumbs entry in event.entries */
export const BreadcrumbsEntrySchema = z.object({
  type: z.literal("breadcrumbs"),
  data: z
    .object({
      values: z.array(BreadcrumbSchema).optional(),
    })
    .passthrough(),
});

export type BreadcrumbsEntry = z.infer<typeof BreadcrumbsEntrySchema>;

// Request Entry

/** HTTP request entry in event.entries */
export const RequestEntrySchema = z.object({
  type: z.literal("request"),
  data: z
    .object({
      url: z.string().nullable().optional(),
      method: z.string().nullable().optional(),
      fragment: z.string().nullable().optional(),
      query: z
        .union([
          z.array(z.tuple([z.string(), z.string()])),
          z.string(),
          z.record(z.string()),
        ])
        .nullable()
        .optional(),
      data: z.unknown().nullable().optional(),
      headers: z
        .array(z.tuple([z.string(), z.string()]))
        .nullable()
        .optional(),
      cookies: z
        .union([
          z.array(z.tuple([z.string(), z.string()])),
          z.record(z.string()),
        ])
        .nullable()
        .optional(),
      env: z.record(z.string()).nullable().optional(),
      inferredContentType: z.string().nullable().optional(),
      apiTarget: z.string().nullable().optional(),
    })
    .passthrough(),
});

export type RequestEntry = z.infer<typeof RequestEntrySchema>;

// Event Contexts

/** Browser context */
export const BrowserContextSchema = z
  .object({
    name: z.string().optional(),
    version: z.string().optional(),
    type: z.literal("browser").optional(),
  })
  .passthrough();

export type BrowserContext = z.infer<typeof BrowserContextSchema>;

/** Operating system context */
export const OsContextSchema = z
  .object({
    name: z.string().optional(),
    version: z.string().optional(),
    type: z.literal("os").optional(),
  })
  .passthrough();

export type OsContext = z.infer<typeof OsContextSchema>;

/** Device context */
export const DeviceContextSchema = z
  .object({
    family: z.string().optional(),
    model: z.string().optional(),
    brand: z.string().optional(),
    type: z.literal("device").optional(),
  })
  .passthrough();

export type DeviceContext = z.infer<typeof DeviceContextSchema>;

/** User geo information */
export const UserGeoSchema = z
  .object({
    country_code: z.string().optional(),
    city: z.string().optional(),
    region: z.string().optional(),
  })
  .passthrough();

export type UserGeo = z.infer<typeof UserGeoSchema>;

/** Log severity levels (similar to issue levels but includes trace) */
export const LOG_SEVERITIES = [
  "fatal",
  "error",
  "warning",
  "warn",
  "info",
  "debug",
  "trace",
] as const;
export type LogSeverity = (typeof LOG_SEVERITIES)[number];

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
