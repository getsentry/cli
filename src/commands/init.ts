/**
 * sentry init
 *
 * Initialize Sentry in a project using the remote wizard workflow.
 * Communicates with the Mastra API via suspend/resume to perform
 * local filesystem operations and interactive prompts.
 *
 * Supports org/project positional syntax to pin org and/or project name:
 *   sentry init                    — auto-detect everything
 *   sentry init acme/              — explicit org, wizard picks project name
 *   sentry init acme/my-app        — explicit org + project name override
 *   sentry init --directory ./dir  — specify project directory
 */

import path from "node:path";
import type { SentryContext } from "../context.js";
import { parseOrgProjectArg } from "../lib/arg-parsing.js";
import { buildCommand } from "../lib/command.js";
import { ContextError } from "../lib/errors.js";
import { runWizard } from "../lib/init/wizard-runner.js";
import { validateResourceId } from "../lib/input-validation.js";

const FEATURE_DELIMITER = /[,+ ]+/;

type InitFlags = {
  readonly yes: boolean;
  readonly "dry-run": boolean;
  readonly features?: string[];
  readonly team?: string;
  readonly directory?: string;
};

export const initCommand = buildCommand<InitFlags, [string?], SentryContext>({
  docs: {
    brief: "Initialize Sentry in your project",
    fullDescription:
      "Runs the Sentry setup wizard to detect your project's framework, " +
      "install the SDK, and configure Sentry.\n\n" +
      "The target supports org/project syntax to specify context explicitly.\n" +
      "If omitted, the org is auto-detected from config defaults.\n\n" +
      "Examples:\n" +
      "  sentry init\n" +
      "  sentry init acme/\n" +
      "  sentry init acme/my-app\n" +
      "  sentry init acme/my-app --directory ./my-project\n" +
      "  sentry init --directory ./my-project",
  },
  parameters: {
    positional: {
      kind: "tuple",
      parameters: [
        {
          placeholder: "target",
          brief: "<org>/<project>, <org>/, or omit for auto-detect",
          parse: String,
          optional: true,
        },
      ],
    },
    flags: {
      yes: {
        kind: "boolean",
        brief: "Non-interactive mode (accept defaults)",
        default: false,
      },
      "dry-run": {
        kind: "boolean",
        brief: "Preview changes without applying them",
        default: false,
      },
      features: {
        kind: "parsed",
        parse: String,
        brief: "Features to enable: errors,tracing,logs,replay,metrics",
        variadic: true,
        optional: true,
      },
      team: {
        kind: "parsed",
        parse: String,
        brief: "Team slug to create the project under",
        optional: true,
      },
      directory: {
        kind: "parsed",
        parse: String,
        brief: "Project directory (default: current directory)",
        optional: true,
      },
    },
    aliases: {
      y: "yes",
      t: "team",
      d: "directory",
    },
  },
  async *func(this: SentryContext, flags: InitFlags, targetArg?: string) {
    const targetDir = flags.directory
      ? path.resolve(this.cwd, flags.directory)
      : this.cwd;

    const featuresList = flags.features
      ?.flatMap((f) => f.split(FEATURE_DELIMITER))
      .map((f) => f.trim())
      .filter(Boolean);

    // Parse the target arg to extract org and/or project
    const parsed = parseOrgProjectArg(targetArg);

    let explicitOrg: string | undefined;
    let explicitProject: string | undefined;

    switch (parsed.type) {
      case "explicit":
        explicitOrg = parsed.org;
        explicitProject = parsed.project;
        break;
      case "org-all":
        explicitOrg = parsed.org;
        break;
      case "project-search":
        // Bare string without "/" is ambiguous — could be an org or project slug.
        // Require the trailing slash to disambiguate (consistent with other commands).
        throw new ContextError("Target", `sentry init ${parsed.projectSlug}/`, [
          `'${parsed.projectSlug}' is ambiguous. Use '${parsed.projectSlug}/' for org or '${parsed.projectSlug}/<project>' for org + project.`,
        ]);
      case "auto-detect":
        // No target provided — auto-detect everything
        break;
      default: {
        const _exhaustive: never = parsed;
        throw new ContextError("Target", String(_exhaustive));
      }
    }

    // Validate explicit org slug format before passing to API calls
    if (explicitOrg) {
      validateResourceId(explicitOrg, "organization slug");
    }
    if (explicitProject) {
      validateResourceId(explicitProject, "project name");
    }

    await runWizard({
      directory: targetDir,
      yes: flags.yes,
      dryRun: flags["dry-run"],
      features: featuresList,
      team: flags.team,
      org: explicitOrg,
      project: explicitProject,
    });
  },
});
