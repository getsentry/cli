/**
 * Output Formatters
 *
 * Format wizard results and errors for terminal display using clack.
 */

import { cancel, log, note, outro } from "@clack/prompts";
import { terminalLink } from "../formatters/colors.js";
import { featureLabel } from "./clack-utils.js";
import {
  EXIT_DEPENDENCY_INSTALL_FAILED,
  EXIT_PLATFORM_NOT_DETECTED,
  EXIT_VERIFICATION_FAILED,
} from "./constants.js";
import type { WizardOutput, WorkflowRunResult } from "./types.js";

function fileActionIcon(action: string): string {
  if (action === "create") {
    return "+";
  }
  if (action === "delete") {
    return "-";
  }
  return "~";
}

function buildSummaryLines(output: WizardOutput): string[] {
  const lines: string[] = [];

  if (output.platform) {
    lines.push(`Platform:    ${output.platform}`);
  }
  if (output.projectDir) {
    lines.push(`Directory:   ${output.projectDir}`);
  }

  if (output.features?.length) {
    lines.push(`Features:    ${output.features.map(featureLabel).join(", ")}`);
  }

  if (output.commands?.length) {
    lines.push(`Commands:    ${output.commands.join("; ")}`);
  }
  if (output.sentryProjectUrl) {
    lines.push(`Project:     ${terminalLink(output.sentryProjectUrl)}`);
  }
  if (output.docsUrl) {
    lines.push(`Docs:        ${terminalLink(output.docsUrl)}`);
  }

  const changedFiles = output.changedFiles;
  if (changedFiles?.length) {
    lines.push("");
    lines.push("Changed files:");
    for (const f of changedFiles) {
      lines.push(`  ${fileActionIcon(f.action)} ${f.path}`);
    }
  }

  return lines;
}

export function formatResult(result: WorkflowRunResult): void {
  const output: WizardOutput = result.result ?? {};
  const lines = buildSummaryLines(output);

  if (lines.length > 0) {
    note(lines.join("\n"), "Setup complete");
  }

  if (output.warnings?.length) {
    for (const w of output.warnings) {
      log.warn(w);
    }
  }

  log.info("Please review the changes above before committing.");

  outro("Sentry SDK installed successfully!");
}

export function formatError(result: WorkflowRunResult): void {
  const inner = result.result;
  const message =
    result.error ?? inner?.message ?? "Wizard failed with an unknown error";
  const exitCode = inner?.exitCode ?? 1;

  log.error(String(message));

  if (exitCode === EXIT_PLATFORM_NOT_DETECTED) {
    log.warn(
      "Hint: Could not detect your project's platform. Check that the directory contains a valid project."
    );
  } else if (exitCode === EXIT_DEPENDENCY_INSTALL_FAILED) {
    const commands = inner?.commands;
    if (commands?.length) {
      log.warn(
        `You can install dependencies manually:\n${commands.map((cmd) => `  $ ${cmd}`).join("\n")}`
      );
    }
  } else if (exitCode === EXIT_VERIFICATION_FAILED) {
    log.warn("Hint: Fix the verification issues and run 'sentry init' again.");
  }

  const docsUrl = inner?.docsUrl;
  if (docsUrl) {
    log.info(`Docs: ${terminalLink(docsUrl)}`);
  }

  cancel("Setup failed");
}
