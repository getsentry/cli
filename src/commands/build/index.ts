/**
 * `sentry build` — manage mobile build artifacts for preprod size analysis.
 *
 * Currently exposes `download`. Upload (APK/AAB, and iOS XCArchive/IPA) is
 * ported separately.
 */

import { buildRouteMap } from "../../lib/route-map.js";
import { downloadCommand } from "./download.js";

export const buildRoute = buildRouteMap({
  routes: {
    download: downloadCommand,
  },
  docs: {
    brief: "Manage mobile build artifacts",
    fullDescription:
      "Upload and download mobile build artifacts (APK/AAB/IPA/XCArchive) for " +
      "Sentry preprod size analysis. Sentry SaaS only.",
  },
});
