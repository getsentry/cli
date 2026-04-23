import { buildRouteMap } from "../../../lib/route-map.js";
import { listCommand } from "./list.js";
import { viewCommand } from "./view.js";

export const issuesRoute = buildRouteMap({
  routes: {
    list: listCommand,
    view: viewCommand,
  },
  docs: {
    brief: "Manage issue alert rules",
    fullDescription:
      "View and manage issue alert rules in your Sentry projects.\n\n" +
      "Commands:\n" +
      "  list   List issue alert rules\n" +
      "  view   View issue alert rule details",
    hideRoute: {},
  },
});
