/**
 * Workspace Detection
 *
 * Utilities for finding the workspace root directory.
 * Used to scope alias caches to specific workspaces/monorepos.
 *
 * Resolution priority:
 * 1. Git root (most common for version-controlled projects)
 * 2. Directory containing package.json (Node.js projects)
 * 3. Current working directory (fallback)
 */

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Find the git root directory by searching for .git folder.
 * Uses node:fs existsSync for directory detection (Bun.file doesn't support directories).
 *
 * @param cwd - Starting directory for search
 * @returns Git root path, or null if not found
 */
function findGitRoot(cwd: string): string | null {
  let current = cwd;

  while (current !== "/") {
    const gitPath = join(current, ".git");

    // .git can be a directory (normal repo) or a file (worktree)
    if (existsSync(gitPath)) {
      return current;
    }

    const parent = dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }

  return null;
}

/**
 * Find the nearest directory containing package.json.
 *
 * @param cwd - Starting directory for search
 * @returns Directory path containing package.json, or null if not found
 */
async function findPackageRoot(cwd: string): Promise<string | null> {
  let current = cwd;

  while (current !== "/") {
    const packagePath = join(current, "package.json");
    const packageFile = Bun.file(packagePath);

    // package.json is always a file, so Bun.file works correctly
    if (await packageFile.exists()) {
      return current;
    }

    const parent = dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }

  return null;
}

/**
 * Get the workspace root directory.
 *
 * Searches up the directory tree to find the workspace root:
 * 1. Git root (if in a git repository)
 * 2. Directory with package.json (Node.js project root)
 * 3. Falls back to provided cwd
 *
 * @param cwd - Current working directory to search from
 * @returns Absolute path to workspace root
 */
export async function getWorkspaceRoot(cwd: string): Promise<string> {
  // Try git root first (most reliable for monorepos)
  const gitRoot = findGitRoot(cwd);
  if (gitRoot) {
    return gitRoot;
  }

  // Fall back to package.json location
  const packageRoot = await findPackageRoot(cwd);
  if (packageRoot) {
    return packageRoot;
  }

  // Last resort: use cwd as-is
  return cwd;
}
