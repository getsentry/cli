/**
 * Sentry API Types
 *
 * Types representing Sentry API resources.
 * Most types are plain TypeScript interfaces; Zod schemas are only used
 * where runtime validation is actually needed.
 */

import { z } from "zod";

// ─────────────────────────────────────────────────────────────────────────────
// Region (undocumented API: /users/me/regions/)
// ─────────────────────────────────────────────────────────────────────────────

/** A Sentry region (e.g., US, EU) */
export type Region = {
  name: string;
  url: string;
};

/** Response from /api/0/users/me/regions/ endpoint */
export type UserRegionsResponse = {
  regions: Region[];
};

// ─────────────────────────────────────────────────────────────────────────────
// Organization
// ─────────────────────────────────────────────────────────────────────────────

/** Organization links with region URL for multi-region support */
export type OrganizationLinks = {
  organizationUrl: string;
  regionUrl: string;
};

/**
 * Zod schema for SentryOrganization.
 * Used for runtime validation in region.ts via apiRequestToRegion({ schema }).
 */
export const SentryOrganizationSchema = z
  .object({
    id: z.string(),
    slug: z.string(),
    name: z.string(),
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
    links: z
      .object({
        organizationUrl: z.string(),
        regionUrl: z.string(),
      })
      .optional(),
  })
  .passthrough();

export type SentryOrganization = z.infer<typeof SentryOrganizationSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// User (undocumented API: /users/me/)
// ─────────────────────────────────────────────────────────────────────────────

export type SentryUser = {
  id: string;
  email?: string;
  username?: string;
  name?: string;
  [key: string]: unknown;
};

// ─────────────────────────────────────────────────────────────────────────────
// Project
// ─────────────────────────────────────────────────────────────────────────────

export type SentryProject = {
  id: string;
  slug: string;
  name: string;
  platform?: string | null;
  dateCreated?: string;
  isBookmarked?: boolean;
  isMember?: boolean;
  features?: string[];
  firstEvent?: string | null;
  firstTransactionEvent?: boolean;
  access?: string[];
  hasAccess?: boolean;
  hasMinifiedStackTrace?: boolean;
  hasMonitors?: boolean;
  hasProfiles?: boolean;
  hasReplays?: boolean;
  hasSessions?: boolean;
  isInternal?: boolean;
  isPublic?: boolean;
  avatar?: {
    avatarType: string;
    avatarUuid: string | null;
  };
  color?: string;
  status?: string;
  organization?: {
    id: string;
    slug: string;
    name: string;
  };
  [key: string]: unknown;
};

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

export type Release = {
  id?: number;
  version: string;
  shortVersion?: string;
  status?: string;
  dateCreated?: string;
  dateReleased?: string | null;
  ref?: string | null;
  url?: string | null;
  commitCount?: number;
  deployCount?: number;
  authors?: unknown[];
  projects?: Array<{
    id: string | number;
    slug: string;
    name: string;
  }>;
  [key: string]: unknown;
};

// ─────────────────────────────────────────────────────────────────────────────
// Issue
// ─────────────────────────────────────────────────────────────────────────────

export type SentryIssue = {
  id: string;
  shortId: string;
  title: string;
  culprit?: string;
  permalink?: string;
  logger?: string | null;
  level?: string;
  status?: IssueStatus;
  statusDetails?: Record<string, unknown>;
  substatus?: string | null;
  priority?: string;
  isPublic?: boolean;
  platform?: string;
  project?: {
    id: string;
    name: string;
    slug: string;
    platform?: string | null;
  };
  type?: string;
  metadata?: {
    value?: string;
    type?: string;
    filename?: string;
    function?: string;
    display_title_with_tree_label?: boolean;
  };
  numComments?: number;
  assignedTo?: {
    id: string;
    name: string;
    type: string;
  } | null;
  isBookmarked?: boolean;
  isSubscribed?: boolean;
  subscriptionDetails?: {
    reason?: string;
  } | null;
  hasSeen?: boolean;
  annotations?: string[];
  isUnhandled?: boolean;
  count?: string;
  userCount?: number;
  firstSeen?: string;
  lastSeen?: string;
  firstRelease?: Release | null;
  lastRelease?: Release | null;
  [key: string]: unknown;
};

// ─────────────────────────────────────────────────────────────────────────────
// Trace Context
// ─────────────────────────────────────────────────────────────────────────────

export type TraceContext = {
  trace_id?: string;
  span_id?: string;
  parent_span_id?: string | null;
  op?: string;
  status?: string;
  description?: string | null;
  [key: string]: unknown;
};

// ─────────────────────────────────────────────────────────────────────────────
// Span (for trace tree display)
// ─────────────────────────────────────────────────────────────────────────────

/** A single span in a trace */
export type Span = {
  span_id: string;
  parent_span_id?: string | null;
  trace_id?: string;
  op?: string;
  description?: string | null;
  /** Start time as Unix timestamp (seconds with fractional ms) */
  start_timestamp: number;
  /** End time as Unix timestamp (seconds with fractional ms) */
  timestamp: number;
  status?: string;
  data?: Record<string, unknown>;
  tags?: Record<string, string>;
  [key: string]: unknown;
};

/** A transaction/event in a trace (from events-trace endpoint) */
export type TraceEvent = {
  event_id: string;
  span_id?: string;
  transaction?: string;
  "transaction.duration"?: number;
  "transaction.op"?: string;
  project_slug?: string;
  project_id?: string | number;
  /** Child spans within this transaction */
  spans?: Span[];
  /** Start time */
  start_timestamp?: number;
  /** End time */
  timestamp?: number;
  /** Errors associated with this transaction */
  errors?: unknown[];
  /** Performance issues */
  performance_issues?: unknown[];
  [key: string]: unknown;
};

/** Response from /events-trace/{traceId}/ endpoint */
export type TraceResponse = {
  /** Transactions with their nested children (span trees) */
  transactions: TraceEvent[];
  /** Errors not associated with any transaction */
  orphan_errors?: unknown[];
};

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
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// Breadcrumbs Entry
// ─────────────────────────────────────────────────────────────────────────────

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
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// Request Entry
// ─────────────────────────────────────────────────────────────────────────────

/** HTTP request entry in event.entries */
export type RequestEntry = {
  type: "request";
  data: {
    url?: string | null;
    method?: string | null;
    fragment?: string | null;
    query?: [string, string][] | string | Record<string, string> | null;
    data?: unknown | null;
    headers?: [string, string][] | null;
    cookies?: [string, string][] | Record<string, string> | null;
    env?: Record<string, string> | null;
    inferredContentType?: string | null;
    apiTarget?: string | null;
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// Event Contexts
// ─────────────────────────────────────────────────────────────────────────────

/** Browser context */
export type BrowserContext = {
  name?: string;
  version?: string;
  type?: "browser";
  [key: string]: unknown;
};

/** Operating system context */
export type OsContext = {
  name?: string;
  version?: string;
  type?: "os";
  [key: string]: unknown;
};

/** Device context */
export type DeviceContext = {
  family?: string;
  model?: string;
  brand?: string;
  type?: "device";
  [key: string]: unknown;
};

/** User geo information */
export type UserGeo = {
  country_code?: string;
  city?: string;
  region?: string;
  [key: string]: unknown;
};

// ─────────────────────────────────────────────────────────────────────────────
// Event
// ─────────────────────────────────────────────────────────────────────────────

export type SentryEvent = {
  eventID: string;
  id?: string;
  projectID?: string;
  context?: Record<string, unknown>;
  contexts?: {
    trace?: TraceContext;
    browser?: BrowserContext;
    os?: OsContext;
    device?: DeviceContext;
    [key: string]: unknown;
  };
  dateCreated?: string;
  dateReceived?: string;
  /** Event entries: exception, breadcrumbs, request, spans, etc. */
  entries?: unknown[];
  errors?: unknown[];
  fingerprints?: string[];
  groupID?: string;
  message?: string;
  metadata?: Record<string, unknown>;
  platform?: string;
  /** File location where the error occurred */
  location?: string | null;
  /** URL where the event occurred */
  culprit?: string | null;
  sdk?: {
    name: string;
    version: string;
  } | null;
  tags?: Array<{
    key: string;
    value: string;
  }>;
  title?: string;
  type?: string;
  user?: {
    id?: string | null;
    email?: string | null;
    username?: string | null;
    ip_address?: string | null;
    name?: string | null;
    geo?: UserGeo | null;
    data?: Record<string, unknown> | null;
  } | null;
  /** Release information for this event */
  release?: Release | null;
  /** SDK update suggestions */
  sdkUpdates?: Array<{
    type?: string;
    sdkName?: string;
    newSdkVersion?: string;
    sdkUrl?: string;
  }>;
  [key: string]: unknown;
};

// ─────────────────────────────────────────────────────────────────────────────
// Project Keys (DSN)
// ─────────────────────────────────────────────────────────────────────────────

export type ProjectKey = {
  id: string;
  name: string;
  dsn: {
    public: string;
    secret?: string;
  };
  isActive: boolean;
  dateCreated?: string;
  [key: string]: unknown;
};
