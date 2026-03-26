import { buildRouteMap } from "@stricli/core";
import { listCommand } from "./list.js";

export const metricsRoute = buildRouteMap({
  routes: {
    list: listCommand,
  },
  docs: {
    brief: "Manage metric alert rules",
    fullDescription:
      "View and manage metric alert rules in your Sentry organization.\n\n" +
      "Commands:\n" +
      "  list   List metric alert rules",
    hideRoute: {},
  },
});
