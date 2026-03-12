import { buildRouteMap } from "@stricli/core";
import { addCommand } from "./add.js";
import { deleteCommand } from "./delete.js";
import { editCommand } from "./edit.js";

export const widgetRoute = buildRouteMap({
  routes: {
    add: addCommand,
    edit: editCommand,
    delete: deleteCommand,
  },
  docs: {
    brief: "Manage dashboard widgets",
    fullDescription:
      "Add, edit, or delete widgets in a Sentry dashboard.\n\n" +
      "Commands:\n" +
      "  add    Add a widget to a dashboard\n" +
      "  edit   Edit a widget in a dashboard\n" +
      "  delete Delete a widget from a dashboard",
    hideRoute: {},
  },
});
