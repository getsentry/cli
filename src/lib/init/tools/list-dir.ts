import fs from "node:fs";
import path from "node:path";
import type { DirEntry, ListDirPayload, ToolResult } from "../types.js";
import { safePath } from "./shared.js";
import type { InitToolDefinition } from "./types.js";

/**
 * List files and directories within the workflow sandbox.
 */
export async function listDir(payload: ListDirPayload): Promise<ToolResult> {
  const { cwd, params } = payload;
  const targetPath = safePath(cwd, params.path);
  const maxDepth = params.maxDepth ?? 3;
  const maxEntries = params.maxEntries ?? 500;
  const recursive = params.recursive ?? false;
  const walkState = {
    cwd,
    entries: [] as DirEntry[],
    maxDepth,
    maxEntries,
    recursive,
  };

  await walkDirectory(targetPath, 0, walkState);
  const { entries } = walkState;
  return { ok: true, data: { entries } };
}

type WalkState = {
  cwd: string;
  entries: DirEntry[];
  maxDepth: number;
  maxEntries: number;
  recursive: boolean;
};

function reachedWalkLimit(state: WalkState, depth: number): boolean {
  return state.entries.length >= state.maxEntries || depth > state.maxDepth;
}

async function readDirEntries(dir: string): Promise<fs.Dirent[]> {
  try {
    return await fs.promises.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function toDirEntry(
  cwd: string,
  dir: string,
  entry: fs.Dirent
): DirEntry | undefined {
  const relPath = path.relative(cwd, path.join(dir, entry.name));

  if (entry.isSymbolicLink()) {
    try {
      safePath(cwd, relPath);
    } catch {
      return;
    }
  }

  return {
    name: entry.name,
    path: relPath,
    type: entry.isDirectory() ? "directory" : "file",
  };
}

function shouldRecurseInto(entry: fs.Dirent, state: WalkState): boolean {
  return (
    state.recursive &&
    entry.isDirectory() &&
    !entry.isSymbolicLink() &&
    !entry.name.startsWith(".") &&
    entry.name !== "node_modules"
  );
}

async function walkDirectory(
  dir: string,
  depth: number,
  state: WalkState
): Promise<void> {
  if (reachedWalkLimit(state, depth)) {
    return;
  }

  const dirEntries = await readDirEntries(dir);
  for (const entry of dirEntries) {
    if (reachedWalkLimit(state, depth)) {
      return;
    }

    const nextEntry = toDirEntry(state.cwd, dir, entry);
    if (!nextEntry) {
      continue;
    }

    state.entries.push(nextEntry);
    if (!shouldRecurseInto(entry, state)) {
      continue;
    }

    await walkDirectory(path.join(dir, entry.name), depth + 1, state);
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
