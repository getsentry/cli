/**
 * sentry debug-files
 *
 * Route map for debug file commands.
 */

import { buildRouteMap } from "../../lib/route-map.js";
import { bundleJvmCommand } from "./bundle-jvm.js";
import { bundleSourcesCommand } from "./bundle-sources.js";
import { checkCommand } from "./check.js";

export const debugFilesRoute = buildRouteMap({
  routes: {
    check: checkCommand,
    "bundle-jvm": bundleJvmCommand,
    "bundle-sources": bundleSourcesCommand,
  },
  docs: {
    brief: "Work with debug information files",
    fullDescription:
      "Create and manage debug information files (DIFs) for source context " +
      "in Sentry stack traces.",
  },
});
