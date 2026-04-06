import { buildRouteMap } from "@stricli/core";
import { listCommand } from "./list.js";
import { viewCommand } from "./view.js";

export const eventRoute = buildRouteMap({
  routes: {
    view: viewCommand,
    list: listCommand,
  },
  defaultCommand: "view",
  aliases: { show: "view" },
  docs: {
    brief: "View and list Sentry events",
    fullDescription:
      "View and list event data from Sentry.\n\n" +
      "Use 'sentry event view <event-id>' to view a specific event.\n" +
      "Use 'sentry event list <issue-id>' to list events for an issue.",
    hideRoute: {},
  },
});
