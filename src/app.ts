// biome-ignore lint/performance/noNamespaceImport: Sentry SDK recommends namespace import
import * as Sentry from "@sentry/bun";
import {
  type ApplicationText,
  buildApplication,
  buildRouteMap,
  text_en,
  UnexpectedPositionalError,
} from "@stricli/core";
import { apiCommand } from "./commands/api.js";
import { authRoute } from "./commands/auth/index.js";
import { whoamiCommand } from "./commands/auth/whoami.js";
import { cliRoute } from "./commands/cli/index.js";
import { dashboardRoute } from "./commands/dashboard/index.js";
import { listCommand as dashboardListCommand } from "./commands/dashboard/list.js";
import { eventRoute } from "./commands/event/index.js";
import { helpCommand } from "./commands/help.js";
import { initCommand } from "./commands/init.js";
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
import { schemaCommand } from "./commands/schema.js";
import { spanRoute } from "./commands/span/index.js";
import { listCommand as spanListCommand } from "./commands/span/list.js";
import { teamRoute } from "./commands/team/index.js";
import { listCommand as teamListCommand } from "./commands/team/list.js";
import { traceRoute } from "./commands/trace/index.js";
import { listCommand as traceListCommand } from "./commands/trace/list.js";
import { trialRoute } from "./commands/trial/index.js";
import { listCommand as trialListCommand } from "./commands/trial/list.js";
import { CLI_VERSION } from "./lib/constants.js";
import {
  AuthError,
  CliError,
  getExitCode,
  stringifyUnknown,
} from "./lib/errors.js";
import { error as errorColor, warning } from "./lib/formatters/colors.js";

/**
 * Plural alias → singular route name mapping.
 * Used to suggest the correct command when users type e.g. `sentry projects view cli`.
 */
const PLURAL_TO_SINGULAR: Record<string, string> = {
  dashboards: "dashboard",
  issues: "issue",
  orgs: "org",
  projects: "project",
  repos: "repo",
  teams: "team",
  logs: "log",
  spans: "span",
  traces: "trace",
  trials: "trial",
};

/** Top-level route map containing all CLI commands */
export const routes = buildRouteMap({
  routes: {
    help: helpCommand,
    auth: authRoute,
    cli: cliRoute,
    dashboard: dashboardRoute,
    org: orgRoute,
    project: projectRoute,
    repo: repoRoute,
    team: teamRoute,
    issue: issueRoute,
    event: eventRoute,
    log: logRoute,
    span: spanRoute,
    trace: traceRoute,
    trial: trialRoute,
    init: initCommand,
    api: apiCommand,
    schema: schemaCommand,
    dashboards: dashboardListCommand,
    issues: issueListCommand,
    orgs: orgListCommand,
    projects: projectListCommand,
    repos: repoListCommand,
    teams: teamListCommand,
    logs: logListCommand,
    spans: spanListCommand,
    traces: traceListCommand,
    trials: trialListCommand,
    whoami: whoamiCommand,
  },
  defaultCommand: "help",
  docs: {
    brief: "A gh-like CLI for Sentry",
    fullDescription:
      "sentry is a command-line interface for interacting with Sentry. " +
      "It provides commands for authentication, viewing issues, and making API calls.",
    hideRoute: {
      dashboards: true,
      issues: true,
      orgs: true,
      projects: true,
      repos: true,
      teams: true,
      logs: true,
      spans: true,
      traces: true,
      trials: true,
      whoami: true,
    },
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
  exceptionWhileParsingArguments: (
    exc: unknown,
    ansiColor: boolean
  ): string => {
    // When a plural alias receives extra positional args (e.g. `sentry projects view cli`),
    // Stricli throws UnexpectedPositionalError because the list command only accepts 1 arg.
    // Detect this and suggest the singular form.
    if (exc instanceof UnexpectedPositionalError) {
      const args = process.argv.slice(2);
      const firstArg = args[0];
      if (firstArg && firstArg in PLURAL_TO_SINGULAR) {
        const singular = PLURAL_TO_SINGULAR[firstArg];
        const rest = args.slice(1).join(" ");
        const hint = ansiColor
          ? warning(`\nDid you mean: sentry ${singular} ${rest}\n`)
          : `\nDid you mean: sentry ${singular} ${rest}\n`;
        return `${text_en.exceptionWhileParsingArguments(exc, ansiColor)}${hint}`;
      }
    }
    return text_en.exceptionWhileParsingArguments(exc, ansiColor);
  },
  exceptionWhileRunningCommand: (exc: unknown, ansiColor: boolean): string => {
    // Re-throw AuthError for auto-login flow in bin.ts
    // Don't capture to Sentry - it's an expected state (user not logged in or token expired), not an error
    // Note: skipAutoAuth is checked in bin.ts, not here — all auth errors must escape Sentry capture
    if (
      exc instanceof AuthError &&
      (exc.reason === "not_authenticated" || exc.reason === "expired")
    ) {
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
    return `Unexpected error: ${stringifyUnknown(exc)}`;
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
