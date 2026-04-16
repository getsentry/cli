import { spawn as nodeSpawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { MAX_OUTPUT_BYTES } from "../constants.js";
import type { GlobPayload, ToolResult } from "../types.js";
import { safePath } from "./shared.js";
import type { InitToolDefinition } from "./types.js";

const MAX_GLOB_RESULTS = 100;
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "__pycache__",
  ".venv",
  "venv",
  "dist",
  "build",
]);

function spawnCollect(
  cmd: string,
  args: string[],
  cwd: string
): Promise<{ stdout: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const child = nodeSpawn(cmd, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 30_000,
    });

    const outChunks: Buffer[] = [];
    let outLen = 0;
    child.stdout.on("data", (chunk: Buffer) => {
      if (outLen < MAX_OUTPUT_BYTES) {
        outChunks.push(chunk);
        outLen += chunk.length;
      }
    });

    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (signal) {
        reject(new Error(`Process killed by ${signal} (timeout)`));
        return;
      }
      resolve({
        stdout: Buffer.concat(outChunks).toString("utf-8"),
        exitCode: code ?? 1,
      });
    });
  });
}

async function rgGlobSearch(opts: {
  cwd: string;
  pattern: string;
  target: string;
  maxResults: number;
}): Promise<{ files: string[]; truncated: boolean }> {
  const { stdout, exitCode } = await spawnCollect(
    "rg",
    ["--files", "--hidden", "--glob", opts.pattern, opts.target],
    opts.cwd
  );

  if (exitCode === 1 || (exitCode === 2 && !stdout.trim())) {
    return { files: [], truncated: false };
  }
  if (exitCode !== 0 && exitCode !== 2) {
    throw new Error(`ripgrep failed with exit code ${exitCode}`);
  }

  const lines = stdout.split("\n").filter(Boolean);
  const truncated = lines.length > opts.maxResults;
  const files = lines.slice(0, opts.maxResults).map((filePath) => path.relative(opts.cwd, filePath));
  return { files, truncated };
}

async function* walkFiles(
  root: string,
  base: string,
  pattern: string
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
    if (entry.isDirectory() && !SKIP_DIRS.has(entry.name)) {
      yield* walkFiles(root, full, pattern);
    } else if (entry.isFile()) {
      const matchTarget = pattern.includes("/") ? rel : entry.name;
      if (matchGlob(matchTarget, pattern)) {
        yield rel;
      }
    }
  }
}

function matchGlob(name: string, pattern: string): boolean {
  const re = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "\0")
    .replace(/\*/g, "[^/]*")
    .replace(/\0/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${re}$`).test(name);
}

function isGitRepo(dir: string): boolean {
  try {
    return fs.statSync(path.join(dir, ".git")).isDirectory();
  } catch {
    return false;
  }
}

async function gitLsFiles(opts: {
  cwd: string;
  pattern: string;
  target: string;
  maxResults: number;
}): Promise<{ files: string[]; truncated: boolean }> {
  const { stdout, exitCode } = await spawnCollect(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", opts.pattern],
    opts.target
  );

  if (exitCode !== 0) {
    throw new Error(`git ls-files failed with exit code ${exitCode}`);
  }

  const lines = stdout.split("\n").filter(Boolean);
  const truncated = lines.length > opts.maxResults;
  const files = lines
    .slice(0, opts.maxResults)
    .map((filePath) => path.relative(opts.cwd, path.resolve(opts.target, filePath)));
  return { files, truncated };
}

async function fsGlobSearch(opts: {
  cwd: string;
  pattern: string;
  searchPath: string | undefined;
  maxResults: number;
}): Promise<{ files: string[]; truncated: boolean }> {
  const target = opts.searchPath ? safePath(opts.cwd, opts.searchPath) : opts.cwd;
  const files: string[] = [];

  for await (const rel of walkFiles(opts.cwd, target, opts.pattern)) {
    files.push(rel);
    if (files.length > opts.maxResults) {
      break;
    }
  }

  const truncated = files.length > opts.maxResults;
  if (truncated) {
    files.length = opts.maxResults;
  }
  return { files, truncated };
}

async function globSearch(opts: {
  cwd: string;
  pattern: string;
  searchPath: string | undefined;
  maxResults: number;
}): Promise<{ files: string[]; truncated: boolean }> {
  const target = opts.searchPath ? safePath(opts.cwd, opts.searchPath) : opts.cwd;
  const resolvedOpts = { ...opts, target };
  try {
    return await rgGlobSearch(resolvedOpts);
  } catch {
    if (isGitRepo(opts.cwd)) {
      try {
        return await gitLsFiles(resolvedOpts);
      } catch {
        // fall through
      }
    }
    return await fsGlobSearch(opts);
  }
}

/**
 * Find files matching one or more glob patterns.
 */
export async function glob(payload: GlobPayload): Promise<ToolResult> {
  const maxResults = payload.params.maxResults ?? MAX_GLOB_RESULTS;
  const results = await Promise.all(
    payload.params.patterns.map(async (pattern) => {
      const { files, truncated } = await globSearch({
        cwd: payload.cwd,
        pattern,
        searchPath: payload.params.path,
        maxResults,
      });
      return { pattern, files, truncated };
    })
  );

  return { ok: true, data: { results } };
}

/**
 * Tool definition for glob-based file discovery.
 */
export const globTool: InitToolDefinition<"glob"> = {
  operation: "glob",
  describe: (payload) => {
    const [first] = payload.params.patterns;
    if (payload.params.patterns.length === 1 && first) {
      return `Finding files matching \`${first}\`...`;
    }
    return `Finding files (${payload.params.patterns.length} patterns)...`;
  },
  execute: glob,
};

