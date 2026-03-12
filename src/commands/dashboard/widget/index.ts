import { buildRouteMap } from "@stricli/core";
import { addCommand } from "./add.js";
import { editCommand } from "./edit.js";

export const widgetRoute = buildRouteMap({
  routes: {
    add: addCommand,
    edit: editCommand,
  },
  docs: {
    brief: "Manage dashboard widgets",
    fullDescription:
      "Add or edit widgets in a Sentry dashboard.\n\n" +
      "Commands:\n" +
      "  add    Add a widget to a dashboard\n" +
      "  edit   Edit a widget in a dashboard",
    hideRoute: {},
  },
});
