import { buildRouteMap } from "@stricli/core";
import { feedbackCommand } from "./feedback.js";
import { upgradeCommand } from "./upgrade.js";

export const cliRoute = buildRouteMap({
  routes: {
    feedback: feedbackCommand,
    upgrade: upgradeCommand,
  },
  docs: {
    brief: "CLI-related commands",
    fullDescription:
      "Commands for managing the Sentry CLI itself, including sending feedback " +
      "and upgrading to newer versions.",
  },
});
