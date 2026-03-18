/**
 * Shared dashboard resolution utilities
 *
 * Provides org resolution from parsed target arguments and dashboard
 * ID resolution from numeric IDs or title strings.
 */

import { listDashboards } from "../../lib/api-client.js";
import type { parseOrgProjectArg } from "../../lib/arg-parsing.js";
import { ContextError, ValidationError } from "../../lib/errors.js";
import { resolveOrg } from "../../lib/resolve-target.js";
import { isAllDigits } from "../../lib/utils.js";
import {
  type DashboardWidget,
  DISPLAY_TYPES,
  parseAggregate,
  parseSortExpression,
  parseWidgetInput,
  prepareWidgetQueries,
  validateAggregateNames,
  WIDGET_TYPES,
} from "../../types/dashboard.js";

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
    case "org-all":
      return parsed.org;
    case "project-search":
    case "auto-detect": {
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
 * @param args - Raw positional arguments
 * @param usageHint - Error message label (e.g. "Dashboard ID or title")
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
  return {
    dashboardRef: args[1] as string,
    targetArg: args[0] as string,
  };
}

/**
 * Resolve a dashboard reference (numeric ID or title) to a numeric ID string.
 *
 * If the reference is all digits, returns it directly. Otherwise, lists
 * dashboards in the org and finds a case-insensitive title match.
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

  const dashboards = await listDashboards(orgSlug);
  const lowerRef = ref.toLowerCase();
  const match = dashboards.find((d) => d.title.toLowerCase() === lowerRef);

  if (!match) {
    const available = dashboards
      .slice(0, 5)
      .map((d) => `  ${d.id}  ${d.title}`)
      .join("\n");
    const suffix =
      dashboards.length > 5 ? `\n  ... and ${dashboards.length - 5} more` : "";
    throw new ValidationError(
      `No dashboard with title '${ref}' found in '${orgSlug}'.\n\n` +
        `Available dashboards:\n${available}${suffix}`
    );
  }

  return match.id;
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
  const matchIndex = widgets.findIndex((w) => w.title === title);
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
 * Shared between `dashboard create --widget-*` and `dashboard widget add`.
 * Parses aggregate shorthand, sort expressions, and validates via Zod schema.
 *
 * @param opts - Widget configuration from parsed flags
 * @returns Validated widget with computed query fields
 */
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

  const columns = opts.groupBy ?? [];
  const orderby = opts.sort ? parseSortExpression(opts.sort) : undefined;

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
}
