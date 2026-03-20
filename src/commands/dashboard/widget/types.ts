/**
 * sentry dashboard widget types
 *
 * Show available widget display types, default sizes, datasets,
 * and aggregate functions. Purely local — no API calls or auth needed.
 */

import type { SentryContext } from "../../../context.js";
import { buildCommand } from "../../../lib/command.js";
import { renderMarkdown } from "../../../lib/formatters/markdown.js";
import { CommandOutput } from "../../../lib/formatters/output.js";
import { type Column, writeTable } from "../../../lib/formatters/table.js";
import {
  AGGREGATE_ALIASES,
  DEFAULT_WIDGET_SIZE,
  DEFAULT_WIDGET_TYPE,
  DISCOVER_AGGREGATE_FUNCTIONS,
  DISPLAY_TYPES,
  type DisplayType,
  FALLBACK_SIZE,
  GRID_COLUMNS,
  SPAN_AGGREGATE_FUNCTIONS,
  WIDGET_TYPES,
} from "../../../types/dashboard.js";
import type { Writer } from "../../../types/index.js";

/** Category classification for display types */
const DISPLAY_TYPE_CATEGORY: Record<
  string,
  "common" | "specialized" | "internal"
> = {
  big_number: "common",
  line: "common",
  area: "common",
  bar: "common",
  table: "common",
  stacked_area: "specialized",
  top_n: "specialized",
  categorical_bar: "specialized",
  text: "specialized",
  details: "internal",
  wheel: "internal",
  rage_and_dead_clicks: "internal",
  server_tree: "internal",
  agents_traces_table: "internal",
};

export type WidgetTypesResult = {
  grid: { columns: number };
  displayTypes: Array<{
    name: string;
    defaultWidth: number;
    defaultHeight: number;
    category: "common" | "specialized" | "internal";
  }>;
  datasets: Array<{ name: string; isDefault: boolean }>;
  aggregateFunctions: {
    spans: readonly string[];
    discover: readonly string[];
  };
  aggregateAliases: Record<string, string>;
};

/**
 * Format widget types info for human-readable terminal output.
 *
 * Renders grid info, a display types table, a datasets table, and
 * aggregate function summaries.
 */
function formatWidgetTypesHuman(result: WidgetTypesResult): string {
  const parts: string[] = [];
  const buffer: Writer = { write: (s) => parts.push(s) };

  // Grid header
  parts.push(renderMarkdown(`**Grid:** ${result.grid.columns} columns`));
  parts.push("\n");

  // Display types table
  type DisplayRow = WidgetTypesResult["displayTypes"][number];
  const dtColumns: Column<DisplayRow>[] = [
    { header: "DISPLAY TYPE", value: (r) => r.name },
    { header: "WIDTH:", value: (r) => String(r.defaultWidth), align: "right" },
    {
      header: "HEIGHT:",
      value: (r) => String(r.defaultHeight),
      align: "right",
    },
    { header: "CATEGORY", value: (r) => r.category },
  ];
  writeTable(buffer, result.displayTypes, dtColumns);

  parts.push("\n");

  // Datasets table
  type DatasetRow = WidgetTypesResult["datasets"][number];
  const dsColumns: Column<DatasetRow>[] = [
    { header: "DATASET", value: (r) => r.name },
    { header: "DEFAULT", value: (r) => (r.isDefault ? "✓" : "") },
  ];
  writeTable(buffer, result.datasets, dsColumns);

  parts.push("\n");

  // Aggregate functions
  const aggLines: string[] = [];
  aggLines.push(
    `**Aggregates (spans):** ${result.aggregateFunctions.spans.join(", ")}`
  );

  const spanSet = new Set(result.aggregateFunctions.spans);
  const discoverOnly = result.aggregateFunctions.discover.filter(
    (f) => !spanSet.has(f)
  );
  if (discoverOnly.length > 0) {
    aggLines.push(`**Aggregates (discover):** + ${discoverOnly.join(", ")}`);
  }

  const aliasEntries = Object.entries(result.aggregateAliases);
  if (aliasEntries.length > 0) {
    aggLines.push(
      `**Aliases:** ${aliasEntries.map(([k, v]) => `${k} → ${v}`).join(", ")}`
    );
  }

  parts.push(renderMarkdown(aggLines.join("\n")));

  return parts.join("").trimEnd();
}

export const typesCommand = buildCommand({
  docs: {
    brief: "Show available widget display types and layout info",
    fullDescription:
      "Show available widget display types with default grid sizes, datasets, " +
      "and aggregate functions.\n\n" +
      "Sentry dashboards use a 6-column grid. When adding widgets, aim to fill " +
      "complete rows (widths should sum to 6).\n\n" +
      "Display types (width × height):\n" +
      "  common:      big_number (2×1), line (3×2), area (3×2), bar (3×2), table (6×2)\n" +
      "  specialized: stacked_area (3×2), top_n (3×2), categorical_bar (3×2), text (3×2)\n" +
      "  internal:    details, wheel, rage_and_dead_clicks, server_tree, agents_traces_table (3×2)\n\n" +
      "Examples:\n" +
      "  sentry dashboard widget types\n" +
      "  sentry dashboard widget types --json",
  },
  output: {
    human: formatWidgetTypesHuman,
  },
  parameters: {
    positional: { kind: "array", parameter: { brief: "", parse: String } },
    flags: {},
    aliases: {},
  },
  // biome-ignore lint/suspicious/useAwait: buildCommand requires async generator
  async *func(this: SentryContext, _flags: { readonly json: boolean }) {
    const displayTypes = DISPLAY_TYPES.map((name) => {
      const size = DEFAULT_WIDGET_SIZE[name as DisplayType] ?? FALLBACK_SIZE;
      return {
        name,
        defaultWidth: size.w,
        defaultHeight: size.h,
        category: DISPLAY_TYPE_CATEGORY[name] ?? ("internal" as const),
      };
    });

    const datasets = WIDGET_TYPES.map((name) => ({
      name,
      isDefault: name === DEFAULT_WIDGET_TYPE,
    }));

    const result: WidgetTypesResult = {
      grid: { columns: GRID_COLUMNS },
      displayTypes,
      datasets,
      aggregateFunctions: {
        spans: SPAN_AGGREGATE_FUNCTIONS,
        discover: DISCOVER_AGGREGATE_FUNCTIONS,
      },
      aggregateAliases: { ...AGGREGATE_ALIASES },
    };

    yield new CommandOutput(result);
  },
});
