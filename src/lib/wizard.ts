/**
 * Sentry Wizard Integration
 *
 * Wraps @sentry/wizard for project initialization.
 * This abstraction allows future migration to a native implementation
 * without changing the public interface.
 */

import { spawn } from "node:child_process";

/**
 * Options for running the Sentry Wizard.
 * These map to our CLI's interface, not the wizard's flags directly.
 */
export type WizardOptions = {
  /** Platform/framework to setup (nextjs, reactNative, flutter, etc.) */
  integration?: string;
  /** Sentry organization slug */
  org?: string;
  /** Sentry project slug */
  project?: string;
  /** Sentry URL (for self-hosted installations) */
  url?: string;
  /** Enable verbose logging */
  debug?: boolean;
  /** Revert project setup */
  uninstall?: boolean;
  /** Non-interactive mode - don't prompt for input */
  quiet?: boolean;
  /** Skip connecting to Sentry server */
  skipConnect?: boolean;
  /** Skip self-hosted/SaaS selection prompt */
  saas?: boolean;
  /** Redirect to signup if not logged in */
  signup?: boolean;
  /** Don't send telemetry data to Sentry */
  disableTelemetry?: boolean;
};

/**
 * Map our options to wizard CLI arguments.
 * This is an internal implementation detail - the public interface is WizardOptions.
 */
function buildWizardArgs(options: WizardOptions): string[] {
  const args: string[] = [];

  if (options.integration) {
    args.push("-i", options.integration);
  }
  if (options.org) {
    args.push("--org", options.org);
  }
  if (options.project) {
    args.push("--project", options.project);
  }
  if (options.url) {
    args.push("-u", options.url);
  }
  if (options.debug) {
    args.push("--debug");
  }
  if (options.uninstall) {
    args.push("--uninstall");
  }
  if (options.quiet) {
    args.push("--quiet");
  }
  if (options.skipConnect) {
    args.push("--skip-connect");
  }
  if (options.saas) {
    args.push("--saas");
  }
  if (options.signup) {
    args.push("-s");
  }
  if (options.disableTelemetry) {
    args.push("--disable-telemetry");
  }

  return args;
}

/**
 * Run the Sentry Wizard to initialize a project.
 *
 * Spawns `npx @sentry/wizard@latest` with the provided options.
 * Uses stdio: "inherit" for the interactive terminal UI.
 *
 * @param options - Wizard configuration options
 * @throws Error if npx is not found or wizard exits with non-zero code
 */
export function runWizard(options: WizardOptions): Promise<void> {
  return new Promise((resolve, reject) => {
    const npx = Bun.which("npx");
    if (!npx) {
      reject(
        new Error(
          "npx not found. Please install Node.js/npm to use the init command."
        )
      );
      return;
    }

    const args = buildWizardArgs(options);

    const proc = spawn(npx, ["@sentry/wizard@latest", ...args], {
      stdio: "inherit",
      env: process.env,
    });

    proc.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Wizard exited with code ${code}`));
      }
    });

    proc.on("error", (err) => {
      reject(new Error(`Failed to start wizard: ${err.message}`));
    });
  });
}

/**
 * Build wizard args from options (exported for testing).
 */
export { buildWizardArgs as _buildWizardArgs };
