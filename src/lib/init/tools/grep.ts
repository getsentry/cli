import { spawn as nodeSpawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { MAX_FILE_BYTES, MAX_OUTPUT_BYTES } from "../constants.js";
import type { GrepPayload, ToolResult } from "../types.js";
import { safePath } from "./shared.js";
import type { InitToolDefinition } from "./types.js";

const MAX_GREP_RESULTS_PER_SEARCH = 100;
const MAX_GREP_LINE_LENGTH = 2000;
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "__pycache__",
  ".venv",
  "venv",
  "dist",
  "build",
]);

type GrepMatch = { path: string; lineNum: number; line: string };

function spawnCollect(
  cmd: string,
  args: string[],
  cwd: string
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return awaitWithSpawn(
    new Promise((resolve, reject) => {
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

      const errChunks: Buffer[] = [];
      child.stderr.on("data", (chunk: Buffer) => {
        if (errChunks.length < 64) {
          errChunks.push(chunk);
        }
      });

      child.on("error", (error) => {
        reject(error);
      });
      child.on("close", (code, signal) => {
        if (signal) {
          reject(new Error(`Process killed by ${signal} (timeout)`));
          return;
        }
        resolve({
          stdout: Buffer.concat(outChunks).toString("utf-8"),
          stderr: Buffer.concat(errChunks).toString("utf-8"),
          exitCode: code ?? 1,
        });
      });
    })
  );
}

function parseRgGrepOutput(
  cwd: string,
  stdout: string,
  maxResults: number
): { matches: GrepMatch[]; truncated: boolean } {
  const lines = stdout.split("\n").filter(Boolean);
  const truncated = lines.length > maxResults;
  const matches: GrepMatch[] = [];

  for (const line of lines.slice(0, maxResults)) {
    const firstSep = line.indexOf("|");
    if (firstSep === -1) {
      continue;
    }
    const filePart = line.substring(0, firstSep);
    const rest = line.substring(firstSep + 1);
    const secondSep = rest.indexOf("|");
    if (secondSep === -1) {
      continue;
    }
    const lineNum = Number.parseInt(rest.substring(0, secondSep), 10);
    let text = rest.substring(secondSep + 1);
    if (text.length > MAX_GREP_LINE_LENGTH) {
      text = `${text.substring(0, MAX_GREP_LINE_LENGTH)}…`;
    }
    matches.push({ path: path.relative(cwd, filePart), lineNum, line: text });
  }

  return { matches, truncated };
}

async function rgGrepSearch(opts: {
  cwd: string;
  pattern: string;
  target: string;
  include: string | undefined;
  maxResults: number;
}): Promise<{ matches: GrepMatch[]; truncated: boolean }> {
  const args = [
    "-nH",
    "--no-messages",
    "--hidden",
    "--field-match-separator=|",
    "--regexp",
    opts.pattern,
  ];
  if (opts.include) {
    args.push("--glob", opts.include);
  }
  args.push(opts.target);

  const { stdout, exitCode } = await spawnCollect("rg", args, opts.cwd);

  if (exitCode === 1 || (exitCode === 2 && !stdout.trim())) {
    return { matches: [], truncated: false };
  }
  if (exitCode !== 0 && exitCode !== 2) {
    throw new Error(`ripgrep failed with exit code ${exitCode}`);
  }

  return parseRgGrepOutput(opts.cwd, stdout, opts.maxResults);
}

async function* walkFiles(
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
    if (entry.isDirectory() && !SKIP_DIRS.has(entry.name)) {
      yield* walkFiles(root, full, globPattern);
    } else if (entry.isFile()) {
      const matchTarget = globPattern?.includes("/") ? rel : entry.name;
      if (!globPattern || matchGlob(matchTarget, globPattern)) {
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

async function fsGrepSearch(opts: {
  cwd: string;
  pattern: string;
  searchPath: string | undefined;
  include: string | undefined;
  maxResults: number;
}): Promise<{ matches: GrepMatch[]; truncated: boolean }> {
  const target = opts.searchPath ? safePath(opts.cwd, opts.searchPath) : opts.cwd;
  let regex: RegExp;
  try {
    regex = new RegExp(opts.pattern);
  } catch {
    return { matches: [], truncated: false };
  }
  const matches: GrepMatch[] = [];

  for await (const rel of walkFiles(opts.cwd, target, opts.include)) {
    if (matches.length > opts.maxResults) {
      break;
    }
    const absPath = path.join(opts.cwd, rel);
    let content: string;
    try {
      const stat = await fs.promises.stat(absPath);
      if (stat.size > MAX_FILE_BYTES) {
        continue;
      }
      content = await fs.promises.readFile(absPath, "utf-8");
    } catch {
      continue;
    }
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i] ?? "";
      if (regex.test(line)) {
        let text = line;
        if (text.length > MAX_GREP_LINE_LENGTH) {
          text = `${text.substring(0, MAX_GREP_LINE_LENGTH)}…`;
        }
        matches.push({ path: rel, lineNum: i + 1, line: text });
        if (matches.length > opts.maxResults) {
          break;
        }
      }
    }
  }

  const truncated = matches.length > opts.maxResults;
  if (truncated) {
    matches.length = opts.maxResults;
  }
  return { matches, truncated };
}

function isGitRepo(dir: string): boolean {
  try {
    return fs.statSync(path.join(dir, ".git")).isDirectory();
  } catch {
    return false;
  }
}

const GREP_LINE_RE = /^(.+?):(\d+):(.*)$/;

function parseGrepOutput(
  stdout: string,
  maxResults: number,
  pathPrefix?: string
): { matches: GrepMatch[]; truncated: boolean } {
  const lines = stdout.split("\n").filter(Boolean);
  const matches: GrepMatch[] = [];

  for (const line of lines) {
    const match = line.match(GREP_LINE_RE);
    if (!(match?.[1] && match[2] && match[3] !== undefined)) {
      continue;
    }
    const lineNum = Number.parseInt(match[2], 10);
    let text = match[3];
    if (text.length > MAX_GREP_LINE_LENGTH) {
      text = `${text.substring(0, MAX_GREP_LINE_LENGTH)}…`;
    }
    const filePath = pathPrefix ? path.join(pathPrefix, match[1]) : match[1];
    matches.push({ path: filePath, lineNum, line: text });
    if (matches.length > maxResults) {
      break;
    }
  }

  const truncated = matches.length > maxResults;
  if (truncated) {
    matches.length = maxResults;
  }
  return { matches, truncated };
}

async function gitGrepSearch(opts: {
  cwd: string;
  pattern: string;
  target: string;
  include: string | undefined;
  maxResults: number;
}): Promise<{ matches: GrepMatch[]; truncated: boolean }> {
  const args = ["grep", "--untracked", "-n", "-E", opts.pattern];
  if (opts.include) {
    args.push("--", opts.include);
  }

  const { stdout, exitCode } = await spawnCollect("git", args, opts.target);

  if (exitCode === 1) {
    return { matches: [], truncated: false };
  }
  if (exitCode !== 0) {
    throw new Error(`git grep failed with exit code ${exitCode}`);
  }

  const prefix = path.relative(opts.cwd, opts.target);
  return parseGrepOutput(stdout, opts.maxResults, prefix || undefined);
}

async function grepSearch(opts: {
  cwd: string;
  pattern: string;
  searchPath: string | undefined;
  include: string | undefined;
  maxResults: number;
}): Promise<{ matches: GrepMatch[]; truncated: boolean }> {
  const target = opts.searchPath ? safePath(opts.cwd, opts.searchPath) : opts.cwd;
  const resolvedOpts = { ...opts, target };
  try {
    return await rgGrepSearch(resolvedOpts);
  } catch {
    if (isGitRepo(opts.cwd)) {
      try {
        return await gitGrepSearch(resolvedOpts);
      } catch {
        // fall through
      }
    }
    return await fsGrepSearch(opts);
  }
}

/**
 * Search project files for one or more regex patterns.
 */
export async function grep(payload: GrepPayload): Promise<ToolResult> {
  const maxResults = payload.params.maxResultsPerSearch ?? MAX_GREP_RESULTS_PER_SEARCH;
  const results = await Promise.all(
    payload.params.searches.map(async (search) => {
      const { matches, truncated } = await grepSearch({
        cwd: payload.cwd,
        pattern: search.pattern,
        searchPath: search.path,
        include: search.include,
        maxResults,
      });
      return { pattern: search.pattern, matches, truncated };
    })
  );

  return { ok: true, data: { results } };
}

/**
 * Tool definition for grep-like project searches.
 */
export const grepTool: InitToolDefinition<"grep"> = {
  operation: "grep",
  describe: (payload) => {
    const [first] = payload.params.searches;
    if (payload.params.searches.length === 1 && first) {
      return `Searching for \`${first.pattern}\`...`;
    }
    return `Running ${payload.params.searches.length} searches...`;
  },
  execute: grep,
};

async function awaitWithSpawn<T>(promise: Promise<T>): Promise<T> {
  return await promise;
}

