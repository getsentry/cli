import { buildRouteMap } from "@stricli/core";
import { createCommand } from "./create.js";
import { listCommand } from "./list.js";
import { viewCommand } from "./view.js";
import { widgetRoute } from "./widget/index.js";

export const dashboardRoute = buildRouteMap({
  routes: {
    list: listCommand,
    view: viewCommand,
    create: createCommand,
    widget: widgetRoute,
  },
  defaultCommand: "view",
  aliases: { show: "view" },
  docs: {
    brief: "Manage Sentry dashboards",
    fullDescription:
      "View and manage dashboards in your Sentry organization.\n\n" +
      "Commands:\n" +
      "  list     List dashboards\n" +
      "  view     View a dashboard\n" +
      "  create   Create a dashboard\n" +
      "  widget   Manage dashboard widgets (add, edit, delete)",
    hideRoute: {},
  },
});
