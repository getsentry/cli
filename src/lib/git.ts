/**
 * Centralized git helpers
 *
 * Low-level git primitives used across the CLI: release management,
 * init wizard pre-flight checks, and version detection.
 *
 * Uses `execFileSync` (no shell) from `node:child_process` instead of
 * `Bun.spawnSync` because this module is also used by the npm/Node
 * distribution (via esbuild bundle), where Bun APIs are shimmed but
 * `node:child_process` works natively. This avoids shell injection
 * risks and is consistent with the AGENTS.md `execSync` exception.
 */

import { execFileSync } from "node:child_process";

import { ValidationError } from "./errors.js";

/** Commit data structure matching the Sentry releases API */
export type GitCommit = {
  id: string;
  message: string;
  author_name: string;
  author_email: string;
  timestamp: string;
  repository?: string;
};

/**
 * Run a git command and return trimmed stdout.
 *
 * Uses `execFileSync` (no shell) to avoid shell injection risks.
 * Arguments are passed as an array, not interpolated into a string.
 *
 * @param args - Git subcommand and arguments as separate strings
 * @param cwd - Working directory
 * @returns Trimmed stdout
 * @throws On non-zero exit
 */
function git(args: string[], cwd?: string): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}

// ---------------------------------------------------------------------------
// Repository status
// ---------------------------------------------------------------------------

/**
 * Check if the current directory is inside a git work tree.
 *
 * @param cwd - Working directory
 * @returns true if inside a git work tree
 */
export function isInsideGitWorkTree(cwd?: string): boolean {
  try {
    git(["rev-parse", "--is-inside-work-tree"], cwd);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the list of uncommitted or untracked files.
 *
 * Returns each line from `git status --porcelain=v1` prefixed with `- `.
 * Empty array if the working tree is clean or not a git repo.
 *
 * @param cwd - Working directory
 * @returns Array of formatted status lines (e.g., `["- M src/index.ts", "- ?? new-file.ts"]`)
 */
export function getUncommittedFiles(cwd?: string): string[] {
  try {
    const raw = git(["status", "--porcelain=v1"], cwd);
    if (!raw) {
      return [];
    }
    return raw
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => `- ${line}`);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Commit info
// ---------------------------------------------------------------------------

/**
 * Get the HEAD commit SHA.
 *
 * @param cwd - Working directory (defaults to process.cwd())
 * @returns 40-char commit SHA
 * @throws {ValidationError} When not inside a git repository
 */
export function getHeadCommit(cwd?: string): string {
  try {
    return git(["rev-parse", "HEAD"], cwd);
  } catch {
    throw new ValidationError(
      "Not a git repository. Run this command from within a git working tree.",
      "git"
    );
  }
}

/**
 * Check if the current repository is a shallow clone.
 *
 * @param cwd - Working directory
 * @returns true if the repository is shallow
 */
export function isShallowRepository(cwd?: string): boolean {
  try {
    return git(["rev-parse", "--is-shallow-repository"], cwd) === "true";
  } catch {
    return false;
  }
}

/** NUL byte used as record separator in git log output */
const NUL = "\x00";

/**
 * Get the commit log from HEAD, optionally limited by depth or a starting commit.
 *
 * Uses NUL-delimited output for robust parsing (commit messages can contain newlines).
 * The format string uses git's `%x00` hex escape (not literal NUL bytes) because
 * `execSync` rejects command strings containing null bytes.
 *
 * @param cwd - Working directory
 * @param options - Log options
 * @returns Array of commit data matching the Sentry releases API format
 */
export function getCommitLog(
  cwd?: string,
  options: { from?: string; depth?: number } = {}
): GitCommit[] {
  const { from, depth = 20 } = options;

  // Format: hash, subject, author name, author email, author date (ISO)
  // %x00 is git's hex escape for NUL — avoids literal NUL in the command string
  const format = "%H%x00%s%x00%aN%x00%aE%x00%aI";
  const range = from ? `${from}..HEAD` : "HEAD";
  const raw = git(
    ["log", `--format=${format}`, `--max-count=${depth}`, range],
    cwd
  );

  if (!raw) {
    return [];
  }

  return raw.split("\n").map((line) => {
    const [id, message, authorName, authorEmail, timestamp] = line.split(NUL);
    return {
      id: id ?? "",
      message: message ?? "",
      author_name: authorName ?? "",
      author_email: authorEmail ?? "",
      timestamp: timestamp ?? "",
    };
  });
}

/**
 * Get the repository name from the "origin" remote URL.
 *
 * Parses both HTTPS and SSH remote formats:
 * - `https://github.com/owner/repo.git` → `owner/repo`
 * - `git@github.com:owner/repo.git` → `owner/repo`
 *
 * @param cwd - Working directory
 * @returns `owner/repo` string, or undefined if no origin remote
 */
export function getRepositoryName(cwd?: string): string | undefined {
  try {
    const url = git(["remote", "get-url", "origin"], cwd);
    return parseRemoteUrl(url);
  } catch {
    return;
  }
}

/** SSH remote URL pattern: git@host:owner/repo.git */
const SSH_REMOTE_RE = /:([^/][^:]+?)(?:\.git)?$/;

/** Leading slash in URL pathname */
const LEADING_SLASH_RE = /^\//;

/** Trailing .git suffix */
const DOT_GIT_SUFFIX_RE = /\.git$/;

/**
 * Parse a git remote URL to extract `owner/repo`.
 *
 * Handles HTTPS, SSH, and git:// protocols. Strips `.git` suffix.
 *
 * @param url - Remote URL string
 * @returns `owner/repo` string, or undefined if unparseable
 */
export function parseRemoteUrl(url: string): string | undefined {
  // Try URL parsing first — handles https://, ssh://, git:// protocols
  // (including ssh://git@host:port/path which would confuse the SCP regex)
  try {
    const parsed = new URL(url);
    const path = parsed.pathname
      .replace(LEADING_SLASH_RE, "")
      .replace(DOT_GIT_SUFFIX_RE, "");
    if (path.includes("/")) {
      return path;
    }
  } catch {
    // Not a valid URL — try SCP-style format below
  }

  // SCP-style SSH format: git@github.com:owner/repo.git
  // Only matched when URL parsing fails (avoids confusion with port numbers)
  const sshMatch = url.match(SSH_REMOTE_RE);
  if (sshMatch && url.includes("@")) {
    return sshMatch[1];
  }

  return;
}
