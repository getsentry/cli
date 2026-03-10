/**
 * Git Safety Checks
 *
 * Pre-flight checks to verify the user is in a git repo with a clean
 * working tree before the init wizard starts modifying files.
 */

import { execFileSync } from "node:child_process";
import { confirm, isCancel, log } from "@clack/prompts";

export function isInsideGitWorkTree(opts: { cwd: string }): boolean {
  try {
    execFileSync("git", ["rev-parse", "--is-inside-work-tree"], {
      stdio: "ignore",
      cwd: opts.cwd,
    });
    return true;
  } catch {
    return false;
  }
}

export function getUncommittedOrUntrackedFiles(opts: {
  cwd: string;
}): string[] {
  try {
    const output = execFileSync("git", ["status", "--porcelain=v1"], {
      stdio: ["ignore", "pipe", "ignore"],
      cwd: opts.cwd,
    });
    return output
      .toString()
      .trim()
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => `- ${line.trim()}`);
  } catch {
    return [];
  }
}

/**
 * Checks git status and prompts the user if there are concerns.
 * Returns `true` to continue, `false` to abort.
 */
export async function checkGitStatus(opts: {
  cwd: string;
  yes: boolean;
}): Promise<boolean> {
  const { cwd, yes } = opts;

  if (!isInsideGitWorkTree({ cwd })) {
    if (yes) {
      log.warn(
        "You are not inside a git repository. Unable to revert changes if something goes wrong."
      );
      return true;
    }
    const proceed = await confirm({
      message:
        "You are not inside a git repository. Unable to revert changes if something goes wrong. Continue?",
    });
    if (isCancel(proceed)) {
      return false;
    }
    return !!proceed;
  }

  const uncommitted = getUncommittedOrUntrackedFiles({ cwd });
  if (uncommitted.length > 0) {
    const fileList = uncommitted.join("\n");
    if (yes) {
      log.warn(
        `You have uncommitted or untracked files:\n${fileList}\nProceeding anyway (--yes).`
      );
      return true;
    }
    log.warn(`You have uncommitted or untracked files:\n${fileList}`);
    const proceed = await confirm({
      message: "Continue with uncommitted changes?",
    });
    if (isCancel(proceed)) {
      return false;
    }
    return !!proceed;
  }

  return true;
}
