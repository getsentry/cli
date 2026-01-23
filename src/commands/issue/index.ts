import { buildRouteMap } from "@stricli/core";
import { explainCommand } from "./explain.js";
import { getCommand } from "./get.js";
import { listCommand } from "./list.js";
import { planCommand } from "./plan.js";

export const issueRoute = buildRouteMap({
  routes: {
    list: listCommand,
    get: getCommand,
    explain: explainCommand,
    plan: planCommand,
  },
  docs: {
    brief: "Manage Sentry issues",
    fullDescription:
      "View and manage issues from your Sentry projects.\n\n" +
      "Commands:\n" +
      "  list     List issues in a project\n" +
      "  get      Get details of a specific issue\n" +
      "  explain  Analyze an issue using Seer AI\n" +
      "  plan     Generate a solution plan using Seer AI",
    hideRoute: {},
  },
});
