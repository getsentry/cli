/**
 * sentry trace
 *
 * View and explore distributed traces from Sentry projects.
 */

import { buildRouteMap } from "@stricli/core";
import { listCommand } from "./list.js";
import { viewCommand } from "./view.js";

export const traceRoute = buildRouteMap({
  routes: {
    list: listCommand,
    view: viewCommand,
  },
  docs: {
    brief: "View distributed traces",
    fullDescription:
      "View and explore distributed traces from your Sentry projects.\n\n" +
      "Commands:\n" +
      "  list     List recent traces in a project\n" +
      "  view     View details of a specific trace",
    hideRoute: {},
  },
});
