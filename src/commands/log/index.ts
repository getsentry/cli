/**
 * sentry log
 *
 * View and stream logs from Sentry projects.
 */

import { buildRouteMap } from "@stricli/core";
import { listCommand } from "./list.js";

export const logRoute = buildRouteMap({
  routes: {
    list: listCommand,
  },
  docs: {
    brief: "View Sentry logs",
    fullDescription:
      "View and stream logs from your Sentry projects.\n\n" +
      "Commands:\n" +
      "  list     List or stream logs from a project\n\n" +
      "Examples:\n" +
      "  sentry log list                    # Auto-detect from DSN\n" +
      "  sentry log list myorg/myproject    # Explicit org/project\n" +
      "  sentry log list -f                 # Stream logs in real-time\n" +
      "  sentry log list -q 'level:error'   # Filter to error level only",
    hideRoute: {},
  },
});
