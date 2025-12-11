import { buildApplication, buildRouteMap } from "@stricli/core";
import { authRoute } from "./commands/auth/index.js";
import { orgRoute } from "./commands/org/index.js";
import { projectRoute } from "./commands/project/index.js";
import { issueRoute } from "./commands/issue/index.js";
import { apiCommand } from "./commands/api.js";
import { dsnRoute } from "./commands/dsn/index.js";

const routes = buildRouteMap({
  routes: {
    auth: authRoute,
    org: orgRoute,
    project: projectRoute,
    issue: issueRoute,
    api: apiCommand,
    dsn: dsnRoute,
  },
  docs: {
    brief: "A gh-like CLI for Sentry",
    fullDescription:
      "sry is a command-line interface for interacting with Sentry. " +
      "It provides commands for authentication, viewing issues, and making API calls.",
    hideRoute: {},
  },
});

export const app = buildApplication(routes, {
  name: "sry",
  versionInfo: {
    currentVersion: "0.1.0",
  },
});

