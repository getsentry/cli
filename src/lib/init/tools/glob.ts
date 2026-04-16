import path from "node:path";
import type { GlobPayload, ToolResult } from "../types.js";
import {
  isGitRepo,
  resolveSearchTarget,
  spawnSearchProcess,
  walkFiles,
} from "./search-utils.js";
import type { InitToolDefinition } from "./types.js";

const MAX_GLOB_RESULTS = 100;

async function rgGlobSearch(opts: {
  cwd: string;
  pattern: string;
  target: string;
  maxResults: number;
}): Promise<{ files: string[]; truncated: boolean }> {
  const { stdout, exitCode } = await spawnSearchProcess(
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
  const files = lines
    .slice(0, opts.maxResults)
    .map((filePath) => path.relative(opts.cwd, filePath));
  return { files, truncated };
}

async function gitLsFiles(opts: {
  cwd: string;
  pattern: string;
  target: string;
  maxResults: number;
}): Promise<{ files: string[]; truncated: boolean }> {
  const { stdout, exitCode } = await spawnSearchProcess(
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
    .map((filePath) =>
      path.relative(opts.cwd, path.resolve(opts.target, filePath))
    );
  return { files, truncated };
}

async function fsGlobSearch(opts: {
  cwd: string;
  pattern: string;
  searchPath: string | undefined;
  maxResults: number;
}): Promise<{ files: string[]; truncated: boolean }> {
  const target = resolveSearchTarget(opts.cwd, opts.searchPath);
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
  const target = resolveSearchTarget(opts.cwd, opts.searchPath);
  const resolvedOpts = { ...opts, target };

  try {
    return await rgGlobSearch(resolvedOpts);
  } catch {
    if (isGitRepo(opts.cwd)) {
      try {
        return await gitLsFiles(resolvedOpts);
      } catch {
        // fall through to filesystem search
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
