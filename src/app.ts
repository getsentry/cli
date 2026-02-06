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
import { buildCommandRoute } from "./commands/build/index.js";
import { cliRoute } from "./commands/cli/index.js";
import { debugFilesRoute } from "./commands/debug-files/index.js";
import { deploysRoute } from "./commands/deploys/index.js";
import { eventRoute } from "./commands/event/index.js";
import { helpCommand } from "./commands/help.js";
import { initCommand } from "./commands/init.js";
import { issueRoute } from "./commands/issue/index.js";
import { logRoute } from "./commands/log/index.js";
import { monitorsRoute } from "./commands/monitors/index.js";
import { orgRoute } from "./commands/org/index.js";
import { projectRoute } from "./commands/project/index.js";
import { reactNativeRoute } from "./commands/react-native/index.js";
import { releasesRoute } from "./commands/releases/index.js";
import { reposRoute } from "./commands/repos/index.js";
import { sendEnvelopeCommand } from "./commands/send-envelope.js";
import { sendEventCommand } from "./commands/send-event.js";
import { sourcemapsRoute } from "./commands/sourcemaps/index.js";
import { CLI_VERSION } from "./lib/constants.js";
import { AuthError, CliError, getExitCode } from "./lib/errors.js";
import { error as errorColor } from "./lib/formatters/colors.js";

/** Top-level route map containing all CLI commands */
export const routes = buildRouteMap({
  routes: {
    help: helpCommand,
    init: initCommand,
    auth: authRoute,
    cli: cliRoute,
    org: orgRoute,
    project: projectRoute,
    issue: issueRoute,
    event: eventRoute,
    log: logRoute,
    api: apiCommand,
    releases: releasesRoute,
    sourcemaps: sourcemapsRoute,
    "debug-files": debugFilesRoute,
    deploys: deploysRoute,
    monitors: monitorsRoute,
    repos: reposRoute,
    build: buildCommandRoute,
    "react-native": reactNativeRoute,
    "send-event": sendEventCommand,
    "send-envelope": sendEnvelopeCommand,
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
  determineExitCode: getExitCode,
  localization: {
    loadText: () => customText,
  },
});
