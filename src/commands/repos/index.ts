import { buildRouteMap } from "@stricli/core";
import { listCommand } from "./list.js";

export const reposRoute = buildRouteMap({
  routes: {
    list: listCommand,
  },
  docs: {
    brief: "Manage repositories on Sentry",
    fullDescription:
      "Manage repositories configured in Sentry.\n\n" +
      "Commands:\n" +
      "  list  List repositories",
    hideRoute: {},
  },
});
