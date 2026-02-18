/**
 * Output Formatters
 *
 * Format wizard results and errors for terminal display using clack.
 */

import { cancel, log, note, outro } from "@clack/prompts";
import { featureLabel } from "./clack-utils.js";

type WizardOutput = Record<string, unknown>;

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

  const features = output.features as string[] | undefined;
  if (features?.length) {
    lines.push(`Features:    ${features.map(featureLabel).join(", ")}`);
  }

  const commands = output.commands as string[] | undefined;
  if (commands?.length) {
    lines.push(`Commands:    ${commands.join("; ")}`);
  }
  if (output.sentryProjectUrl) {
    lines.push(`Project:     ${output.sentryProjectUrl}`);
  }
  if (output.docsUrl) {
    lines.push(`Docs:        ${output.docsUrl}`);
  }

  const changedFiles = output.changedFiles as
    | Array<{ action: string; path: string }>
    | undefined;
  if (changedFiles?.length) {
    lines.push("");
    lines.push("Changed files:");
    for (const f of changedFiles) {
      lines.push(`  ${fileActionIcon(f.action)} ${f.path}`);
    }
  }

  return lines;
}

export function formatResult(result: WizardOutput): void {
  const output = (result.result as WizardOutput) ?? result;
  const lines = buildSummaryLines(output);

  if (lines.length > 0) {
    note(lines.join("\n"), "Setup complete");
  }

  const warnings = output.warnings as string[] | undefined;
  if (warnings?.length) {
    for (const w of warnings) {
      log.warn(w);
    }
  }

  log.info("Please review the changes above before committing.");

  outro("Sentry SDK installed successfully!");
}

export function formatError(result: WizardOutput): void {
  const inner = result.result as WizardOutput | undefined;
  const message =
    result.error ?? inner?.message ?? "Wizard failed with an unknown error";
  const exitCode = (inner?.exitCode as number) ?? 1;

  log.error(String(message));

  if (exitCode === 10) {
    log.warn("Hint: Use --force to override existing Sentry installation.");
  } else if (exitCode === 20) {
    log.warn(
      "Hint: Could not detect your project's platform. Check that the directory contains a valid project."
    );
  } else if (exitCode === 30) {
    const commands = inner?.commands as string[] | undefined;
    if (commands?.length) {
      log.warn(
        `You can install dependencies manually:\n${commands.map((cmd) => `  $ ${cmd}`).join("\n")}`
      );
    }
  } else if (exitCode === 50) {
    log.warn("Hint: Fix the verification issues and run 'sentry init' again.");
  }

  const docsUrl = inner?.docsUrl;
  if (docsUrl) {
    log.info(`Docs: ${docsUrl}`);
  }

  cancel("Setup failed");
}
