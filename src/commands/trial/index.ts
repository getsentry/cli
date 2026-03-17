import { buildRouteMap } from "@stricli/core";
import { listCommand } from "./list.js";
import { startCommand } from "./start.js";

export const trialRoute = buildRouteMap({
  routes: {
    list: listCommand,
    start: startCommand,
  },
  docs: {
    brief: "Manage product trials",
    fullDescription:
      "List and start product trials for your organization.\n\n" +
      "Alias: `sentry trials` → `sentry trial list`",
    hideRoute: {},
  },
});
