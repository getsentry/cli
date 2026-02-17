/**
 * Output Formatters
 *
 * Format wizard progress, results, and errors for terminal display.
 */

import type { Writer } from "../../types/index.js";

const STEP_LABELS: Record<string, string> = {
  "discover-context": "Analyzing project structure",
  "select-target-app": "Selecting target application",
  "resolve-dir": "Resolving project directory",
  "check-existing-sentry": "Checking for existing Sentry installation",
  "detect-platform": "Detecting platform and framework",
  "ensure-sentry-project": "Setting up Sentry project",
  "select-features": "Selecting features",
  "determine-pm": "Detecting package manager",
  "install-deps": "Installing dependencies",
  "plan-codemods": "Planning code modifications",
  "apply-codemods": "Applying code modifications",
  "verify-changes": "Verifying changes",
  "add-example-trigger": "Example error trigger",
  "open-sentry-ui": "Finishing up",
};

export function formatProgress(
  stdout: Writer,
  stepId: string,
  payload?: unknown,
): void {
  const label = STEP_LABELS[stepId] ?? stepId;
  const payloadType = (payload as any)?.type as string | undefined;
  const operation = (payload as any)?.operation as string | undefined;

  let detail = "";
  if (payloadType === "local-op" && operation) {
    detail = ` (${operation})`;
  }

  stdout.write(`> ${label}${detail}...\n`);
}

export function formatResult(
  stdout: Writer,
  result: Record<string, any>,
): void {
  const output = result.result ?? result;

  stdout.write("\nSentry SDK installed successfully!\n\n");

  if (output.platform) {
    stdout.write(`  Platform:    ${output.platform}\n`);
  }
  if (output.projectDir) {
    stdout.write(`  Directory:   ${output.projectDir}\n`);
  }
  if (output.features?.length) {
    stdout.write(`  Features:    ${output.features.join(", ")}\n`);
  }
  if (output.commands?.length) {
    stdout.write(`  Commands:    ${output.commands.join("; ")}\n`);
  }
  if (output.sentryProjectUrl) {
    stdout.write(`  Project:     ${output.sentryProjectUrl}\n`);
  }
  if (output.docsUrl) {
    stdout.write(`  Docs:        ${output.docsUrl}\n`);
  }

  if (output.changedFiles?.length) {
    stdout.write("\n  Changed files:\n");
    for (const f of output.changedFiles) {
      const icon = f.action === "create" ? "+" : f.action === "delete" ? "-" : "~";
      stdout.write(`    ${icon} ${f.path}\n`);
    }
  }

  if (output.warnings?.length) {
    stdout.write("\n  Warnings:\n");
    for (const w of output.warnings) {
      stdout.write(`    ! ${w}\n`);
    }
  }

  stdout.write("\n");
}

export function formatError(
  stderr: Writer,
  result: Record<string, any>,
): void {
  const message =
    result.error ?? result.result?.message ?? "Wizard failed with an unknown error";
  const exitCode = result.result?.exitCode ?? 1;

  stderr.write(`\nError: ${message}\n`);

  // Provide actionable suggestions based on exit code
  if (exitCode === 10) {
    stderr.write("  Hint: Use --force to override existing Sentry installation.\n");
  } else if (exitCode === 20) {
    stderr.write("  Hint: Could not detect your project's platform. Check that the directory contains a valid project.\n");
  } else if (exitCode === 30) {
    const commands = result.result?.commands as string[] | undefined;
    if (commands?.length) {
      stderr.write("  You can install dependencies manually:\n");
      for (const cmd of commands) {
        stderr.write(`    $ ${cmd}\n`);
      }
    }
  } else if (exitCode === 50) {
    stderr.write("  Hint: Fix the verification issues and run 'sentry init' again.\n");
  }

  if (result.result?.docsUrl) {
    stderr.write(`  Docs: ${result.result.docsUrl}\n`);
  }

  stderr.write("\n");
}
