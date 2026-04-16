import type { ReadFilesPayload, ToolResult } from "../types.js";
import { MAX_FILE_BYTES } from "../constants.js";
import { readSingleFile } from "./shared.js";
import type { InitToolDefinition } from "./types.js";

/**
 * Read one or more files from the sandboxed project directory.
 */
export async function readFiles(
  payload: ReadFilesPayload
): Promise<ToolResult> {
  const maxBytes = payload.params.maxBytes ?? MAX_FILE_BYTES;
  const results = await Promise.all(
    payload.params.paths.map(async (filePath) => {
      const content = await readSingleFile(payload.cwd, filePath, maxBytes);
      return [filePath, content] as const;
    })
  );

  const files: Record<string, string | null> = {};
  for (const [filePath, content] of results) {
    files[filePath] = content;
  }

  return { ok: true, data: { files } };
}

/**
 * Tool definition for batched file reads.
 */
export const readFilesTool: InitToolDefinition<"read-files"> = {
  operation: "read-files",
  describe: (payload) => {
    const [first, second] = payload.params.paths;
    if (!first) {
      return "Reading files...";
    }
    if (!second && payload.params.paths.length === 1) {
      return `Reading \`${pathBase(first)}\`...`;
    }
    if (payload.params.paths.length === 2 && second) {
      return `Reading \`${pathBase(first)}\`, \`${pathBase(second)}\`...`;
    }
    return `Reading ${payload.params.paths.length} files (\`${pathBase(first)}\`${second ? `, \`${pathBase(second)}\`` : ""}, ...)...`;
  },
  execute: readFiles,
};

function pathBase(filePath: string): string {
  const parts = filePath.split(/[/\\]/u);
  return parts.at(-1) ?? filePath;
}

