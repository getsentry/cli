import fs from "node:fs";
import path from "node:path";
import { DEFAULT_SKIP_DIRS, normalizePath } from "../../scan/index.js";
import type { DirEntry, ListDirPayload, ToolResult } from "../types.js";
import { safePath } from "./shared.js";
import type { InitToolDefinition } from "./types.js";

const NATIVE_SEP = path.sep;
const DEFAULT_MAX_DEPTH = 5;
const DEFAULT_MAX_ENTRIES = 500;
const INIT_SKIP_DIRS = new Set([
  ...DEFAULT_SKIP_DIRS,
  "out",
  "tmp",
  "temp",
  "bin",
  "obj",
  ".pytest_cache",
  ".mypy_cache",
  ".ruff_cache",
  ".pnpm-store",
  "bower_components",
  "Pods",
]);
const PRIORITY_FILE_NAMES = new Set([
  "package.json",
  "tsconfig.json",
  "pyproject.toml",
  "requirements.txt",
  "requirements-dev.txt",
  "setup.py",
  "setup.cfg",
  "Pipfile",
  "Gemfile",
  "go.mod",
  "build.gradle",
  "build.gradle.kts",
  "settings.gradle",
  "settings.gradle.kts",
  "pom.xml",
  "Cargo.toml",
  "pubspec.yaml",
  "mix.exs",
  "composer.json",
  "Podfile",
  "CMakeLists.txt",
  "angular.json",
  "app.json",
  "wrangler.toml",
  "wrangler.jsonc",
  "serverless.yml",
  "serverless.ts",
  "bunfig.toml",
  "manage.py",
  "app.py",
  "main.py",
  "artisan",
  "symfony.lock",
  "wp-config.php",
  "appsettings.json",
  "Program.cs",
  "Startup.cs",
  "main.go",
  "instrumentation.ts",
  "instrumentation.js",
]);
const PRIORITY_FILE_PATTERNS = [
  /^(?:app|vite|next|nuxt|astro|svelte|remix|webpack|metro)\.config\.(?:js|mjs|cjs|ts|mts|cts)$/u,
  /^sentry\.(?:client|server|edge)\.config\.(?:js|mjs|cjs|ts|mts|cts)$/u,
];

/**
 * List files and directories within the workflow sandbox.
 *
 * Paths in the result are POSIX-normalized (`/`-separated) regardless
 * of host OS, so the Mastra agent sees a consistent wire shape.
 */
export async function listDir(payload: ListDirPayload): Promise<ToolResult> {
  const { cwd, params } = payload;
  const targetPath = safePath(cwd, params.path);
  const maxDepth = params.maxDepth ?? DEFAULT_MAX_DEPTH;
  const maxEntries = params.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const recursive = params.recursive ?? false;
  const state: WalkState = {
    cwd,
    // Cached prefix length used to turn an absolute native path into a
    // cwd-relative POSIX path via `abs.slice(cwdPrefixLen)` — O(1) and
    // avoids the per-entry `path.relative` allocation.
    cwdPrefixLen: cwd.length + 1,
    entries: [],
    maxDepth,
    maxEntries,
    recursive,
    skippedDirectories: new Set(),
    truncated: false,
  };

  await walkDirectoryBreadthFirst(targetPath, state);
  return {
    ok: true,
    data: {
      entries: state.entries,
      truncated: state.truncated,
      skippedDirectories: [...state.skippedDirectories],
      maxDepth,
      maxEntries,
    },
  };
}

type WalkState = {
  cwd: string;
  cwdPrefixLen: number;
  entries: DirEntry[];
  maxDepth: number;
  maxEntries: number;
  recursive: boolean;
  skippedDirectories: Set<string>;
  truncated: boolean;
};

type WalkCandidate = {
  abs: string;
  dirent: fs.Dirent;
  entry: DirEntry;
};

async function readDirEntries(dir: string): Promise<fs.Dirent[]> {
  try {
    return await fs.promises.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function shouldSkipDirectory(entry: fs.Dirent, state: WalkState): boolean {
  return (
    state.recursive &&
    entry.isDirectory() &&
    !entry.isSymbolicLink() &&
    (entry.name.startsWith(".") || INIT_SKIP_DIRS.has(entry.name))
  );
}

/**
 * Build a `DirEntry` for `entry` sitting inside `dir`. Returns
 * `undefined` for symlinks that escape the sandbox.
 *
 * `dir` is absolute native-separator, guaranteed to start with
 * `state.cwd + sep`, so `abs.slice(state.cwdPrefixLen)` yields the
 * cwd-relative path without a `path.relative` allocation.
 */
function toDirEntry(
  state: WalkState,
  dir: string,
  entry: fs.Dirent,
  depth: number
): DirEntry | undefined {
  const abs = dir + NATIVE_SEP + entry.name;
  const relNative = abs.slice(state.cwdPrefixLen);

  if (entry.isSymbolicLink()) {
    try {
      safePath(state.cwd, relNative);
    } catch {
      return;
    }
  }

  return {
    name: entry.name,
    path: normalizePath(relNative),
    type: entry.isDirectory() ? "directory" : "file",
    depth,
  };
}

function isPriorityFile(filePath: string): boolean {
  const name = filePath.split("/").at(-1) ?? filePath;
  return (
    PRIORITY_FILE_NAMES.has(name) ||
    PRIORITY_FILE_PATTERNS.some((pattern) => pattern.test(name))
  );
}

function entrySortRank(candidate: WalkCandidate): number {
  const { entry } = candidate;
  if (entry.type === "file" && isPriorityFile(entry.path)) {
    return 0;
  }
  if (entry.type === "directory" && !entry.skipped) {
    return 1;
  }
  if (entry.type === "file") {
    return 2;
  }
  return 3;
}

function sortCandidates(candidates: WalkCandidate[]): WalkCandidate[] {
  return candidates.sort((a, b) => {
    const aRank = entrySortRank(a);
    const bRank = entrySortRank(b);
    if (aRank !== bRank) {
      return aRank - bRank;
    }
    return a.entry.path.localeCompare(b.entry.path);
  });
}

async function readCandidates(
  dir: string,
  childDepth: number,
  state: WalkState
): Promise<WalkCandidate[]> {
  const candidates: WalkCandidate[] = [];
  for (const dirent of await readDirEntries(dir)) {
    const entry = toDirEntry(state, dir, dirent, childDepth);
    if (!entry) {
      continue;
    }
    if (shouldSkipDirectory(dirent, state)) {
      entry.skipped = true;
      state.skippedDirectories.add(entry.path);
    }
    candidates.push({
      abs: dir + NATIVE_SEP + dirent.name,
      dirent,
      entry,
    });
  }
  return sortCandidates(candidates);
}

function stopAtEntryLimit(state: WalkState): boolean {
  if (state.entries.length < state.maxEntries) {
    return false;
  }
  state.truncated = true;
  return true;
}

function appendCandidateEntries(
  candidates: WalkCandidate[],
  state: WalkState
): boolean {
  let index = 0;
  for (const candidate of candidates) {
    if (stopAtEntryLimit(state)) {
      return false;
    }
    state.entries.push(candidate.entry);
    if (
      state.entries.length >= state.maxEntries &&
      index < candidates.length - 1
    ) {
      state.truncated = true;
      return false;
    }
    index += 1;
  }
  return true;
}

function shouldQueueDirectory(
  candidate: WalkCandidate,
  state: WalkState
): boolean {
  if (
    candidate.entry.type !== "directory" ||
    candidate.entry.skipped ||
    candidate.dirent.isSymbolicLink()
  ) {
    return false;
  }
  if (candidate.entry.depth && candidate.entry.depth > state.maxDepth) {
    state.truncated = true;
    return false;
  }
  return true;
}

function enqueueSubdirectories(
  candidates: WalkCandidate[],
  queue: Array<{ dir: string; depth: number }>,
  currentDepth: number,
  state: WalkState
): void {
  for (const candidate of candidates) {
    if (!shouldQueueDirectory(candidate, state)) {
      continue;
    }
    queue.push({
      dir: candidate.abs,
      depth: candidate.entry.depth ?? currentDepth + 1,
    });
  }
}

async function walkDirectoryBreadthFirst(
  targetPath: string,
  state: WalkState
): Promise<void> {
  const queue: Array<{ dir: string; depth: number }> = [
    { dir: targetPath, depth: 0 },
  ];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      break;
    }
    if (current.depth > state.maxDepth) {
      state.truncated = true;
      continue;
    }

    const candidates = await readCandidates(
      current.dir,
      current.depth + 1,
      state
    );

    if (!appendCandidateEntries(candidates, state)) {
      return;
    }

    if (!state.recursive) {
      continue;
    }

    enqueueSubdirectories(candidates, queue, current.depth, state);
  }
}

/**
 * Tool definition for directory listing requests.
 */
export const listDirTool: InitToolDefinition<"list-dir"> = {
  operation: "list-dir",
  describe: () => "Listing directory...",
  execute: listDir,
};
