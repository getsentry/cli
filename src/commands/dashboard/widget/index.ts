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
      "Dashboards use a 6-column grid. Widget widths should sum to 6 per row.\n" +
      "Common display types: big_number (2 cols), line/area/bar (3 cols), table (6 cols).\n" +
      "Default dataset: spans. Run 'sentry dashboard widget types' for the full list.\n\n" +
      "Commands:\n" +
      "  add    Add a widget to a dashboard\n" +
      "  edit   Edit a widget in a dashboard\n" +
      "  delete Delete a widget from a dashboard\n" +
      "  types  Show available display types and layout info",
    hideRoute: {},
  },
});
