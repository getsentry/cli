/**
 * Conservative literal-prefix extractor for grep's fast path.
 *
 * Walks a regex source looking for the longest contiguous run of
 * non-metacharacter literal bytes that every match must contain.
 * When found, the grep engine can scan the file for that literal via
 * the vastly cheaper `String.prototype.indexOf` and only invoke the
 * regex engine on lines that contain a candidate — ripgrep's central
 * perf trick, adapted to pure JS.
 *
 * ### Extraction rules (conservative; safety over completeness)
 *
 * A literal is "safe" if every match of the regex must contain that
 * exact byte sequence. We bail out on anything that could produce
 * matches without the candidate literal:
 *
 * - Top-level alternation (`foo|bar`): any branch could match, no
 *   single literal is required. v1 rejects these; v2 could return a
 *   Set and probe with multiple `indexOf` calls.
 * - Character class `[abc]`: the class matches any of its members;
 *   no single byte is required.
 * - Capturing / non-capturing group `(foo)`, `(?:foo)`: the content
 *   MIGHT be useful but its enclosure complicates extraction; v1
 *   extracts outside groups only.
 * - Quantifier `?`, `*`, `+`, `{0,n}`: the quantified atom may not
 *   appear. Drop the preceding character and break the current run.
 *   (For `{1,n}` and `{n,}` with n≥1 the preceding atom IS required,
 *   but v1 doesn't distinguish — all quantifiers break the run.)
 * - Escape sequences `\d`, `\w`, `\s`, etc.: not literal; break the
 *   run. Escaped literal chars (`\.`, `\/`, `\(`) could be included
 *   but v1 takes the safe path and breaks the run on any `\`.
 * - Anchors `^`, `$`: not bytes in the match; break the run without
 *   invalidating the prefix/suffix.
 * - Lookaround `(?=…)`, `(?!…)`, `(?<=…)`, `(?<!…)`: the assertion's
 *   content isn't consumed. Negative lookarounds can invalidate
 *   literal-extraction-by-greedy-scan. v1 bails on any `(?…)`.
 *
 * ### Thresholds
 *
 * Returns null if the longest run is:
 * - Shorter than `MIN_LITERAL_LEN` (3 by default). Single/double
 *   characters match everywhere and the indexOf scan costs more
 *   than the regex engine saves.
 * - Made entirely of whitespace or punctuation (same reason).
 *
 * ### Match-everywhere false-positive rate
 *
 * When the extracted literal is rare (e.g., `Sentry.init` → `Sentry`),
 * the prefilter eliminates 95%+ of lines before touching the regex
 * engine. When the literal is common (e.g., `\sfoo\s` → `foo`), the
 * prefilter still narrows the search and the regex engine only runs
 * on lines containing `foo`.
 *
 * When the pattern is ITSELF a pure literal (no metachars, just
 * bytes), the extractor returns the whole pattern. The caller can
 * detect this and use `indexOf` alone, skipping the regex engine
 * entirely — see `isPureLiteral`.
 */

/**
 * Minimum length for an extracted literal. Shorter strings match too
 * frequently to be worth the prefilter overhead.
 */
const MIN_LITERAL_LEN = 3;

/** Metacharacters that break literal runs. */
const META_CHARS = new Set([
  ".",
  "^",
  "$",
  "|",
  "?",
  "*",
  "+",
  "(",
  ")",
  "[",
  "]",
  "{",
  "}",
  "\\",
]);

/** Quantifiers that mean "the preceding atom may not appear." */
const QUANTIFIER_CHARS = new Set(["?", "*", "+"]);

/** All-whitespace guard for extracted literals. */
const ALL_WHITESPACE_RE = /^\s+$/;

/** All-whitespace-or-punctuation guard (rejects literals that match everywhere). */
const ALL_PUNCTUATION_RE = /^[\s\p{P}]+$/u;

/**
 * Escape sequences where the following char represents itself as a
 * literal byte (e.g. `\.` is a literal dot). These are the escaped
 * metacharacters — everything in `META_CHARS` plus `/` (which is
 * common in regex literals) and `\\` (escaped backslash).
 *
 * Sequences NOT in this set (like `\d`, `\w`, `\b`, `\t`) are
 * character classes or anchors, not literals, and break the run.
 */
const ESCAPED_LITERAL_CHARS = new Set([
  ".",
  "^",
  "$",
  "|",
  "?",
  "*",
  "+",
  "(",
  ")",
  "[",
  "]",
  "{",
  "}",
  "\\",
  "/",
]);

/**
 * Extract a conservative literal prefix/substring from a regex
 * pattern. Returns null if no safe literal of `MIN_LITERAL_LEN` or
 * more characters can be extracted.
 *
 * Honors the `i` flag by lower-casing the literal — the caller
 * should also lower-case the haystack before searching.
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: single-pass parser over regex source; all branches are guarded cases
export function extractInnerLiteral(
  source: string,
  flags: string
): string | null {
  // Quick-reject: top-level alternation. Walk once checking for `|`
  // outside brackets/parens (rough; better than parsing the whole
  // regex). A false positive here just means we skip the prefilter —
  // no correctness issue.
  if (hasTopLevelAlternation(source)) {
    return null;
  }

  let best = "";
  let current = "";
  let i = 0;

  const commit = (): void => {
    if (current.length > best.length) {
      best = current;
    }
    current = "";
  };

  while (i < source.length) {
    const c = source[i];

    if (c === "\\") {
      // Escape sequence. If the next char is an escaped metacharacter
      // (`\.`, `\/`, `\\`, etc.), it represents a literal byte and
      // CAN extend the current run. Otherwise (`\d`, `\w`, `\b`,
      // `\t`, digit-escapes, etc.) it's a class/anchor — break.
      const next = source[i + 1];
      if (next !== undefined && ESCAPED_LITERAL_CHARS.has(next)) {
        current += next;
        i += 2;
        continue;
      }
      commit();
      i += 2;
      continue;
    }

    if (c === "[") {
      // Character class — content isn't a single required literal.
      commit();
      i = skipCharacterClass(source, i);
      continue;
    }

    if (c === "(") {
      // Group or lookaround — skip. v1 doesn't peek inside.
      commit();
      i = skipToMatching(source, i, "(", ")");
      continue;
    }

    if (QUANTIFIER_CHARS.has(c ?? "") || c === "{") {
      // The preceding character was quantified — it may not appear
      // in the actual match. Drop it from the current run.
      if (current.length > 0) {
        current = current.slice(0, -1);
      }
      commit();
      // Advance past the quantifier (and past `{n,m}` if present).
      i += 1;
      if (c === "{") {
        while (i < source.length && source[i] !== "}") {
          i += 1;
        }
        i += 1; // past the `}`
      } else if (source[i] === "?") {
        // Lazy quantifier `??`, `*?`, `+?`
        i += 1;
      }
      continue;
    }

    if (META_CHARS.has(c ?? "")) {
      // Other metacharacter (`.`, `^`, `$`): break the run but don't
      // drop anything from current.
      commit();
      i += 1;
      continue;
    }

    // Literal byte — extend the current run.
    current += c;
    i += 1;
  }
  commit();

  if (best.length < MIN_LITERAL_LEN) {
    return null;
  }
  if (ALL_WHITESPACE_RE.test(best) || ALL_PUNCTUATION_RE.test(best)) {
    // All whitespace or all punctuation — too high a match rate.
    return null;
  }

  return flags.includes("i") ? best.toLowerCase() : best;
}

/**
 * True if the regex pattern is itself a pure literal (no metachars
 * at all, just bytes). When this is true, the caller can skip the
 * regex engine entirely and use `indexOf` alone — the regex would
 * match exactly where the literal matches.
 */
export function isPureLiteral(source: string, flags: string): boolean {
  // The regex is a pure literal iff the extraction yields the whole
  // source unchanged (post-flag-adjustment). No metacharacters ever
  // appeared.
  const literal = extractInnerLiteral(source, flags);
  if (literal === null) {
    return false;
  }
  const bare = flags.includes("i") ? source.toLowerCase() : source;
  return literal === bare;
}

/**
 * Is there a top-level `|` (alternation) in the pattern?
 *
 * Character classes `[...]` are OPAQUE to this scan — their interior
 * contains literal bytes (including literal `(`, `)`, `|`) that must
 * not be interpreted as grouping or alternation metacharacters. We
 * skip the whole class in one step when `[` is seen.
 */
function hasTopLevelAlternation(source: string): boolean {
  let depthParen = 0;
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    if (c === "\\") {
      // Skip the escape sequence. An escaped char is never a
      // grouping/alternation metacharacter.
      i += 2;
      continue;
    }
    if (c === "[") {
      // Character class: content is opaque. Skip past the first
      // unescaped `]` (classes are NOT nestable — `[[]` matches a
      // single literal `[`). This prevents `[(]` from being
      // mistaken for an opening paren and corrupting `depthParen`,
      // which would hide a subsequent top-level `|` alternation.
      i = skipCharacterClass(source, i);
      continue;
    }
    if (c === "(") {
      depthParen += 1;
    } else if (c === ")") {
      depthParen -= 1;
    } else if (c === "|" && depthParen === 0) {
      return true;
    }
    i += 1;
  }
  return false;
}

/**
 * Advance past a character class `[...]` starting at `i`
 * (where `source[i] === "["`). Unlike parens/groups, `[` inside
 * `[...]` is NOT nestable — it's a literal `[` character. Only the
 * first unescaped `]` closes the class.
 *
 * Handles escape sequences (`\]` stays inside the class).
 *
 * Returns the index just past the closing `]`, or `source.length` if
 * the class is unterminated (malformed regex; caller should still
 * advance past it).
 */
function skipCharacterClass(source: string, i: number): number {
  let j = i + 1;
  while (j < source.length) {
    const c = source[j];
    if (c === "\\") {
      j += 2;
      continue;
    }
    if (c === "]") {
      return j + 1;
    }
    j += 1;
  }
  return j;
}

/**
 * Advance past a balanced `open`/`close` pair starting at `i`
 * (where `source[i] === open`). Handles nested pairs and escaped
 * chars. Returns the index just past the matching close.
 *
 * NOTE: Regex character classes `[...]` are NOT nestable — use
 * `skipCharacterClass` for those. This helper is for `(...)` groups.
 */
function skipToMatching(
  source: string,
  i: number,
  open: string,
  close: string
): number {
  let depth = 1;
  let j = i + 1;
  while (j < source.length && depth > 0) {
    const c = source[j];
    if (c === "\\") {
      j += 2;
      continue;
    }
    if (c === open) {
      depth += 1;
    } else if (c === close) {
      depth -= 1;
    }
    j += 1;
  }
  return j;
}
