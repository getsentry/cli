import { buildRouteMap } from "@stricli/core";
import { addCommand } from "./add.js";
import { deleteCommand } from "./delete.js";
import { editCommand } from "./edit.js";
import { typesCommand } from "./types.js";

export const widgetRoute = buildRouteMap({
  routes: {
    add: addCommand,
    edit: editCommand,
    delete: deleteCommand,
    types: typesCommand,
  },
  docs: {
    brief: "Manage dashboard widgets",
    fullDescription:
      "Add, edit, or delete widgets in a Sentry dashboard.\n\n" +
      "Dashboards use a 6-column grid. Widget widths should sum to 6 per row.\n\n" +
      "Display types (width × height):\n" +
      "  common:      big_number (2×1), line (3×2), area (3×2), bar (3×2), table (6×2)\n" +
      "  specialized: stacked_area (3×2), top_n (3×2), categorical_bar (3×2), text (3×2)\n" +
      "  internal:    details, wheel, rage_and_dead_clicks, server_tree, agents_traces_table (3×2)\n\n" +
      "Default dataset: spans. Run 'sentry dashboard widget types' for the full list.\n\n" +
      "Commands:\n" +
      "  add    Add a widget to a dashboard\n" +
      "  edit   Edit a widget in a dashboard\n" +
      "  delete Delete a widget from a dashboard\n" +
      "  types  Show available display types and layout info",
    hideRoute: {},
  },
});
