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

  const entries: DirEntry[] = [];

  async function walk(dir: string, depth: number): Promise<void> {
    if (entries.length >= maxEntries || depth > maxDepth) {
      return;
    }

    let dirEntries: fs.Dirent[];
    try {
      dirEntries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of dirEntries) {
      if (entries.length >= maxEntries) {
        return;
      }

      const relPath = path.relative(cwd, path.join(dir, entry.name));

      if (entry.isSymbolicLink()) {
        try {
          safePath(cwd, relPath);
        } catch {
          continue;
        }
      }

      const type = entry.isDirectory() ? "directory" : "file";
      entries.push({ name: entry.name, path: relPath, type });

      if (
        recursive &&
        entry.isDirectory() &&
        !entry.isSymbolicLink() &&
        !entry.name.startsWith(".") &&
        entry.name !== "node_modules"
      ) {
        await walk(path.join(dir, entry.name), depth + 1);
      }
    }
  }

  await walk(targetPath, 0);
  return { ok: true, data: { entries } };
}

/**
 * Tool definition for directory listing requests.
 */
export const listDirTool: InitToolDefinition<"list-dir"> = {
  operation: "list-dir",
  describe: () => "Listing directory...",
  execute: listDir,
};

