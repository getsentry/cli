import fs from "node:fs";
import path from "node:path";
import { MAX_FILE_BYTES } from "../constants.js";
import type { GrepPayload, ToolResult } from "../types.js";
import {
  isGitRepo,
  resolveSearchTarget,
  spawnSearchProcess,
  walkFiles,
} from "./search-utils.js";
import type { InitToolDefinition } from "./types.js";

const MAX_GREP_RESULTS_PER_SEARCH = 100;
const MAX_GREP_LINE_LENGTH = 2000;
const GREP_LINE_RE = /^(.+?):(\d+):(.*)$/;

type GrepMatch = { path: string; lineNum: number; line: string };

function truncateMatchLine(line: string): string {
  if (line.length <= MAX_GREP_LINE_LENGTH) {
    return line;
  }
  return `${line.substring(0, MAX_GREP_LINE_LENGTH)}…`;
}

function limitMatches<T>(
  matches: T[],
  maxResults: number
): { matches: T[]; truncated: boolean } {
  const truncated = matches.length > maxResults;
  if (truncated) {
    matches.length = maxResults;
  }
  return { matches, truncated };
}

function parseRgGrepOutput(
  cwd: string,
  stdout: string,
  maxResults: number
): { matches: GrepMatch[]; truncated: boolean } {
  const lines = stdout.split("\n").filter(Boolean);
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
    const text = truncateMatchLine(rest.substring(secondSep + 1));
    matches.push({ path: path.relative(cwd, filePart), lineNum, line: text });
  }

  return {
    matches,
    truncated: lines.length > maxResults,
  };
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

  const { stdout, exitCode } = await spawnSearchProcess("rg", args, opts.cwd);
  if (exitCode === 1 || (exitCode === 2 && !stdout.trim())) {
    return { matches: [], truncated: false };
  }
  if (exitCode !== 0 && exitCode !== 2) {
    throw new Error(`ripgrep failed with exit code ${exitCode}`);
  }

  return parseRgGrepOutput(opts.cwd, stdout, opts.maxResults);
}

function compilePattern(pattern: string): RegExp | null {
  try {
    return new RegExp(pattern);
  } catch {
    return null;
  }
}

async function readSearchableFile(absPath: string): Promise<string | null> {
  try {
    const stat = await fs.promises.stat(absPath);
    if (stat.size > MAX_FILE_BYTES) {
      return null;
    }
    return await fs.promises.readFile(absPath, "utf-8");
  } catch {
    return null;
  }
}

function findRegexMatches(
  relPath: string,
  content: string,
  regex: RegExp,
  maxResults: number
): GrepMatch[] {
  const matches: GrepMatch[] = [];
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    regex.lastIndex = 0;
    if (!regex.test(line)) {
      continue;
    }

    matches.push({
      path: relPath,
      lineNum: i + 1,
      line: truncateMatchLine(line),
    });
    if (matches.length > maxResults) {
      break;
    }
  }

  return matches;
}

async function fsGrepSearch(opts: {
  cwd: string;
  pattern: string;
  searchPath: string | undefined;
  include: string | undefined;
  maxResults: number;
}): Promise<{ matches: GrepMatch[]; truncated: boolean }> {
  const target = resolveSearchTarget(opts.cwd, opts.searchPath);
  const regex = compilePattern(opts.pattern);
  if (!regex) {
    return { matches: [], truncated: false };
  }

  const matches: GrepMatch[] = [];
  for await (const rel of walkFiles(opts.cwd, target, opts.include)) {
    if (matches.length > opts.maxResults) {
      break;
    }

    const absPath = path.join(opts.cwd, rel);
    const content = await readSearchableFile(absPath);
    if (!content) {
      continue;
    }

    matches.push(
      ...findRegexMatches(
        rel,
        content,
        regex,
        opts.maxResults - matches.length + 1
      )
    );
  }

  return limitMatches(matches, opts.maxResults);
}

function parseGrepOutput(
  stdout: string,
  maxResults: number,
  pathPrefix?: string
): { matches: GrepMatch[]; truncated: boolean } {
  const matches: GrepMatch[] = [];
  for (const line of stdout.split("\n").filter(Boolean)) {
    const match = line.match(GREP_LINE_RE);
    if (!(match?.[1] && match[2] && match[3] !== undefined)) {
      continue;
    }

    matches.push({
      path: pathPrefix ? path.join(pathPrefix, match[1]) : match[1],
      lineNum: Number.parseInt(match[2], 10),
      line: truncateMatchLine(match[3]),
    });
    if (matches.length > maxResults) {
      break;
    }
  }

  return limitMatches(matches, maxResults);
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

  const { stdout, exitCode } = await spawnSearchProcess(
    "git",
    args,
    opts.target
  );
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
  const target = resolveSearchTarget(opts.cwd, opts.searchPath);
  const resolvedOpts = { ...opts, target };

  try {
    return await rgGrepSearch(resolvedOpts);
  } catch {
    if (isGitRepo(opts.cwd)) {
      try {
        return await gitGrepSearch(resolvedOpts);
      } catch {
        // fall through to filesystem search
      }
    }
    return await fsGrepSearch(opts);
  }
}

/**
 * Search project files for one or more regex patterns.
 */
export async function grep(payload: GrepPayload): Promise<ToolResult> {
  const maxResults =
    payload.params.maxResultsPerSearch ?? MAX_GREP_RESULTS_PER_SEARCH;
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
