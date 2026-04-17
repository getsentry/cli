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

type ChangedFile = NonNullable<WizardOutput["changedFiles"]>[number];

type FileTreeNode = {
  name: string;
  path?: string;
  action?: string;
  children: Map<string, FileTreeNode>;
};

function fileActionIcon(action: string): string {
  if (action === "create") {
    return colorTag("green", "+");
  }
  if (action === "delete") {
    return colorTag("red", "-");
  }
  return colorTag("yellow", "\\~");
}

function createFileTreeNode(name: string): FileTreeNode {
  return { name, children: new Map<string, FileTreeNode>() };
}

function splitChangedFilePath(filePath: string): string[] {
  return filePath
    .replaceAll("\\", "/")
    .split("/")
    .filter((segment) => segment.length > 0);
}

function buildChangedFilesTree(changedFiles: ChangedFile[]): FileTreeNode {
  const root = createFileTreeNode("");

  for (const file of changedFiles) {
    const parts = splitChangedFilePath(file.path);
    let current = root;

    for (const [index, part] of parts.entries()) {
      let child = current.children.get(part);
      if (!child) {
        child = createFileTreeNode(part);
        current.children.set(part, child);
      }

      if (index === parts.length - 1) {
        child.path = file.path;
        child.action = file.action;
      }

      current = child;
    }
  }

  return root;
}

function sortTreeEntries(entries: FileTreeNode[]): FileTreeNode[] {
  return [...entries].sort((left, right) => {
    const leftIsDir = left.children.size > 0 && !left.action;
    const rightIsDir = right.children.size > 0 && !right.action;

    if (leftIsDir !== rightIsDir) {
      return leftIsDir ? -1 : 1;
    }

    return left.name.localeCompare(right.name);
  });
}

function renderChangedFileNode(
  node: FileTreeNode,
  prefix: string,
  isLast: boolean
): string[] {
  const lines: string[] = [];
  const label = node.action ? node.name : `${node.name}/`;
  const branch = isLast ? "└─" : "├─";

  if (node.action) {
    lines.push(`${prefix}${branch} ${fileActionIcon(node.action)} ${label}`);
  } else {
    lines.push(`${prefix}${branch} ${label}`);
  }

  const children = sortTreeEntries([...node.children.values()]);
  const childPrefix = `${prefix}${isLast ? "   " : "│  "}`;
  for (const [index, child] of children.entries()) {
    lines.push(
      ...renderChangedFileNode(child, childPrefix, index === children.length - 1)
    );
  }

  return lines;
}

function formatChangedFilesTree(changedFiles: ChangedFile[]): string {
  const root = buildChangedFilesTree(changedFiles);
  const entries = sortTreeEntries([...root.children.values()]);

  return entries
    .flatMap((entry, index) =>
      renderChangedFileNode(entry, "", index === entries.length - 1)
    )
    .join("\n");
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
    sections.push(`Changed files\n${formatChangedFilesTree(changedFiles)}`);
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
