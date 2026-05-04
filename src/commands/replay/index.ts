/**
 * sentry replay
 *
 * Search and inspect Session Replays.
 */

import { buildRouteMap } from "../../lib/route-map.js";
import { eventRoute } from "./event/index.js";
import { listCommand } from "./list.js";
import { summarizeCommand } from "./summarize.js";
import { viewCommand } from "./view.js";

export const replayRoute = buildRouteMap({
  routes: {
    event: eventRoute,
    list: listCommand,
    summarize: summarizeCommand,
    view: viewCommand,
  },
  aliases: { events: "event" },
  defaultCommand: "view",
  docs: {
    brief: "Search and inspect Session Replays",
    fullDescription:
      "Search and inspect Session Replays from your Sentry organization.\n\n" +
      "Commands:\n" +
      "  event    Inspect normalized events from a replay (alias: events)\n" +
      "  list     List recent replays in an org or project\n" +
      "  summarize Summarize replay behavior and friction signals\n" +
      "  view     View details of a specific replay\n\n" +
      "Alias: `sentry replays` → `sentry replay list`",
    hideRoute: {},
  },
});
