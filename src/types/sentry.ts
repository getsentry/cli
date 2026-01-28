/**
 * Sentry API Types
 *
 * Types representing Sentry API resources.
 * Zod schemas provide runtime validation, types are inferred from schemas.
 * Schemas are lenient to handle API variations - only core identifiers are required.
 */

import { z } from "zod";

// ─────────────────────────────────────────────────────────────────────────────
// Organization
// ─────────────────────────────────────────────────────────────────────────────

export const SentryOrganizationSchema = z
  .object({
    // Core identifiers (required)
    id: z.string(),
    slug: z.string(),
    name: z.string(),
    // Optional metadata
    dateCreated: z.string().optional(),
    isEarlyAdopter: z.boolean().optional(),
    require2FA: z.boolean().optional(),
    avatar: z
      .object({
        avatarType: z.string(),
        avatarUuid: z.string().nullable(),
      })
      .passthrough()
      .optional(),
    features: z.array(z.string()).optional(),
  })
  .passthrough();

export type SentryOrganization = z.infer<typeof SentryOrganizationSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Project
// ─────────────────────────────────────────────────────────────────────────────

export const SentryProjectSchema = z
  .object({
    // Core identifiers (required)
    id: z.string(),
    slug: z.string(),
    name: z.string(),
    // Optional metadata
    platform: z.string().nullable().optional(),
    dateCreated: z.string().optional(),
    isBookmarked: z.boolean().optional(),
    isMember: z.boolean().optional(),
    features: z.array(z.string()).optional(),
    firstEvent: z.string().nullable().optional(),
    firstTransactionEvent: z.boolean().optional(),
    access: z.array(z.string()).optional(),
    hasAccess: z.boolean().optional(),
    hasMinifiedStackTrace: z.boolean().optional(),
    hasMonitors: z.boolean().optional(),
    hasProfiles: z.boolean().optional(),
    hasReplays: z.boolean().optional(),
    hasSessions: z.boolean().optional(),
    isInternal: z.boolean().optional(),
    isPublic: z.boolean().optional(),
    avatar: z
      .object({
        avatarType: z.string(),
        avatarUuid: z.string().nullable(),
      })
      .passthrough()
      .optional(),
    color: z.string().optional(),
    status: z.string().optional(),
    organization: z
      .object({
        id: z.string(),
        slug: z.string(),
        name: z.string(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export type SentryProject = z.infer<typeof SentryProjectSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Issue Status & Level Constants
// ─────────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
// Release (embedded in Issue)
// ─────────────────────────────────────────────────────────────────────────────

export const ReleaseSchema = z
  .object({
    id: z.number().optional(),
    version: z.string(),
    shortVersion: z.string().optional(),
    status: z.string().optional(),
    dateCreated: z.string().optional(),
    dateReleased: z.string().nullable().optional(),
    ref: z.string().nullable().optional(),
    url: z.string().nullable().optional(),
    commitCount: z.number().optional(),
    deployCount: z.number().optional(),
    authors: z.array(z.unknown()).optional(),
    projects: z
      .array(
        z
          .object({
            id: z.union([z.string(), z.number()]),
            slug: z.string(),
            name: z.string(),
          })
          .passthrough()
      )
      .optional(),
  })
  .passthrough();

export type Release = z.infer<typeof ReleaseSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Issue
// ─────────────────────────────────────────────────────────────────────────────

export const SentryIssueSchema = z
  .object({
    // Core identifiers (required)
    id: z.string(),
    shortId: z.string(),
    title: z.string(),
    // Optional metadata
    culprit: z.string().optional(),
    permalink: z.string().optional(),
    logger: z.string().nullable().optional(),
    level: z.string().optional(),
    status: z.enum(ISSUE_STATUSES).optional(),
    statusDetails: z.record(z.unknown()).optional(),
    substatus: z.string().optional(),
    priority: z.string().optional(),
    isPublic: z.boolean().optional(),
    platform: z.string().optional(),
    project: z
      .object({
        id: z.string(),
        name: z.string(),
        slug: z.string(),
        platform: z.string().nullable().optional(),
      })
      .passthrough()
      .optional(),
    type: z.string().optional(),
    metadata: z
      .object({
        value: z.string().optional(),
        type: z.string().optional(),
        filename: z.string().optional(),
        function: z.string().optional(),
        display_title_with_tree_label: z.boolean().optional(),
      })
      .passthrough()
      .optional(),
    numComments: z.number().optional(),
    assignedTo: z
      .object({
        id: z.string(),
        name: z.string(),
        type: z.string(),
      })
      .passthrough()
      .nullable()
      .optional(),
    isBookmarked: z.boolean().optional(),
    isSubscribed: z.boolean().optional(),
    subscriptionDetails: z
      .object({
        reason: z.string().optional(),
      })
      .passthrough()
      .nullable()
      .optional(),
    hasSeen: z.boolean().optional(),
    annotations: z.array(z.string()).optional(),
    isUnhandled: z.boolean().optional(),
    count: z.string().optional(),
    userCount: z.number().optional(),
    firstSeen: z.string().datetime({ offset: true }).optional(),
    lastSeen: z.string().datetime({ offset: true }).optional(),
    // Release information
    firstRelease: ReleaseSchema.nullable().optional(),
    lastRelease: ReleaseSchema.nullable().optional(),
  })
  .passthrough();

export type SentryIssue = z.infer<typeof SentryIssueSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Trace Context
// ─────────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
// Span (for trace tree display)
// ─────────────────────────────────────────────────────────────────────────────

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

/** A transaction/event in a trace (from events-trace endpoint) */
export const TraceEventSchema = z
  .object({
    event_id: z.string(),
    span_id: z.string().optional(),
    transaction: z.string().optional(),
    "transaction.duration": z.number().optional(),
    "transaction.op": z.string().optional(),
    project_slug: z.string().optional(),
    project_id: z.union([z.string(), z.number()]).optional(),
    /** Child spans within this transaction */
    spans: z.array(SpanSchema).optional(),
    /** Start time */
    start_timestamp: z.number().optional(),
    /** End time */
    timestamp: z.number().optional(),
    /** Errors associated with this transaction */
    errors: z.array(z.unknown()).optional(),
    /** Performance issues */
    performance_issues: z.array(z.unknown()).optional(),
  })
  .passthrough();

export type TraceEvent = z.infer<typeof TraceEventSchema>;

/** Response from /events-trace/{traceId}/ endpoint */
export const TraceResponseSchema = z.object({
  /** Transactions with their nested children (span trees) */
  transactions: z.array(TraceEventSchema),
  /** Errors not associated with any transaction */
  orphan_errors: z.array(z.unknown()).optional(),
});

export type TraceResponse = z.infer<typeof TraceResponseSchema>;

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
  timestamp: number;
  transaction?: string;
  "transaction.op"?: string;
  project_slug?: string;
  event_id?: string;
  /** Nested child spans */
  children?: TraceSpan[];
};

// ─────────────────────────────────────────────────────────────────────────────
// Stack Frame & Exception Entry
// ─────────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
// Breadcrumbs Entry
// ─────────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
// Request Entry
// ─────────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
// Event Contexts
// ─────────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
// Event
// ─────────────────────────────────────────────────────────────────────────────

export const SentryEventSchema = z
  .object({
    // Core identifier (required)
    eventID: z.string(),
    // Optional metadata
    id: z.string().optional(),
    projectID: z.string().optional(),
    context: z.record(z.unknown()).optional(),
    contexts: z
      .object({
        trace: TraceContextSchema.optional(),
        browser: BrowserContextSchema.optional(),
        os: OsContextSchema.optional(),
        device: DeviceContextSchema.optional(),
      })
      .passthrough()
      .optional(),
    dateCreated: z.string().optional(),
    dateReceived: z.string().optional(),
    /** Event entries: exception, breadcrumbs, request, spans, etc. */
    entries: z.array(z.unknown()).optional(),
    errors: z.array(z.unknown()).optional(),
    fingerprints: z.array(z.string()).optional(),
    groupID: z.string().optional(),
    message: z.string().optional(),
    metadata: z.record(z.unknown()).optional(),
    platform: z.string().optional(),
    /** File location where the error occurred */
    location: z.string().nullable().optional(),
    /** URL where the event occurred */
    culprit: z.string().nullable().optional(),
    sdk: z
      .object({
        name: z.string(),
        version: z.string(),
      })
      .passthrough()
      .nullable()
      .optional(),
    tags: z
      .array(
        z.object({
          key: z.string(),
          value: z.string(),
        })
      )
      .optional(),
    title: z.string().optional(),
    type: z.string().optional(),
    user: z
      .object({
        id: z.string().nullable().optional(),
        email: z.string().nullable().optional(),
        username: z.string().nullable().optional(),
        ip_address: z.string().nullable().optional(),
        name: z.string().nullable().optional(),
        geo: UserGeoSchema.nullable().optional(),
        data: z.record(z.unknown()).nullable().optional(),
      })
      .passthrough()
      .nullable()
      .optional(),
    /** Release information for this event */
    release: ReleaseSchema.nullable().optional(),
    /** SDK update suggestions */
    sdkUpdates: z
      .array(
        z
          .object({
            type: z.string().optional(),
            sdkName: z.string().optional(),
            newSdkVersion: z.string().optional(),
            sdkUrl: z.string().optional(),
          })
          .passthrough()
      )
      .optional(),
  })
  .passthrough();

export type SentryEvent = z.infer<typeof SentryEventSchema>;
