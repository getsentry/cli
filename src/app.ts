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
import { eventRoute } from "./commands/event/index.js";
import { feedbackCommand } from "./commands/feedback.js";
import { helpCommand } from "./commands/help.js";
import { issueRoute } from "./commands/issue/index.js";
import { orgRoute } from "./commands/org/index.js";
import { projectRoute } from "./commands/project/index.js";
import { CLI_VERSION } from "./lib/constants.js";
import { CliError, getExitCode } from "./lib/errors.js";
import { error as errorColor } from "./lib/formatters/colors.js";

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
    feedback: feedbackCommand,
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
 * - CliError subclasses: Show clean user-friendly message without stack trace
 * - Other errors: Show stack trace for debugging unexpected issues
 */
const customText: ApplicationText = {
  ...text_en,
  exceptionWhileRunningCommand: (exc: unknown, ansiColor: boolean): string => {
    // Report all command errors to Sentry. Stricli catches exceptions and doesn't
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
  determineExitCode: getExitCode,
  localization: {
    loadText: () => customText,
  },
});
