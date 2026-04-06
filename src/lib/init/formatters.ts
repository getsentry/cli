/**
 * Output Formatters
 *
 * Format wizard results and errors for terminal display using clack.
 */

import { cancel, log, outro } from "@clack/prompts";
import { terminalLink } from "../formatters/colors.js";
import { colorTag, mdKvTable, renderMarkdown } from "../formatters/markdown.js";
import { featureLabel } from "./clack-utils.js";
import {
  EXIT_DEPENDENCY_INSTALL_FAILED,
  EXIT_PLATFORM_NOT_DETECTED,
  EXIT_VERIFICATION_FAILED,
} from "./constants.js";
import type { WizardOutput, WorkflowRunResult } from "./types.js";

function fileActionIcon(action: string): string {
  if (action === "create") {
    return colorTag("green", "+");
  }
  if (action === "delete") {
    return colorTag("red", "-");
  }
  return colorTag("yellow", "~");
}

function buildSummary(output: WizardOutput): string {
  const sections: string[] = [];

  const kvRows: [string, string][] = [];
  if (output.platform) {
    kvRows.push(["Platform", output.platform]);
  }
  if (output.projectDir) {
    kvRows.push(["Directory", output.projectDir]);
  }
  if (output.features?.length) {
    kvRows.push(["Features", output.features.map(featureLabel).join(", ")]);
  }
  if (output.commands?.length) {
    kvRows.push(["Commands", output.commands.join("; ")]);
  }
  if (output.sentryProjectUrl) {
    kvRows.push(["Project", output.sentryProjectUrl]);
  }
  if (output.docsUrl) {
    kvRows.push(["Docs", output.docsUrl]);
  }

  if (kvRows.length > 0) {
    sections.push(mdKvTable(kvRows));
  }

  const changedFiles = output.changedFiles;
  if (changedFiles?.length) {
    sections.push(
      "### Changed files\n\n" +
        changedFiles
          .map((f) => `- ${fileActionIcon(f.action)} ${f.path}`)
          .join("\n")
    );
  }

  return sections.join("\n\n");
}

export function formatResult(result: WorkflowRunResult): void {
  const output: WizardOutput = result.result ?? {};
  const md = buildSummary(output);

  if (md.length > 0) {
    log.message(renderMarkdown(md));
  }

  if (output.warnings?.length) {
    for (const w of output.warnings) {
      log.warn(w);
    }
  }

  log.info("Please review the changes above before committing.");
  log.info(
    "You're one of the first to try the new setup wizard! Run `sentry cli feedback` to let us know how it went."
  );

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
