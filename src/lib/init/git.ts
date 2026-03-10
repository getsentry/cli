/**
 * Git Safety Checks
 *
 * Pre-flight checks to verify the user is in a git repo with a clean
 * working tree before the init wizard starts modifying files.
 */

import { confirm, isCancel, log } from "@clack/prompts";

export function isInsideGitWorkTree(opts: { cwd: string }): boolean {
  const result = Bun.spawnSync(["git", "rev-parse", "--is-inside-work-tree"], {
    stdout: "ignore",
    stderr: "ignore",
    cwd: opts.cwd,
  });
  return result.success;
}

export function getUncommittedOrUntrackedFiles(opts: {
  cwd: string;
}): string[] {
  const result = Bun.spawnSync(["git", "status", "--porcelain=v1"], {
    stdout: "pipe",
    stderr: "ignore",
    cwd: opts.cwd,
  });
  if (!(result.success && result.stdout)) {
    return [];
  }
  return result.stdout
    .toString()
    .trimEnd()
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => `- ${line.trimEnd()}`);
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
