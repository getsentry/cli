import { buildRouteMap } from "@stricli/core";
import { injectCommand } from "./inject.js";
import { uploadCommand } from "./upload.js";

export const sourcemapRoute = buildRouteMap({
  routes: {
    inject: injectCommand,
    upload: uploadCommand,
  },
  docs: {
    brief: "Manage sourcemaps",
    fullDescription:
      "Inject debug IDs and upload sourcemaps to Sentry.\n\n" +
      "Alias: `sentry sourcemaps` → `sentry sourcemap`",
    hideRoute: {},
  },
});
