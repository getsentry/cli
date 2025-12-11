import { buildRouteMap } from "@stricli/core";
import { detectCommand } from "./detect.js";

export const dsnRoute = buildRouteMap({
  routes: {
    detect: detectCommand,
  },
  docs: {
    brief: "Detect Sentry DSN in your project",
    fullDescription:
      "Scan your project files to find Sentry DSN configurations. " +
      "This helps identify which Sentry project your codebase is connected to.",
    hideRoute: {},
  },
});
