import { buildRouteMap } from "@stricli/core";
import { listCommand } from "./list.js";
import { runMonitorCommand } from "./run.js";

export const monitorsRoute = buildRouteMap({
  routes: {
    list: listCommand,
    run: runMonitorCommand,
  },
  docs: {
    brief: "Manage cron monitors on Sentry",
    fullDescription:
      "Manage cron monitors on Sentry.\n\n" +
      "Commands:\n" +
      "  list  List cron monitors\n" +
      "  run   Run a command and report to a cron monitor",
    hideRoute: {},
  },
});
