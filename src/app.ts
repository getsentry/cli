// biome-ignore lint/performance/noNamespaceImport: Sentry SDK recommends namespace import
import * as Sentry from "@sentry/bun";
import {
  type ApplicationText,
  buildApplication,
  buildRouteMap,
  text_en,
} from "@stricli/core";
import { apiCommand } from "./commands/api.js";
import { authRoute } from "./commands/auth/index.js";
import { cliRoute } from "./commands/cli/index.js";
import { eventRoute } from "./commands/event/index.js";
import { helpCommand } from "./commands/help.js";
import { issueRoute } from "./commands/issue/index.js";
import { listCommand as issueListCommand } from "./commands/issue/list.js";
import { logRoute } from "./commands/log/index.js";
import { listCommand as logListCommand } from "./commands/log/list.js";
import { orgRoute } from "./commands/org/index.js";
import { listCommand as orgListCommand } from "./commands/org/list.js";
import { projectRoute } from "./commands/project/index.js";
import { listCommand as projectListCommand } from "./commands/project/list.js";
import { repoRoute } from "./commands/repo/index.js";
import { listCommand as repoListCommand } from "./commands/repo/list.js";
import { teamRoute } from "./commands/team/index.js";
import { listCommand as teamListCommand } from "./commands/team/list.js";
import { traceRoute } from "./commands/trace/index.js";
import { listCommand as traceListCommand } from "./commands/trace/list.js";
import { CLI_VERSION } from "./lib/constants.js";
import { AuthError, CliError, getExitCode } from "./lib/errors.js";
import { error as errorColor } from "./lib/formatters/colors.js";

/** Top-level route map containing all CLI commands */
export const routes = buildRouteMap({
  routes: {
    help: helpCommand,
    auth: authRoute,
    cli: cliRoute,
    org: orgRoute,
    project: projectRoute,
    repo: repoRoute,
    team: teamRoute,
    issue: issueRoute,
    event: eventRoute,
    log: logRoute,
    trace: traceRoute,
    api: apiCommand,
    issues: issueListCommand,
    orgs: orgListCommand,
    projects: projectListCommand,
    repos: repoListCommand,
    teams: teamListCommand,
    logs: logListCommand,
    traces: traceListCommand,
  },
  defaultCommand: "help",
  docs: {
    brief: "A gh-like CLI for Sentry",
    fullDescription:
      "sentry is a command-line interface for interacting with Sentry. " +
      "It provides commands for authentication, viewing issues, and making API calls.",
  },
});

/**
 * Custom error formatting for CLI errors.
 *
 * - AuthError (not_authenticated): Re-thrown to allow auto-login flow in bin.ts
 * - Other CliError subclasses: Show clean user-friendly message without stack trace
 * - Other errors: Show stack trace for debugging unexpected issues
 */
const customText: ApplicationText = {
  ...text_en,
  exceptionWhileRunningCommand: (exc: unknown, ansiColor: boolean): string => {
    // Re-throw AuthError("not_authenticated") for auto-login flow in bin.ts
    // Don't capture to Sentry - it's an expected state (user not logged in), not an error
    if (exc instanceof AuthError && exc.reason === "not_authenticated") {
      throw exc;
    }

    // Report command errors to Sentry. Stricli catches exceptions and doesn't
    // re-throw, so we must capture here to get visibility into command failures.
    Sentry.captureException(exc);

    if (exc instanceof CliError) {
      const prefix = ansiColor ? errorColor("Error:") : "Error:";
      return `${prefix} ${exc.format()}`;
    }
    if (exc instanceof Error) {
      return `Unexpected error: ${exc.stack ?? exc.message}`;
    }
    return `Unexpected error: ${String(exc)}`;
  },
};

export const app = buildApplication(routes, {
  name: "sentry",
  versionInfo: {
    currentVersion: CLI_VERSION,
  },
  scanner: {
    caseStyle: "allow-kebab-for-camel",
  },
  determineExitCode: getExitCode,
  localization: {
    loadText: () => customText,
  },
});
