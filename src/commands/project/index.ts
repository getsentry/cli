import { buildRouteMap } from "@stricli/core";
import { createCommand } from "./create.js";
import { listCommand } from "./list.js";
import { viewCommand } from "./view.js";

export const projectRoute = buildRouteMap({
  routes: {
    create: createCommand,
    list: listCommand,
    view: viewCommand,
  },
  docs: {
    brief: "Work with Sentry projects",
    fullDescription: "List and manage Sentry projects in your organizations.",
    hideRoute: {},
  },
});
