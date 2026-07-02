/**
 * `sentry snapshots` — manage and compare preprod snapshot images.
 *
 * Currently exposes `download`. `diff` and `upload` are ported separately.
 */

import { buildRouteMap } from "../../lib/route-map.js";
import { downloadCommand } from "./download.js";

export const snapshotsRoute = buildRouteMap({
  routes: {
    download: downloadCommand,
  },
  docs: {
    brief: "Manage and compare snapshots",
  },
});
