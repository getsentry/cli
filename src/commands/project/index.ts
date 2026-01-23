import { buildRouteMap } from "@stricli/core";
import { listCommand } from "./list.js";
import { viewCommand } from "./view.js";

export const projectRoute = buildRouteMap({
  routes: {
    list: listCommand,
    view: viewCommand,
  },
  docs: {
    brief: "Work with Sentry projects",
    fullDescription: "List and manage Sentry projects in your organizations.",
    hideRoute: {},
  },
});
