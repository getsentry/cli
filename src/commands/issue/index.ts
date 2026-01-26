import { buildRouteMap } from "@stricli/core";
import { explainCommand } from "./explain.js";
import { listCommand } from "./list.js";
import { planCommand } from "./plan.js";
import { viewCommand } from "./view.js";

export const issueRoute = buildRouteMap({
  routes: {
    list: listCommand,
    explain: explainCommand,
    plan: planCommand,
    view: viewCommand,
  },
  docs: {
    brief: "Manage Sentry issues",
    fullDescription:
      "View and manage issues from your Sentry projects.\n\n" +
      "Commands:\n" +
      "  list     List issues in a project\n" +
      "  view     View details of a specific issue\n" +
      "  explain  Analyze an issue using Seer AI\n" +
      "  plan     Generate a solution plan using Seer AI",
    hideRoute: {},
  },
});
