import fs from "node:fs";
import path from "node:path";
import { NODE_MODULES_DIRNAME } from "../../constants.js";
import { normalizePath } from "../../scan/index.js";
import type { DirEntry, ListDirPayload, ToolResult } from "../types.js";
import { safePath } from "./shared.js";
import type { InitToolDefinition } from "./types.js";

const NATIVE_SEP = path.sep;

/**
 * List files and directories within the workflow sandbox.
 *
 * Paths in the result are POSIX-normalized (`/`-separated) regardless
 * of host OS, so the Mastra agent sees a consistent wire shape.
 */
export async function listDir(payload: ListDirPayload): Promise<ToolResult> {
  const { cwd, params } = payload;
  const targetPath = safePath(cwd, params.path);
  const maxDepth = params.maxDepth ?? 3;
  const maxEntries = params.maxEntries ?? 500;
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
  };

  await walkDirectory(targetPath, 0, state);
  return { ok: true, data: { entries: state.entries } };
}

type WalkState = {
  cwd: string;
  cwdPrefixLen: number;
  entries: DirEntry[];
  maxDepth: number;
  maxEntries: number;
  recursive: boolean;
};

async function readDirEntries(dir: string): Promise<fs.Dirent[]> {
  try {
    return await fs.promises.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function shouldRecurseInto(entry: fs.Dirent, state: WalkState): boolean {
  return (
    state.recursive &&
    entry.isDirectory() &&
    !entry.isSymbolicLink() &&
    !entry.name.startsWith(".") &&
    entry.name !== NODE_MODULES_DIRNAME
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
  entry: fs.Dirent
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
  };
}

async function walkDirectory(
  dir: string,
  depth: number,
  state: WalkState
): Promise<void> {
  if (depth > state.maxDepth || state.entries.length >= state.maxEntries) {
    return;
  }

  for (const entry of await readDirEntries(dir)) {
    if (state.entries.length >= state.maxEntries) {
      return;
    }
    const nextEntry = toDirEntry(state, dir, entry);
    if (!nextEntry) {
      continue;
    }
    state.entries.push(nextEntry);
    if (shouldRecurseInto(entry, state)) {
      await walkDirectory(dir + NATIVE_SEP + entry.name, depth + 1, state);
    }
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
