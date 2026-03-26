import { buildRouteMap } from "@stricli/core";
import { listCommand } from "./list.js";

export const issuesRoute = buildRouteMap({
  routes: {
    list: listCommand,
  },
  docs: {
    brief: "Manage issue alert rules",
    fullDescription:
      "View and manage issue alert rules in your Sentry projects.\n\n" +
      "Commands:\n" +
      "  list   List issue alert rules",
    hideRoute: {},
  },
});
