import { buildRouteMap } from "@stricli/core";
import { listCommand } from "./list.js";
import { newCommand } from "./new.js";

export const deploysRoute = buildRouteMap({
  routes: {
    list: listCommand,
    new: newCommand,
  },
  docs: {
    brief: "Manage deployments for Sentry releases",
    fullDescription:
      "Manage deployments for Sentry releases.\n\n" +
      "Commands:\n" +
      "  list  List deployments\n" +
      "  new   Create a new deployment",
    hideRoute: {},
  },
});
