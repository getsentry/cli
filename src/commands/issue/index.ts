import { buildRouteMap } from "../../lib/route-map.js";
import { eventsCommand } from "./events.js";
import { explainCommand } from "./explain.js";
import { listCommand } from "./list.js";
import { planCommand } from "./plan.js";
import { viewCommand } from "./view.js";

export const issueRoute = buildRouteMap({
  routes: {
    list: listCommand,
    events: eventsCommand,
    explain: explainCommand,
    plan: planCommand,
    view: viewCommand,
  },
  defaultCommand: "view",
  docs: {
    brief: "Manage Sentry issues",
    fullDescription:
      "View and manage issues from your Sentry projects.\n\n" +
      "Commands:\n" +
      "  list     List issues in a project\n" +
      "  events   List events for a specific issue\n" +
      "  view     View details of a specific issue\n" +
      "  explain  Analyze an issue using Seer AI\n" +
      "  plan     Generate a solution plan using Seer AI\n\n" +
      "Magic selectors (available for view, events, explain, plan):\n" +
      "  @latest          Most recent unresolved issue\n" +
      "  @most_frequent   Issue with the highest event frequency\n\n" +
      "Examples:\n" +
      "  sentry issue view @latest\n" +
      "  sentry issue events CLI-G\n" +
      "  sentry issue explain @most_frequent\n" +
      "  sentry issue plan my-org/@latest\n\n" +
      "Alias: `sentry issues` → `sentry issue list`",
    hideRoute: {},
  },
});
