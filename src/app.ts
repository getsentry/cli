import { buildApplication, buildRouteMap } from "@stricli/core";
import { apiCommand } from "./commands/api.js";
import { authRoute } from "./commands/auth/index.js";
import { eventRoute } from "./commands/event/index.js";
import { helpCommand } from "./commands/help.js";
import { issueRoute } from "./commands/issue/index.js";
import { orgRoute } from "./commands/org/index.js";
import { projectRoute } from "./commands/project/index.js";

import { CLI_VERSION } from "./lib/constants.js";

/** Top-level route map containing all CLI commands */
export const routes = buildRouteMap({
  routes: {
    help: helpCommand,
    auth: authRoute,
    org: orgRoute,
    project: projectRoute,
    issue: issueRoute,
    event: eventRoute,
    api: apiCommand,
  },
  defaultCommand: "help",
  docs: {
    brief: "A gh-like CLI for Sentry",
    fullDescription:
      "sentry is a command-line interface for interacting with Sentry. " +
      "It provides commands for authentication, viewing issues, and making API calls.",
  },
});

export const app = buildApplication(routes, {
  name: "sentry",
  versionInfo: {
    currentVersion: CLI_VERSION,
  },
});
