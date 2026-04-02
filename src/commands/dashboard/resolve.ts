/**
 * Shared dashboard resolution utilities
 *
 * Provides org resolution from parsed target arguments and dashboard
 * ID resolution from numeric IDs or title strings.
 */

import { MAX_PAGINATION_PAGES } from "../../lib/api/infrastructure.js";
import {
  API_MAX_PER_PAGE,
  listDashboardsPaginated,
} from "../../lib/api-client.js";
import type { parseOrgProjectArg } from "../../lib/arg-parsing.js";
import {
  ApiError,
  ContextError,
  ResolutionError,
  ValidationError,
} from "../../lib/errors.js";
import { fuzzyMatch } from "../../lib/fuzzy.js";
import { logger } from "../../lib/logger.js";
import { resolveEffectiveOrg } from "../../lib/region.js";
import { resolveOrg } from "../../lib/resolve-target.js";
import { setOrgProjectContext } from "../../lib/telemetry.js";
import { isAllDigits } from "../../lib/utils.js";
import {
  DATASET_SUPPORTED_DISPLAY_TYPES,
  type DashboardWidget,
  DISPLAY_TYPES,
  parseAggregate,
  parseSortExpression,
  parseWidgetInput,
  prepareWidgetQueries,
  validateAggregateNames,
  WIDGET_TYPES,
  type WidgetType,
} from "../../types/dashboard.js";

/** Shared widget query flags used by `add` and `edit` commands */
export type WidgetQueryFlags = {
  readonly display?: string;
  readonly dataset?: string;
  readonly query?: string[];
  readonly where?: string;
  readonly "group-by"?: string[];
  readonly sort?: string;
  readonly limit?: number;
};

/**
 * Resolve org slug from a parsed org/project target argument.
 *
 * Dashboard commands only need the org (dashboards are org-scoped), so
 * explicit, org-all, project-search, and auto-detect all resolve to just
 * the org slug.
 *
 * @param parsed - Parsed org/project argument
 * @param cwd - Current working directory for auto-detection
 * @param usageHint - Usage example for error messages
 * @returns Organization slug
 */
export async function resolveOrgFromTarget(
  parsed: ReturnType<typeof parseOrgProjectArg>,
  cwd: string,
  usageHint: string
): Promise<string> {
  switch (parsed.type) {
    case "explicit":
    case "org-all": {
      const org = await resolveEffectiveOrg(parsed.org);
      setOrgProjectContext([org], []);
      return org;
    }
    case "project-search":
    case "auto-detect": {
      // resolveOrg already sets telemetry context
      const resolved = await resolveOrg({ cwd });
      if (!resolved) {
        throw new ContextError("Organization", usageHint);
      }
      return resolved.org;
    }
    default: {
      const _exhaustive: never = parsed;
      throw new Error(
        `Unexpected parsed type: ${(_exhaustive as { type: string }).type}`
      );
    }
  }
}

/**
 * Parse a dashboard reference and optional target from array positional args.
 *
 * Handles:
 * - `<id-or-title>` — single arg (auto-detect org)
 * - `<target> <id-or-title>` — explicit target + dashboard ref
 *
 * When two args are provided and the first is a bare slug (no `/`), it is
 * normalized to `slug/` so `parseOrgProjectArg` treats it as an org-all
 * target. Dashboards are org-scoped so the project component is irrelevant.
 *
 * @param args - Raw positional arguments
 * @returns Dashboard reference string and optional target arg
 */
export function parseDashboardPositionalArgs(args: string[]): {
  dashboardRef: string;
  targetArg: string | undefined;
} {
  if (args.length === 0) {
    throw new ValidationError(
      "Dashboard ID or title is required.",
      "dashboard"
    );
  }
  if (args.length === 1) {
    return {
      dashboardRef: args[0] as string,
      targetArg: undefined,
    };
  }
  // Normalize bare org slug → org/ (dashboards are org-scoped)
  const raw = args[0] as string;
  const target = raw.includes("/") ? raw : `${raw}/`;
  return {
    dashboardRef: args[1] as string,
    targetArg: target,
  };
}

/**
 * Parse dashboard list positional args into a target and optional title filter.
 *
 * Handles:
 * - (empty) — auto-detect org, no filter
 * - `<org/>` or `<org/project>` — target, no filter
 * - `'CLI'` or `'Error*'` or `'*API*'` — auto-detect org, title filter
 * - `<org/> 'Error*'` or `<org> 'Error*'` — target + glob filter
 *
 * A single arg without `/` is always treated as a title filter, not a
 * project-search target. Dashboards are org-scoped so project-search
 * doesn't apply — `resolveOrgFromTarget` ignores the slug anyway.
 * To specify an org, use `org/` or pass two args: `org 'filter'`.
 *
 * When two args are provided and the first is a bare slug (no `/`), it is
 * normalized to `slug/` so `parseOrgProjectArg` treats it as an org-all target.
 *
 * @param args - Raw positional arguments
 * @returns Target arg for org resolution and optional title filter glob
 */
export function parseDashboardListArgs(args: string[]): {
  targetArg: string | undefined;
  titleFilter: string | undefined;
} {
  // buildListCommand's interceptSubcommand may replace args[0] with undefined
  // when the first positional matches a subcommand name (e.g. "view", "create").
  // Filter those out so we don't crash on .includes("/").
  const filtered = args.filter(
    (a): a is string => a !== null && a !== undefined && a !== ""
  );
  if (filtered.length === 0) {
    return { targetArg: undefined, titleFilter: undefined };
  }
  if (filtered.length >= 2) {
    // First arg is the target, remaining args are joined as the filter.
    // This handles unquoted multi-word titles: `my-org/ CLI Health` arrives
    // as ["my-org/", "CLI", "Health"] and becomes filter "CLI Health".
    // Normalize bare org slug to org/ format so parseOrgProjectArg treats
    // it as org-all (dashboards are org-scoped, project is irrelevant).
    const raw = filtered[0] as string;
    const target = raw.includes("/") ? raw : `${raw}/`;
    const titleFilter = filtered.slice(1).join(" ");
    return { targetArg: target, titleFilter };
  }
  // 1 arg: if it contains "/" it may be a target, or an org/project/name combo.
  // Without "/" it's always a title filter (dashboards are org-scoped).
  const arg = filtered[0] as string;
  if (arg.includes("/")) {
    return splitOrgProjectName(arg);
  }
  return { targetArg: undefined, titleFilter: arg };
}

/**
 * Split a slash-containing single arg into target and optional title filter.
 *
 * - `org/` or `org/project` (≤1 slash) → target only, no filter
 * - `org/project/name` (2+ slashes) → target is `org/project`, filter is the rest
 *
 * This lets users type `sentry dashboard list my-org/my-project/CLI` as a
 * single arg instead of requiring two separate args.
 */
function splitOrgProjectName(arg: string): {
  targetArg: string | undefined;
  titleFilter: string | undefined;
} {
  const firstSlash = arg.indexOf("/");
  const secondSlash = arg.indexOf("/", firstSlash + 1);

  if (secondSlash === -1) {
    // Only one slash: "org/" or "org/project" — target only
    return { targetArg: arg, titleFilter: undefined };
  }

  // Two+ slashes: split into target + name filter
  const target = arg.slice(0, secondSlash);
  const name = arg.slice(secondSlash + 1);
  if (!name) {
    // Trailing slash after project: "org/project/" → target only
    return { targetArg: arg, titleFilter: undefined };
  }
  return { targetArg: target, titleFilter: name };
}

/**
 * Resolve a dashboard reference (numeric ID or title) to a numeric ID string.
 *
 * If the reference is all digits, returns it directly. Otherwise, paginates
 * through all dashboards searching for a case-insensitive title match.
 * Stops early on first match. On failure, uses fuzzy matching to suggest
 * similar dashboard titles.
 *
 * @param orgSlug - Organization slug
 * @param ref - Dashboard reference (numeric ID or title)
 * @returns Numeric dashboard ID as a string
 */
export async function resolveDashboardId(
  orgSlug: string,
  ref: string
): Promise<string> {
  if (isAllDigits(ref)) {
    return ref;
  }

  const lowerRef = ref.toLowerCase();
  const allTitles: string[] = [];
  const titleToId = new Map<string, string>();
  let cursor: string | undefined;

  for (let page = 0; page < MAX_PAGINATION_PAGES; page++) {
    const { data, nextCursor } = await listDashboardsPaginated(orgSlug, {
      perPage: API_MAX_PER_PAGE,
      cursor,
    }).catch((error: unknown) =>
      enrichDashboardError(error, { orgSlug, operation: "list" })
    );
    // Match by ID/slug first (e.g. "default-overview"), then fall back to title
    const match =
      data.find((d) => d.id.toLowerCase() === lowerRef) ??
      data.find((d) => d.title.toLowerCase() === lowerRef);
    if (match) {
      return match.id;
    }

    for (const d of data) {
      allTitles.push(d.title);
      titleToId.set(d.title, d.id);
    }
    if (!nextCursor) {
      break;
    }
    cursor = nextCursor;
  }

  // No match — use fuzzy search for suggestions
  const similar = fuzzyMatch(ref, allTitles, { maxResults: 5 });
  const suggestions = similar
    .map((t) => `  ${titleToId.get(t)}  ${t}`)
    .join("\n");
  let hint: string;
  if (similar.length > 0) {
    hint = `\n\nDid you mean:\n${suggestions}`;
  } else if (allTitles.length > 0) {
    hint = `\n\nThe org has ${allTitles.length} dashboard(s) but none matched.`;
  } else {
    hint = "\n\nNo dashboards found in this organization.";
  }

  throw new ValidationError(
    `No dashboard with title '${ref}' found in '${orgSlug}'.${hint}`
  );
}

/**
 * Resolve widget index from --index or --title flags.
 *
 * @param widgets - Array of widgets in the dashboard
 * @param index - Explicit 0-based widget index
 * @param title - Widget title to match
 * @returns Resolved widget index
 */
export function resolveWidgetIndex(
  widgets: DashboardWidget[],
  index: number | undefined,
  title: string | undefined
): number {
  if (index !== undefined) {
    if (index < 0 || index >= widgets.length) {
      throw new ValidationError(
        `Widget index ${index} out of range (dashboard has ${widgets.length} widgets).`,
        "index"
      );
    }
    return index;
  }
  const lowerTitle = (title ?? "").toLowerCase();
  const matchIndex = widgets.findIndex(
    (w) => w.title.toLowerCase() === lowerTitle
  );
  if (matchIndex === -1) {
    throw new ValidationError(
      `No widget with title '${title}' found in dashboard.`,
      "title"
    );
  }
  return matchIndex;
}

/**
 * Build a widget from user-provided flag values.
 *
 * Shared between `dashboard widget add` and `dashboard widget edit`.
 * Parses aggregate shorthand, sort expressions, and validates via Zod schema.
 *
 * @param opts - Widget configuration from parsed flags
 * @returns Validated widget with computed query fields
 */
/**
 * Validate that a sort expression references an aggregate present in the query.
 * The Sentry API returns 400 when the sort field isn't in the widget's aggregates.
 *
 * @param orderby - Parsed sort expression (e.g., "-count()", "p90(span.duration)")
 * @param aggregates - Parsed aggregate expressions from the query
 */
export function validateSortReferencesAggregate(
  orderby: string,
  aggregates: string[]
): void {
  // Strip leading "-" for descending sorts
  const sortAgg = orderby.startsWith("-") ? orderby.slice(1) : orderby;
  if (!aggregates.includes(sortAgg)) {
    throw new ValidationError(
      `Sort expression "${orderby}" references "${sortAgg}" which is not in the query.\n\n` +
        "The --sort field must be one of the aggregate expressions in --query.\n" +
        `Current aggregates: ${aggregates.join(", ")}\n\n` +
        `Either add "${sortAgg}" to --query or sort by an existing aggregate.`,
      "sort"
    );
  }
}

/**
 * Validate that grouped widgets (those with columns/group-by) include a limit.
 * The Sentry API rejects grouped widgets without a limit.
 *
 * @param columns - Group-by columns
 * @param limit - Widget limit (undefined if not set)
 */
export function validateGroupByRequiresLimit(
  columns: string[],
  limit: number | undefined
): void {
  if (columns.length > 0 && limit === undefined) {
    throw new ValidationError(
      "Widgets with --group-by require --limit. " +
        "Add --limit <n> to specify the maximum number of groups to display.",
      "limit"
    );
  }
}

const log = logger.withTag("dashboard");

/**
 * Known aggregatable fields for the spans dataset.
 *
 * Span attributes (e.g., dsn.files_collected, resolve.method) are key-value
 * metadata and cannot be used as aggregate fields — only in --where or --group-by.
 * This set covers built-in numeric fields that support aggregation.
 * Measurements (http.*, cache.*, etc.) are project-specific and may not be
 * exhaustive — we warn instead of error for unknown fields.
 */
const KNOWN_SPAN_AGGREGATE_FIELDS = new Set([
  "span.duration",
  "span.self_time",
  "http.response_content_length",
  "http.decoded_response_content_length",
  "http.response_transfer_size",
  "cache.item_size",
]);

/**
 * Warn when an aggregate argument looks like a span attribute rather than
 * an aggregatable field. No-arg functions (count(), epm()) are fine.
 * Only checks for the spans dataset.
 */
function warnUnknownAggregateFields(
  aggregates: string[],
  dataset: string | undefined
): void {
  if (dataset && dataset !== "spans") {
    return;
  }
  for (const agg of aggregates) {
    const parenIdx = agg.indexOf("(");
    if (parenIdx < 0) {
      continue;
    }
    const inner = agg.slice(parenIdx + 1, -1);
    // No-arg functions like count(), epm() have empty inner — skip
    if (!inner) {
      continue;
    }
    if (!KNOWN_SPAN_AGGREGATE_FIELDS.has(inner)) {
      log.warn(
        `Aggregate field "${inner}" in "${agg}" is not a known aggregatable span field. ` +
          "Span attributes (custom tags) cannot be aggregated — use them in --where or --group-by instead. " +
          `Known fields: ${[...KNOWN_SPAN_AGGREGATE_FIELDS].join(", ")}`
      );
    }
  }
}

export function buildWidgetFromFlags(opts: {
  title: string;
  display: string;
  dataset?: string;
  query?: string[];
  where?: string;
  groupBy?: string[];
  sort?: string;
  limit?: number;
}): DashboardWidget {
  const aggregates = (opts.query ?? ["count"]).map(parseAggregate);
  validateAggregateNames(aggregates, opts.dataset);
  warnUnknownAggregateFields(aggregates, opts.dataset);

  // Issue table widgets need at least one column or the Sentry UI shows "Columns: None".
  // Default to ["issue"] for table display only — timeseries (line/area/bar) don't use columns.
  const columns =
    opts.groupBy ??
    (opts.dataset === "issue" && opts.display === "table" ? ["issue"] : []);
  // Auto-default orderby to first aggregate descending when group-by is used.
  // Without this, chart widgets (line/area/bar) with group-by + limit error
  // because the dashboard can't determine which top N groups to display.
  let orderby = opts.sort ? parseSortExpression(opts.sort) : undefined;
  if (columns.length > 0 && !orderby && aggregates.length > 0) {
    orderby = `-${aggregates[0]}`;
  }

  // Only validate when user explicitly passes --group-by, not for auto-defaulted columns
  // (e.g., issue dataset auto-defaults columns to ["issue"] for table display)
  if (opts.groupBy) {
    validateGroupByRequiresLimit(columns, opts.limit);
  }
  if (orderby) {
    validateSortReferencesAggregate(orderby, aggregates);
  }

  const raw = {
    title: opts.title,
    displayType: opts.display,
    ...(opts.dataset && { widgetType: opts.dataset }),
    queries: [
      {
        aggregates,
        columns,
        conditions: opts.where ?? "",
        ...(orderby && { orderby }),
        name: "",
      },
    ],
    ...(opts.limit !== undefined && { limit: opts.limit }),
  };
  return prepareWidgetQueries(parseWidgetInput(raw));
}

/** Context for enriching dashboard API errors with actionable messages */
export type DashboardErrorContext = {
  /** Organization slug (when known) */
  orgSlug?: string;
  /** Dashboard ID (when known) */
  dashboardId?: string;
  /** The operation being performed, for error messages */
  operation: "list" | "view" | "create" | "update";
};

/** Build an enriched error for a 404 response on a dashboard API call */
function build404Error(ctx: DashboardErrorContext, org: string): never {
  if (ctx.operation === "list") {
    throw new ResolutionError(
      `Organization ${org}`,
      "not found or has no dashboards",
      "sentry dashboard list <org>/",
      [
        "Verify the organization slug with: sentry org list",
        "Check that you have access to the organization",
      ]
    );
  }
  const listHint = `sentry dashboard list ${ctx.orgSlug ?? "<org>"}/`;
  if (ctx.dashboardId) {
    throw new ResolutionError(
      `Dashboard ${ctx.dashboardId} in ${org}`,
      "not found",
      listHint,
      [
        "The dashboard may have been deleted",
        "Check the dashboard ID or title with: sentry dashboard list",
      ]
    );
  }
  // Generic 404 for create or other operations
  throw new ResolutionError(
    `Organization ${org}`,
    "not found",
    "sentry org list",
    ["Verify the organization slug and your access"]
  );
}

/** Build an enriched error for a 403 response on a dashboard API call */
function build403Error(
  ctx: DashboardErrorContext,
  org: string,
  detail: string | undefined
): never {
  const message = detail ?? "You do not have permission.";
  if (ctx.dashboardId) {
    throw new ResolutionError(
      `Dashboard ${ctx.dashboardId} in ${org}`,
      "access denied",
      `sentry dashboard list ${ctx.orgSlug ?? "<org>"}/`,
      [message, "Check your organization membership and role"]
    );
  }
  throw new ResolutionError(
    `Dashboards in ${org}`,
    "access denied",
    "sentry org list",
    [message, "Check your organization membership and role"]
  );
}

/**
 * Enrich an API error from a dashboard command with actionable suggestions.
 *
 * Catches 404, 403, and 400 errors and converts them to `ResolutionError`
 * or enriched `ApiError` instances with hints about what to try next.
 * Re-throws non-`ApiError` and unhandled statuses unchanged.
 *
 * @param error - The caught error
 * @param ctx - Context about the operation for building error messages
 */
export function enrichDashboardError(
  error: unknown,
  ctx: DashboardErrorContext
): never {
  if (!(error instanceof ApiError)) {
    throw error;
  }

  const org = ctx.orgSlug ? `'${ctx.orgSlug}'` : "this organization";

  if (error.status === 404) {
    build404Error(ctx, org);
  }

  if (error.status === 403) {
    build403Error(ctx, org, error.detail);
  }

  // 400 on update — likely invalid widget config; preserve API detail
  if (error.status === 400 && ctx.operation === "update") {
    throw new ApiError(
      `Dashboard update failed in ${org}`,
      error.status,
      error.detail ??
        "The API rejected the request. Check widget configuration.",
      error.endpoint
    );
  }

  throw error;
}

/**
 * Validate --display and --dataset flag values against known enums.
 *
 * @param display - Display type flag value
 * @param dataset - Dataset flag value
 */
export function validateWidgetEnums(display?: string, dataset?: string): void {
  if (
    display &&
    !DISPLAY_TYPES.includes(display as (typeof DISPLAY_TYPES)[number])
  ) {
    throw new ValidationError(
      `Invalid --display value "${display}".\nValid display types: ${DISPLAY_TYPES.join(", ")}`,
      "display"
    );
  }
  if (
    dataset &&
    !WIDGET_TYPES.includes(dataset as (typeof WIDGET_TYPES)[number])
  ) {
    throw new ValidationError(
      `Invalid --dataset value "${dataset}".\nValid datasets: ${WIDGET_TYPES.join(", ")}`,
      "dataset"
    );
  }
  if (display && dataset) {
    // Untracked display types (text, wheel, rage_and_dead_clicks, agents_traces_table)
    // bypass Sentry's dataset query system entirely — no dataset constraint applies.
    const isTrackedDisplay = Object.values(
      DATASET_SUPPORTED_DISPLAY_TYPES
    ).some((types) => (types as readonly string[]).includes(display));
    if (isTrackedDisplay) {
      const supported = DATASET_SUPPORTED_DISPLAY_TYPES[dataset as WidgetType];
      if (supported && !(supported as readonly string[]).includes(display)) {
        throw new ValidationError(
          `The "${dataset}" dataset supports: ${supported.join(", ")}. Got: "${display}".`,
          "display"
        );
      }
    }
  }
}
