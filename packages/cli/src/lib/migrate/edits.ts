/**
 * Edit construction and application.
 *
 * ### One parse per task, and edits must not overlap within it
 *
 * A task sees one parse of a file and returns every edit it wants at once, so
 * two edits from the same task over the same region are a bug in that task and
 * throw rather than mis-apply. Two identical edits are not a conflict. Babel
 * emits two nodes over one range for shorthand syntax (`{ x }`,
 * `export { x }`), so a rename that visits both produces the same replacement
 * twice, and applying it once is what the task meant either way.
 *
 * The one case where edits genuinely interact is removal from a
 * comma-separated list, where each removed entry has to claim a separator.
 * Those go through `removeEntries` and are computed together. See its
 * docstring.
 */

import type { Node, ObjectExpression, ObjectProperty } from "@babel/types";
import { rangeOf } from "./ast.js";
import type { Edit } from "./types.js";

const WHITESPACE = /\s/;
const LEADING_INDENT = /^[ \t]*/;

function sameEdit(a: Edit, b: Edit): boolean {
  return a.start === b.start && a.end === b.end && a.text === b.text;
}

/**
 * Apply edits to a source string.
 *
 * Exact duplicates are collapsed; see the module docstring.
 *
 * @throws if two edits overlap without being identical, which indicates a bug
 * in the task that produced them.
 */
export function applyEdits(source: string, edits: Edit[]): string {
  if (edits.length === 0) {
    return source;
  }

  const sorted = [...edits].sort((a, b) => a.start - b.start || a.end - b.end);
  const applied: Edit[] = [];

  for (const current of sorted) {
    const previous = applied.at(-1);
    if (previous && sameEdit(previous, current)) {
      continue;
    }
    if (previous && current.start < previous.end) {
      throw new Error(
        `overlapping edits at ${current.start} (previous ends at ${previous.end})`
      );
    }
    applied.push(current);
  }

  let result = "";
  let cursor = 0;
  for (const edit of applied) {
    result += source.slice(cursor, edit.start) + edit.text;
    cursor = edit.end;
  }
  return result + source.slice(cursor);
}

export function replaceNode(node: Node, text: string): Edit {
  const { start, end } = rangeOf(node);
  return { start, end, text };
}

/** Index of the first character on the line containing `index`. */
function lineStart(source: string, index: number): number {
  return source.lastIndexOf("\n", Math.max(0, index - 1)) + 1;
}

/** Leading whitespace of the line containing `index`. */
export function indentAt(source: string, index: number): string {
  const start = lineStart(source, index);
  const match = LEADING_INDENT.exec(source.slice(start, index));
  return match ? match[0] : "";
}

/**
 * Lift a block of source out by one indentation level.
 *
 * Moving a nested property up to its parent leaves every continuation line of
 * a multi-line value one level too deep. Reformatting the file would fix that
 * and bury the real change in noise, so only the moved block's own
 * continuation lines are adjusted.
 *
 * @param outer indentation of the destination
 * @param extra how much deeper the block currently sits
 */
export function dedentBlock(
  text: string,
  outer: string,
  extra: string
): string {
  if (extra === "") {
    return text;
  }
  return text.replaceAll(`\n${outer}${extra}`, `\n${outer}`);
}

/**
 * Indentation depth of `inner` relative to `outer`, or `""` when `inner` is
 * not simply `outer` plus more of the same whitespace.
 */
export function indentDelta(outer: string, inner: string): string {
  return inner.startsWith(outer) ? inner.slice(outer.length) : "";
}

/**
 * Remove a property from an object literal, taking its separator and its line
 * with it.
 *
 * Deleting only the property's own range leaves `{ , dsn: "..." }` or a blank
 * indented line, and either turns a clean migration into something the user
 * has to tidy by hand. Reformatting the whole file instead would bury the real
 * change in noise.
 */
export function removeProperty(
  source: string,
  object: ObjectExpression,
  property: Node
): Edit {
  return removeFromList(source, object.properties, property);
}

/**
 * Remove one entry from a comma-separated list of nodes, along with its
 * separator and, when it had one to itself, its line. Works on object
 * properties, import specifiers and array elements.
 *
 * Removing more than one entry from the same list needs `removeEntries`.
 */
export function removeFromList(
  source: string,
  siblings: readonly Node[],
  target: Node
): Edit {
  const [edit] = removeEntries(source, siblings, [target]);
  return edit ?? { ...rangeOf(target), text: "" };
}

/**
 * Remove several entries from one comma-separated list.
 *
 * Removals from the same list cannot be computed one at a time. An entry with
 * a neighbour after it claims the comma that follows it, while the last entry
 * reaches back for the comma before it. Remove two adjacent entries
 * independently and both claim the same comma, so `applyEdits` rejects the
 * overlap. Ordinary input hits this: `import { a, b, c }` dropping `b` and
 * `c`, or an inline options object losing its last two keys.
 *
 * Computed together, each contiguous run becomes one edit claiming exactly one
 * separator. That is also the only correct answer. `{ a, b, c }` losing `b`
 * and `c` has to take the comma after `a`, and neither removal owns that comma
 * on its own.
 */
export function removeEntries(
  source: string,
  siblings: readonly Node[],
  targets: readonly Node[]
): Edit[] {
  const doomed = new Set(targets);
  const runs: Node[][] = [];
  let run: Node[] = [];
  let survivors = 0;

  for (const sibling of siblings) {
    if (doomed.has(sibling)) {
      run.push(sibling);
      continue;
    }
    survivors += 1;
    if (run.length > 0) {
      runs.push(run);
      run = [];
    }
  }
  if (run.length > 0) {
    runs.push(run);
  }

  return runs.map((entries) => {
    const first = entries[0] as Node;
    const last = entries.at(-1) as Node;
    const own = { start: rangeOf(first).start, end: rangeOf(last).end };
    return {
      ...consumeOwnLine(source, consumeSeparator(source, own, survivors > 0)),
      text: "",
    };
  });
}

type Range = { start: number; end: number };

/**
 * Extend a range over the comma that separated the entry from its neighbour.
 *
 * Prefers the trailing comma. Only the last entry in a list reaches back for
 * the preceding one, and a sole entry has no separator to take.
 */
function consumeSeparator(
  source: string,
  own: Range,
  hasSiblings: boolean
): Range {
  let after = own.end;
  while (after < source.length && WHITESPACE.test(source[after] ?? "")) {
    after += 1;
  }

  if (source[after] === ",") {
    let end = after + 1;
    // Also take the space that separated it from the next entry, so an inline
    // `{ a, b }` closes up to `{ b }` rather than `{  b }`. Newlines are left
    // alone, since `consumeOwnLine` owns that case.
    while (source[end] === " " || source[end] === "\t") {
      end += 1;
    }
    return { start: own.start, end };
  }

  if (!hasSiblings) {
    return own;
  }

  let before = own.start - 1;
  while (before >= 0 && WHITESPACE.test(source[before] ?? "")) {
    before -= 1;
  }
  return source[before] === "," ? { start: before, end: own.end } : own;
}

/**
 * Extend a range over its whole line, when the entry had the line to itself.
 * Otherwise a removal leaves a blank indented line behind, which turns a clean
 * migration into something the user has to tidy by hand.
 */
function consumeOwnLine(source: string, range: Range): Range {
  let trailing = range.end;
  while (source[trailing] === " " || source[trailing] === "\t") {
    trailing += 1;
  }
  if (source[trailing] !== "\n") {
    return range;
  }

  const openingLine = lineStart(source, range.start);
  if (source.slice(openingLine, range.start).trim() !== "") {
    return range;
  }
  return { start: openingLine, end: trailing + 1 };
}

/** Rename a property's key, leaving its value untouched. */
export function renameProperty(property: ObjectProperty, name: string): Edit {
  return replaceNode(property.key, name);
}

/**
 * Insert a property at the start of an object literal.
 *
 * Prepending rather than appending is deliberate. A task that relocates an
 * option removes one property and adds another in the same pass. Anchoring the
 * insertion on the last property would collide with a removal of that same
 * last property, since `removeProperty` reaches backwards to swallow the
 * preceding comma. The position just after `{` is the one anchor no property
 * removal can overlap.
 */
export function prependProperty(
  source: string,
  object: ObjectExpression,
  text: string
): Edit {
  const open = rangeOf(object).start;
  const first = object.properties[0];
  const indent = first ? indentAt(source, rangeOf(first).start) : "  ";
  return {
    start: open + 1,
    end: open + 1,
    text: `\n${indent}${text},`,
  };
}

/** The statement or declaration enclosing a node, for comment placement. */
function enclosingStatement(source: string, node: Node): number {
  // Walking up would need parent links the parser does not provide, so
  // anchor on the node's own line instead. In practice the interesting nodes
  // (properties, call arguments, import specifiers) sit on their own line in
  // any formatted config file, which is what this is for.
  return lineStart(source, rangeOf(node).start);
}

/**
 * Build an `annotate` bound to one migration's marker.
 *
 * The marker names the migration that wrote the comment, so it belongs to the
 * migration rather than to this module. Hardcoding one here would leave every
 * future migration leaving the first one's marker in a user's source.
 *
 * The returned function will not stack duplicate comments on a re-run.
 * `sentry migrate` promises to be safe to run again, and a user who runs it
 * twice should get an unchanged tree the second time.
 */
export function annotator(
  marker: string
): (source: string, node: Node, message: string) => Edit[] {
  return (source, node, message) => {
    const at = enclosingStatement(source, node);
    if (alreadyAnnotated(marker, source, at, message)) {
      return [];
    }
    const indent = indentAt(source, rangeOf(node).start);
    return [
      { start: at, end: at, text: `${indent}// ${marker}: ${message}\n` },
    ];
  };
}

/**
 * Whether this exact message already sits in the run of marker comments above
 * `at`.
 *
 * Scans the whole contiguous run, not just the line immediately before. One
 * node can attract several annotations, since an import of two removed symbols
 * gets one each. Checking a single line would re-add every annotation but the
 * last on each subsequent run.
 */
function alreadyAnnotated(
  marker: string,
  source: string,
  at: number,
  message: string
): boolean {
  let cursor = at;
  while (cursor > 0) {
    const previousStart = lineStart(source, cursor - 1);
    const previousLine = source.slice(previousStart, cursor);
    if (!previousLine.includes(marker)) {
      return false;
    }
    if (previousLine.includes(`${marker}: ${message}`)) {
      return true;
    }
    cursor = previousStart;
  }
  return false;
}
