import { buildRouteMap } from "@stricli/core";
import { listCommand } from "./list.js";

export const repoRoute = buildRouteMap({
  routes: {
    list: listCommand,
  },
  docs: {
    brief: "Work with Sentry repositories",
    fullDescription:
      "List and manage repositories connected to your Sentry organizations.\n\n" +
      "Alias: `sentry repos` → `sentry repo list`",
    hideRoute: {},
  },
});
