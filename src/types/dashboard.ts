/**
 * Dashboard types and schemas
 *
 * Zod schemas and TypeScript types for Sentry Dashboard API responses.
 * Includes utility functions for stripping server-generated fields
 * before PUT requests.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

/** Schema for a single query within a dashboard widget */
export const DashboardWidgetQuerySchema = z
  .object({
    id: z.string().optional(),
    name: z.string().optional(),
    conditions: z.string().optional(),
    columns: z.array(z.string()).optional(),
    aggregates: z.array(z.string()).optional(),
    fieldAliases: z.array(z.string()).optional(),
    orderby: z.string().optional(),
    fields: z.array(z.string()).optional(),
    widgetId: z.string().optional(),
    dateCreated: z.string().optional(),
  })
  .passthrough();

/** Schema for widget layout position */
export const DashboardWidgetLayoutSchema = z
  .object({
    x: z.number(),
    y: z.number(),
    w: z.number(),
    h: z.number(),
    minH: z.number().optional(),
    isResizable: z.boolean().optional(),
  })
  .passthrough();

/** Schema for a single dashboard widget */
export const DashboardWidgetSchema = z
  .object({
    id: z.string().optional(),
    title: z.string(),
    displayType: z.string(),
    widgetType: z.string().optional(),
    interval: z.string().optional(),
    queries: z.array(DashboardWidgetQuerySchema).optional(),
    layout: DashboardWidgetLayoutSchema.optional(),
    thresholds: z.unknown().optional(),
    limit: z.number().nullable().optional(),
    dashboardId: z.string().optional(),
    dateCreated: z.string().optional(),
  })
  .passthrough();

/** Schema for dashboard list items (lightweight, from GET /dashboards/) */
export const DashboardListItemSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    dateCreated: z.string().optional(),
    createdBy: z
      .object({
        name: z.string().optional(),
        email: z.string().optional(),
      })
      .optional(),
    widgetDisplay: z.array(z.string()).optional(),
  })
  .passthrough();

/** Schema for full dashboard detail (from GET /dashboards/{id}/) */
export const DashboardDetailSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    widgets: z.array(DashboardWidgetSchema).optional(),
    dateCreated: z.string().optional(),
    createdBy: z
      .object({
        name: z.string().optional(),
        email: z.string().optional(),
      })
      .optional(),
    projects: z.array(z.number()).optional(),
    environment: z.array(z.string()).optional(),
    period: z.string().nullable().optional(),
  })
  .passthrough();

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DashboardWidgetQuery = z.infer<typeof DashboardWidgetQuerySchema>;
export type DashboardWidgetLayout = z.infer<typeof DashboardWidgetLayoutSchema>;
export type DashboardWidget = z.infer<typeof DashboardWidgetSchema>;
export type DashboardListItem = z.infer<typeof DashboardListItemSchema>;
export type DashboardDetail = z.infer<typeof DashboardDetailSchema>;

// ---------------------------------------------------------------------------
// Auto-layout utilities
// ---------------------------------------------------------------------------

/** Sentry dashboard grid column count */
const GRID_COLUMNS = 6;

/** Default widget dimensions by displayType */
const DEFAULT_WIDGET_SIZE: Record<
  string,
  { w: number; h: number; minH: number }
> = {
  big_number: { w: 2, h: 1, minH: 1 },
  line: { w: 3, h: 2, minH: 2 },
  area: { w: 3, h: 2, minH: 2 },
  bar: { w: 3, h: 2, minH: 2 },
  table: { w: 6, h: 2, minH: 2 },
  world_map: { w: 4, h: 2, minH: 2 },
};
const FALLBACK_SIZE = { w: 3, h: 2, minH: 2 };

/** Build a set of occupied grid cells and the max bottom edge from existing layouts. */
function buildOccupiedGrid(widgets: DashboardWidget[]): {
  occupied: Set<string>;
  maxY: number;
} {
  const occupied = new Set<string>();
  let maxY = 0;
  for (const w of widgets) {
    if (!w.layout) {
      continue;
    }
    const bottom = w.layout.y + w.layout.h;
    if (bottom > maxY) {
      maxY = bottom;
    }
    for (let y = w.layout.y; y < bottom; y++) {
      for (let x = w.layout.x; x < w.layout.x + w.layout.w; x++) {
        occupied.add(`${x},${y}`);
      }
    }
  }
  return { occupied, maxY };
}

/** Check whether a rectangle fits at a position without overlapping occupied cells. */
function regionFits(
  occupied: Set<string>,
  rect: { px: number; py: number; w: number; h: number }
): boolean {
  for (let dy = 0; dy < rect.h; dy++) {
    for (let dx = 0; dx < rect.w; dx++) {
      if (occupied.has(`${rect.px + dx},${rect.py + dy}`)) {
        return false;
      }
    }
  }
  return true;
}

/**
 * Assign a default layout to a widget if it doesn't already have one.
 * Packs the widget into the first available space in a 6-column grid,
 * scanning rows top-to-bottom and left-to-right.
 *
 * @param widget - Widget that may be missing a layout
 * @param existingWidgets - Widgets already in the dashboard (used to compute placement)
 * @returns Widget with layout guaranteed
 */
export function assignDefaultLayout(
  widget: DashboardWidget,
  existingWidgets: DashboardWidget[]
): DashboardWidget {
  if (widget.layout) {
    return widget;
  }

  const { w, h, minH } =
    DEFAULT_WIDGET_SIZE[widget.displayType] ?? FALLBACK_SIZE;

  const { occupied, maxY } = buildOccupiedGrid(existingWidgets);

  // Scan rows to find the first position where the widget fits
  for (let y = 0; y <= maxY; y++) {
    for (let x = 0; x <= GRID_COLUMNS - w; x++) {
      if (regionFits(occupied, { px: x, py: y, w, h })) {
        return { ...widget, layout: { x, y, w, h, minH } };
      }
    }
  }

  // No gap found — place below everything
  return { ...widget, layout: { x: 0, y: maxY, w, h, minH } };
}

// ---------------------------------------------------------------------------
// Server field stripping utilities
// ---------------------------------------------------------------------------

/**
 * Server-generated fields on widget queries that must be stripped before PUT.
 * NEVER strip user-controlled fields like conditions, columns, aggregates.
 */
const QUERY_SERVER_FIELDS = ["id", "widgetId", "dateCreated"] as const;

/**
 * Server-generated fields on widgets that must be stripped before PUT.
 * CRITICAL: Never strip widgetType, displayType, or layout — these are
 * user-controlled and stripping them causes widgets to reset to defaults.
 */
const WIDGET_SERVER_FIELDS = ["id", "dashboardId", "dateCreated"] as const;

/**
 * Server-generated fields on widget layout that must be stripped before PUT.
 */
const LAYOUT_SERVER_FIELDS = ["isResizable"] as const;

/**
 * Strip server-generated fields from a single widget for PUT requests.
 *
 * @param widget - Widget object from GET response
 * @returns Widget safe for PUT (widgetType, displayType, layout preserved)
 */
export function stripWidgetServerFields(
  widget: DashboardWidget
): DashboardWidget {
  const cleaned = { ...widget };

  // Strip widget-level server fields
  for (const field of WIDGET_SERVER_FIELDS) {
    delete (cleaned as Record<string, unknown>)[field];
  }

  // Strip query-level server fields
  if (cleaned.queries) {
    cleaned.queries = cleaned.queries.map((q) => {
      const cleanedQuery = { ...q };
      for (const field of QUERY_SERVER_FIELDS) {
        delete (cleanedQuery as Record<string, unknown>)[field];
      }
      return cleanedQuery;
    });
  }

  // Strip layout server fields
  if (cleaned.layout) {
    const cleanedLayout = { ...cleaned.layout };
    for (const field of LAYOUT_SERVER_FIELDS) {
      delete (cleanedLayout as Record<string, unknown>)[field];
    }
    cleaned.layout = cleanedLayout;
  }

  return cleaned;
}

/**
 * Prepare a full dashboard for PUT update.
 * Strips server-generated fields from all widgets while preserving
 * widgetType, displayType, and layout.
 *
 * @param dashboard - Dashboard detail from GET response
 * @returns Object with title and cleaned widgets, ready for PUT body
 */
export function prepareDashboardForUpdate(dashboard: DashboardDetail): {
  title: string;
  widgets: DashboardWidget[];
  projects?: number[];
} {
  return {
    title: dashboard.title,
    widgets: (dashboard.widgets ?? []).map(stripWidgetServerFields),
    projects: dashboard.projects,
  };
}
