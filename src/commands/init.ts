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

type InitFlags = {
  readonly force: boolean;
  readonly yes: boolean;
  readonly "dry-run": boolean;
  readonly features?: string;
};

export const initCommand = buildCommand<InitFlags, [string?], SentryContext>({
  docs: {
    brief: "Initialize Sentry in your project",
    fullDescription:
      "Runs the Sentry setup wizard to detect your project's framework, " +
      "install the SDK, and configure error monitoring. Uses a remote " +
      "workflow that coordinates local file operations through the CLI.",
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
      force: {
        kind: "boolean",
        brief: "Continue even if Sentry is already installed",
        default: false,
      },
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
        brief: "Comma-separated features: errors,tracing,logs,replay,metrics",
        optional: true,
        placeholder: "list",
      },
    },
    aliases: {
      y: "yes",
    },
  },
  async func(this: SentryContext, flags: InitFlags, directory?: string) {
    const targetDir = directory
      ? path.resolve(this.cwd, directory)
      : this.cwd;
    const featuresList = flags.features
      ?.split(",")
      .map((f) => f.trim())
      .filter(Boolean);

    await runWizard({
      directory: targetDir,
      force: flags.force,
      yes: flags.yes,
      dryRun: flags["dry-run"],
      features: featuresList,
      stdout: this.stdout,
      stderr: this.stderr,
      stdin: this.stdin,
    });
  },
});
