/**
 * Init-wizard `glob` tool adapter.
 *
 * Thin wrapper over `collectGlob` from `src/lib/scan/`. Historically
 * this file contained a `rg --files → git ls-files → fs walk` fallback
 * chain with ~150 LOC of subprocess plumbing; all replaced by the
 * pure-TS scanner from PR #791. This adapter:
 *
 * 1. Sandboxes the user-supplied `params.path` via `safePath` (once,
 *    since it's shared across all patterns).
 * 2. Runs each pattern as a separate `collectGlob` call — the wire
 *    contract returns one result row per pattern, with its own
 *    `truncated` flag. `collectGlob` accepts a `patterns` array but
 *    unions them, which would lose per-pattern attribution.
 * 3. Passes each pattern's `files` + `truncated` straight through.
 */

import { collectGlob } from "../../scan/index.js";
import type { GlobPayload, ToolResult } from "../types.js";
import { safePath } from "./shared.js";
import type { InitToolDefinition } from "./types.js";

const MAX_GLOB_RESULTS = 100;

type PatternResult = {
  pattern: string;
  files: string[];
  truncated: boolean;
};

/**
 * Find files matching one or more glob patterns.
 *
 * Patterns run in parallel via `Promise.all` — preserves the
 * concurrency shape of the pre-PR implementation.
 */
export async function glob(payload: GlobPayload): Promise<ToolResult> {
  const maxResults = payload.params.maxResults ?? MAX_GLOB_RESULTS;

  // Validate the optional subpath once before spawning per-pattern
  // calls — a single throw aborts the whole payload, which matches
  // the registry's sandbox-reject contract.
  if (payload.params.path !== undefined) {
    safePath(payload.cwd, payload.params.path);
  }

  const results: PatternResult[] = await Promise.all(
    payload.params.patterns.map(async (pattern) => {
      const { files, truncated } = await collectGlob({
        cwd: payload.cwd,
        patterns: pattern,
        path: payload.params.path,
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
