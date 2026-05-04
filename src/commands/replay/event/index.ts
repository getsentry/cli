/**
 * sentry replay event
 *
 * Inspect normalized events from Session Replay recordings.
 */

import { buildRouteMap } from "../../../lib/route-map.js";
import { listCommand } from "./list.js";

export const eventRoute = buildRouteMap({
  routes: {
    list: listCommand,
  },
  defaultCommand: "list",
  docs: {
    brief: "Inspect normalized replay events",
    fullDescription:
      "Inspect normalized events extracted from Session Replay recordings.\n\n" +
      "Commands:\n" +
      "  list     List normalized replay events\n\n" +
      "Alias: `sentry replay events` → `sentry replay event list`",
    hideRoute: {},
  },
});
