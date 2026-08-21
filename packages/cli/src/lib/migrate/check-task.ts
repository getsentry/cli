/**
 * Tasks that can only point at the work.
 *
 * Some breaking changes cannot be fixed by a codemod and cannot be found by
 * parsing either. The fix lives in a container image, a deployment config, a
 * template, or in what a callback means rather than what it says. A check task
 * locates candidate files by glob and pattern, and reports each one with the
 * line the pattern hit and the text that matched.
 *
 * The matching is deliberately broad, and the generated report says so. For a
 * change that cannot be automated, a false positive costs the reader a minute
 * while a miss costs them a silent breaking change.
 *
 * A check is an ordinary task, declaring what it looks for and finding it by
 * reading the project. So `--only` and `--skip` reach it, it appears in the
 * report under its own heading, and nothing else has to know it is a different
 * kind of thing.
 */

import type { TaskApi } from "./api.js";
import { defineMigrationTask, type MigrationTask } from "./framework.js";

export type PatternSet = {
  include: string | string[];
  patterns: Array<string | RegExp>;
};

export type CheckTaskOptions = PatternSet & {
  id: string;
  /** Heading this check gets in the report. */
  description: string;
  /** What the reader has to do. Shown above the locations. */
  guidance: string;
  /** Section of the upgrade guide this covers. */
  docs?: string;
  /**
   * Independent evidence the check needs before it reports anything.
   *
   * Some patterns are common well outside the change they describe, so
   * matching one proves nothing on its own. Gating on the SDK package that
   * makes the change apply is what keeps a framework-specific entry out of an
   * unrelated project's checklist.
   */
  when?: PatternSet;
};

type Hit = { line: number; text: string };

/** Longest match the report will quote before truncating it. */
const MATCH_PREVIEW = 60;

function firstMatch(
  content: string,
  patterns: Array<string | RegExp>
): Hit | null {
  let best: { index: number; text: string } | null = null;

  for (const pattern of patterns) {
    const found = matchOnce(content, pattern);
    if (found && (!best || found.index < best.index)) {
      best = found;
    }
  }

  return best ? { line: lineOf(content, best.index), text: best.text } : null;
}

function matchOnce(
  content: string,
  pattern: string | RegExp
): { index: number; text: string } | null {
  if (typeof pattern === "string") {
    const index = content.indexOf(pattern);
    return index < 0 ? null : { index, text: pattern };
  }
  // A sticky or global regex would carry `lastIndex` over from the last file.
  const stateless = new RegExp(
    pattern.source,
    pattern.flags.replace(/[gy]/g, "")
  );
  const match = stateless.exec(content);
  return match ? { index: match.index, text: match[0] } : null;
}

/** 1-indexed, counted without splitting the file. */
function lineOf(content: string, index: number): number {
  let line = 1;
  for (
    let at = content.indexOf("\n");
    at >= 0 && at < index;
    at = content.indexOf("\n", at + 1)
  ) {
    line += 1;
  }
  return line;
}

function anyMatch(api: TaskApi, set: PatternSet): boolean {
  let found = false;
  api.files({ include: set.include }, (content) => {
    found = found || firstMatch(content, set.patterns) !== null;
    // Reporting reads; it never rewrites.
    return false;
  });
  return found;
}

/** A task that finds candidate files for a change it cannot make. */
export function defineCheckTask(options: CheckTaskOptions): MigrationTask {
  return defineMigrationTask({
    id: options.id,
    description: options.description,
    guidance: options.guidance,
    docs: options.docs,
    run: ({ api }) => {
      if (options.when && !anyMatch(api, options.when)) {
        return;
      }
      api.files({ include: options.include }, (content, file) => {
        const hit = firstMatch(content, options.patterns);
        if (hit) {
          api.manual(`matches \`${preview(hit.text)}\``, {
            file,
            line: hit.line,
          });
        }
        return false;
      });
    },
  });
}

function preview(text: string): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed.length > MATCH_PREVIEW
    ? `${collapsed.slice(0, MATCH_PREVIEW)}…`
    : collapsed;
}
