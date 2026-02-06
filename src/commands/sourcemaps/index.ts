import { buildRouteMap } from "@stricli/core";
import { injectCommand } from "./inject.js";
import { resolveCommand } from "./resolve.js";
import { uploadCommand } from "./upload.js";

export const sourcemapsRoute = buildRouteMap({
  routes: {
    upload: uploadCommand,
    inject: injectCommand,
    resolve: resolveCommand,
  },
  docs: {
    brief: "Manage sourcemaps for Sentry releases",
    fullDescription:
      "Manage sourcemaps for Sentry releases.\n\n" +
      "Commands:\n" +
      "  upload   Upload sourcemaps\n" +
      "  inject   Inject debug IDs into source files\n" +
      "  resolve  Resolve minified source locations",
    hideRoute: {},
  },
});
