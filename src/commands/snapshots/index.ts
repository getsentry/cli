/**
 * `sentry snapshots` — manage and compare preprod snapshot images.
 *
 * Exposes `download` and `diff`. `upload` is ported separately (objectstore).
 */

import { buildRouteMap } from "../../lib/route-map.js";
import { diffCommand } from "./diff.js";
import { downloadCommand } from "./download.js";

export const snapshotsRoute = buildRouteMap({
  routes: {
    diff: diffCommand,
    download: downloadCommand,
  },
  docs: {
    brief: "Manage and compare snapshots",
  },
});
