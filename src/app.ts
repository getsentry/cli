import { buildApplication, buildRouteMap } from "@stricli/core";
import pkg from "../package.json";
import { apiCommand } from "./commands/api.js";
import { authRoute } from "./commands/auth/index.js";
import { eventRoute } from "./commands/event/index.js";
import { helpCommand } from "./commands/help.js";
import { issueRoute } from "./commands/issue/index.js";
import { orgRoute } from "./commands/org/index.js";
import { projectRoute } from "./commands/project/index.js";

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

declare const SENTRY_CLI_VERSION: string;

/** CLI version string, available for help output and other uses */
export const CLI_VERSION =
  typeof SENTRY_CLI_VERSION !== "undefined" ? SENTRY_CLI_VERSION : pkg.version;

export const app = buildApplication(routes, {
  name: "sentry",
  versionInfo: {
    currentVersion: CLI_VERSION,
  },
});
