/**
 * sentry span
 *
 * View and explore individual spans within distributed traces.
 */

import { buildRouteMap } from "@stricli/core";
import { listCommand } from "./list.js";
import { viewCommand } from "./view.js";

export const spanRoute = buildRouteMap({
  routes: {
    list: listCommand,
    view: viewCommand,
  },
  docs: {
    brief: "View spans in distributed traces",
    fullDescription:
      "View and explore individual spans within distributed traces.\n\n" +
      "Commands:\n" +
      "  list     List spans in a trace\n" +
      "  view     View details of specific spans\n\n" +
      "Alias: `sentry spans` → `sentry span list`",
  },
});
