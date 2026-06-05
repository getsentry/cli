/**
 * sentry proguard
 *
 * Route map for ProGuard/R8 mapping commands. Currently exposes `uuid`;
 * `upload` is tracked separately (see issue #1053).
 */

import { buildRouteMap } from "../../lib/route-map.js";
import { uuidCommand } from "./uuid.js";

export const proguardRoute = buildRouteMap({
  routes: {
    uuid: uuidCommand,
  },
  docs: {
    brief: "Work with ProGuard/R8 mapping files",
    fullDescription:
      "Compute UUIDs for Android ProGuard/R8 mapping files.\n\n" +
      "The UUID is derived deterministically from the mapping file contents " +
      "and identifies the mapping when deobfuscating Android stack traces.",
  },
});
