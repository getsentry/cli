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
} {
  return {
    title: dashboard.title,
    widgets: (dashboard.widgets ?? []).map(stripWidgetServerFields),
  };
}
