import { buildRouteMap } from "@stricli/core";
import { viewCommand } from "./view.js";

export const eventRoute = buildRouteMap({
  routes: {
    view: viewCommand,
  },
  docs: {
    brief: "View Sentry events",
    fullDescription:
      "View detailed event data from Sentry. " +
      "Use 'sentry event view <event-id>' to view a specific event.",
    hideRoute: {},
  },
});
