import { buildRouteMap } from "../../lib/route-map.js";
import { feedbackCommand } from "./feedback.js";
import { fixCommand } from "./fix.js";
import { setupCommand } from "./setup.js";
import { upgradeCommand } from "./upgrade.js";

export const cliRoute = buildRouteMap({
  routes: {
    feedback: feedbackCommand,
    fix: fixCommand,
    setup: setupCommand,
    upgrade: upgradeCommand,
  },
  docs: {
    brief: "CLI-related commands",
    fullDescription:
      "Commands for managing the Sentry CLI itself, including sending feedback, " +
      "upgrading to newer versions, and repairing the local database.",
  },
});
