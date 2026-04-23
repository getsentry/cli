import { buildRouteMap } from "../../../lib/route-map.js";
import { listCommand } from "./list.js";
import { viewCommand } from "./view.js";

export const metricsRoute = buildRouteMap({
  routes: {
    list: listCommand,
    view: viewCommand,
  },
  docs: {
    brief: "Manage metric alert rules",
    fullDescription:
      "View and manage metric alert rules in your Sentry organization.\n\n" +
      "Commands:\n" +
      "  list   List metric alert rules\n" +
      "  view   View metric alert rule details",
    hideRoute: {},
  },
});
