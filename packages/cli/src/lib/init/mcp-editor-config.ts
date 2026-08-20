/**
 * Project-scoped Sentry MCP editor config.
 *
 * Writes (or merges into) an editor's MCP config file so the Sentry MCP server
 * is available to that editor's coding agent. Offered as a next step on the
 * completion screen. Filesystem-only — no network, no process spawning — so it
 * runs safely from within the wizard.
 *
 * Lives in the main bundle (imported by `ink-ui.ts`, never by the Ink sidecar)
 * because it uses Node built-ins.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import type { McpEditor } from "./ui/types.js";

type EditorSpec = {
  /** Config file path, relative to the project directory. */
  file: string;
  /** Merge the Sentry MCP entry into existing (possibly absent) config JSON. */
  merge: (existing: Record<string, unknown> | null, url: string) => unknown;
};

/** Merge a `Sentry` entry into a `{ <containerKey>: { ... } }` config shape. */
function mergeServerEntry(
  existing: Record<string, unknown> | null,
  containerKey: string,
  entry: unknown
): Record<string, unknown> {
  const base = existing ?? {};
  const container = (base[containerKey] ?? {}) as Record<string, unknown>;
  return { ...base, [containerKey]: { ...container, Sentry: entry } };
}

const EDITOR_SPECS: Record<McpEditor, EditorSpec> = {
  cursor: {
    file: path.join(".cursor", "mcp.json"),
    merge: (existing, url) => mergeServerEntry(existing, "mcpServers", { url }),
  },
  vscode: {
    file: path.join(".vscode", "mcp.json"),
    merge: (existing, url) =>
      mergeServerEntry(existing, "servers", { url, type: "http" }),
  },
  "claude-code": {
    file: ".mcp.json",
    merge: (existing, url) => mergeServerEntry(existing, "mcpServers", { url }),
  },
};

async function readJsonIfExists(
  file: string
): Promise<Record<string, unknown> | null> {
  try {
    const parsed = JSON.parse(await fs.readFile(file, "utf8"));
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    // Missing file or unparseable JSON — start fresh rather than clobbering
    // silently. (A missing file is the common case; malformed JSON is rare.)
    return null;
  }
}

/**
 * Write the project-scoped Sentry MCP config for `editor`, merging into any
 * existing file. Never throws — returns false when it couldn't write.
 */
export async function writeMcpConfig(
  editor: McpEditor,
  mcp: { url: string } | undefined,
  projectDir: string | undefined
): Promise<boolean> {
  if (!(mcp?.url && projectDir)) {
    return false;
  }
  try {
    const spec = EDITOR_SPECS[editor];
    const target = path.join(projectDir, spec.file);
    const existing = await readJsonIfExists(target);
    const merged = spec.merge(existing, mcp.url);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
    return true;
  } catch {
    return false;
  }
}
