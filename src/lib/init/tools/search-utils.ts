import { spawn as nodeSpawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { MAX_OUTPUT_BYTES } from "../constants.js";
import { safePath } from "./shared.js";

const MAX_STDERR_CHUNKS = 64;

export const SEARCH_SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "__pycache__",
  ".venv",
  "venv",
  "dist",
  "build",
]);

type SearchProcessResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

/**
 * Resolve an optional search path within the init sandbox.
 */
export function resolveSearchTarget(
  cwd: string,
  searchPath: string | undefined
): string {
  return searchPath ? safePath(cwd, searchPath) : cwd;
}

/**
 * Spawn a search helper process, draining both stdout and stderr to avoid
 * blocking when a child emits a large amount of diagnostics.
 */
export function spawnSearchProcess(
  cmd: string,
  args: string[],
  cwd: string
): Promise<SearchProcessResult> {
  return new Promise((resolve, reject) => {
    const child = nodeSpawn(cmd, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 30_000,
    });

    const stdoutChunks: Buffer[] = [];
    let stdoutBytes = 0;
    child.stdout.on("data", (chunk: Buffer) => {
      if (stdoutBytes >= MAX_OUTPUT_BYTES) {
        return;
      }

      const remaining = MAX_OUTPUT_BYTES - stdoutBytes;
      stdoutChunks.push(chunk.subarray(0, remaining));
      stdoutBytes += Math.min(chunk.length, remaining);
    });

    const stderrChunks: Buffer[] = [];
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderrChunks.length >= MAX_STDERR_CHUNKS) {
        return;
      }

      stderrChunks.push(chunk);
    });

    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (signal) {
        reject(new Error(`Process killed by ${signal} (timeout)`));
        return;
      }

      resolve({
        stdout: Buffer.concat(stdoutChunks).toString("utf-8"),
        stderr: Buffer.concat(stderrChunks).toString("utf-8"),
        exitCode: code ?? 1,
      });
    });
  });
}

/**
 * Check whether a directory is a git repository.
 */
export function isGitRepo(dir: string): boolean {
  try {
    return fs.statSync(path.join(dir, ".git")).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Minimal glob matcher supporting `*`, `**`, and `?`.
 */
export function matchGlob(name: string, pattern: string): boolean {
  const re = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "\0")
    .replace(/\*/g, "[^/]*")
    .replace(/\0/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${re}$`).test(name);
}

/**
 * Recursively walk a directory and yield file paths relative to the original
 * cwd, skipping common dependency and build directories.
 */
export async function* walkFiles(
  root: string,
  base: string,
  globPattern: string | undefined
): AsyncGenerator<string> {
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(base, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const full = path.join(base, entry.name);
    const rel = path.relative(root, full);

    if (entry.isDirectory() && !SEARCH_SKIP_DIRS.has(entry.name)) {
      yield* walkFiles(root, full, globPattern);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const matchTarget = globPattern?.includes("/") ? rel : entry.name;
    if (!globPattern || matchGlob(matchTarget, globPattern)) {
      yield rel;
    }
  }
}
