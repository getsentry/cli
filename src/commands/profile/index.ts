import { buildRouteMap } from "@stricli/core";
import { listCommand } from "./list.js";
import { viewCommand } from "./view.js";

export const profileRoute = buildRouteMap({
  routes: {
    list: listCommand,
    view: viewCommand,
  },
  docs: {
    brief: "Analyze CPU profiling data",
    fullDescription:
      "View and analyze CPU profiling data from your Sentry projects.\n\n" +
      "Commands:\n" +
      "  list    List transactions with profiling data\n" +
      "  view    View CPU profiling analysis for a transaction",
    hideRoute: {},
  },
});
