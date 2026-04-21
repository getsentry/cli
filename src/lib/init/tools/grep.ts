/**
 * Init-wizard `grep` tool adapter.
 *
 * Thin wrapper over `collectGrep` from `src/lib/scan/`. Historically
 * this file contained a `rg → git grep → fs walk` fallback chain with
 * ~300 LOC of subprocess-spawn plumbing; that was all replaced by the
 * pure-TS scanner shipped in PR #791. This adapter now just:
 *
 * 1. Sandboxes the user-supplied `search.path` via `safePath`.
 * 2. Forwards each `GrepSearch` to `collectGrep` with the wire-level
 *    constants (`maxResults`, `maxLineLength`) plumbed through.
 * 3. Strips the `absolutePath` field from each `GrepMatch` before
 *    returning — the Mastra wire contract has never included it.
 * 4. Catches `ValidationError` from `compilePattern` so a bad regex
 *    from the agent surfaces as an empty result for that search
 *    (rather than taking down the whole payload).
 */

import { ValidationError } from "../../errors.js";
import { collectGrep } from "../../scan/index.js";
import type { GrepPayload, GrepSearch, ToolResult } from "../types.js";
import { safePath } from "./shared.js";
import type { InitToolDefinition } from "./types.js";

const MAX_GREP_RESULTS_PER_SEARCH = 100;
const MAX_GREP_LINE_LENGTH = 2000;

/** Per-match shape on the wire — no `absolutePath`, by contract. */
type WireGrepMatch = { path: string; lineNum: number; line: string };

type SearchResult = {
  pattern: string;
  matches: WireGrepMatch[];
  truncated: boolean;
};

/**
 * Run one `GrepSearch`. Throws if `safePath` rejects `search.path`;
 * caller (`grep`) hoists the throw to the registry's error path.
 */
async function runOneSearch(
  cwd: string,
  search: GrepSearch,
  maxResults: number
): Promise<SearchResult> {
  // Validate the subpath against the sandbox. `safePath` throws on
  // escape attempts — the scan engine explicitly trusts its `path`
  // input (see `src/lib/scan/types.ts::GrepOptions.path`), so the
  // adapter is the correct place to enforce sandboxing. We only need
  // the validation side effect; `collectGrep` takes a cwd-relative
  // subpath, so we pass `search.path` through unchanged afterward.
  if (search.path !== undefined) {
    safePath(cwd, search.path);
  }

  try {
    const { matches, stats } = await collectGrep({
      cwd,
      pattern: search.pattern,
      include: search.include,
      path: search.path,
      // `caseInsensitive` is the wire shape; the scan engine exposes
      // the inverse (`caseSensitive`). Pass `undefined` when the
      // caller didn't set it so the engine's default (rg-like,
      // case-sensitive) takes effect.
      caseSensitive: search.caseInsensitive === true ? false : undefined,
      multiline: search.multiline,
      maxResults,
      maxLineLength: MAX_GREP_LINE_LENGTH,
    });
    return {
      pattern: search.pattern,
      // Strip `absolutePath` — not part of the Mastra wire contract.
      matches: matches.map((m) => ({
        path: m.path,
        lineNum: m.lineNum,
        line: m.line,
      })),
      truncated: stats.truncated,
    };
  } catch (error) {
    if (error instanceof ValidationError) {
      // Malformed regex from the agent. Surface as an empty row for
      // this search rather than aborting the whole payload — lets the
      // agent retry with a corrected pattern.
      return { pattern: search.pattern, matches: [], truncated: false };
    }
    throw error;
  }
}

/**
 * Search project files for one or more regex patterns.
 *
 * Searches run in parallel via `Promise.all` — preserves the
 * concurrency shape of the pre-PR implementation.
 */
export async function grep(payload: GrepPayload): Promise<ToolResult> {
  const maxResults =
    payload.params.maxResultsPerSearch ?? MAX_GREP_RESULTS_PER_SEARCH;
  const results = await Promise.all(
    payload.params.searches.map((search) =>
      runOneSearch(payload.cwd, search, maxResults)
    )
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
