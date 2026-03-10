/**
 * sentry init
 *
 * Initialize Sentry in a project using the remote wizard workflow.
 * Communicates with the Mastra API via suspend/resume to perform
 * local filesystem operations and interactive prompts.
 */

import path from "node:path";
import type { SentryContext } from "../context.js";
import { buildCommand } from "../lib/command.js";
import { runWizard } from "../lib/init/wizard-runner.js";

const FEATURE_DELIMITER = /[,+ ]+/;

type InitFlags = {
  readonly yes: boolean;
  readonly "dry-run": boolean;
  readonly features?: string[];
};

export const initCommand = buildCommand<InitFlags, [string?], SentryContext>({
  docs: {
    brief: "Initialize Sentry in your project",
    fullDescription:
      "Runs the Sentry setup wizard to detect your project's framework, " +
      "install the SDK, and configure Sentry.",
  },
  parameters: {
    positional: {
      kind: "tuple",
      parameters: [
        {
          placeholder: "directory",
          brief: "Project directory (default: current directory)",
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
    },
    aliases: {
      y: "yes",
      feature: "features",
    },
  },
  async func(this: SentryContext, flags: InitFlags, directory?: string) {
    const targetDir = directory ? path.resolve(this.cwd, directory) : this.cwd;
    const featuresList = flags.features
      ?.flatMap((f) => f.split(FEATURE_DELIMITER))
      .map((f) => f.trim())
      .filter(Boolean);

    await runWizard({
      directory: targetDir,
      yes: flags.yes,
      dryRun: flags["dry-run"],
      features: featuresList,
    });
  },
});
