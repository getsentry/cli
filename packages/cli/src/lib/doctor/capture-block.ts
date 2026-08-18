/**
 * One block scanner for every platform doctor understands.
 *
 * Every init call and build config we care about has the same shape: a marker
 * followed by a delimited block. Keeping the delimiters as table data instead
 * of per-platform code is what stops this file from growing a branch every
 * time a new SDK ships.
 */

import type { CapturedKey } from "./types.js";

/** Delimiter style. `ruby` is keyword-delimited (`do` … `end`). */
export type BlockDelims = "brace" | "paren" | "ruby";

/** A captured span: 1-based start line plus the verbatim text. */
export type BlockSpan = { line: number; text: string };

const PAIRS: Record<"brace" | "paren", readonly [string, string]> = {
  brace: ["{", "}"],
  paren: ["(", ")"],
};

/** Advance past a quoted string starting at `i`. */
function skipString(content: string, i: number): number {
  const quote = content[i];
  let j = i + 1;
  while (j < content.length) {
    if (content[j] === "\\") {
      j += 2;
      continue;
    }
    if (content[j] === quote) {
      return j + 1;
    }
    j += 1;
  }
  return content.length;
}

/** Advance past the rest of the current line. */
function skipLine(content: string, i: number): number {
  const next = content.indexOf("\n", i);
  return next === -1 ? content.length : next + 1;
}

/** If `i` points at a quote or comment leader, return the index past it. */
function trySkip(content: string, i: number): number | null {
  const ch = content[i];
  if (ch === '"' || ch === "'" || ch === "`") {
    return skipString(content, i);
  }
  if (ch === "/" && content[i + 1] === "/") {
    return skipLine(content, i);
  }
  if (ch === "#") {
    return skipLine(content, i);
  }
  return null;
}

/** Balance a paired delimiter, ignoring strings and line comments. */
function scanPairs(
  content: string,
  from: number,
  [open, close]: readonly [string, string]
): number | null {
  const start = content.indexOf(open, from);
  if (start === -1) {
    return null;
  }

  let depth = 0;
  let i = start;
  while (i < content.length) {
    const skipped = trySkip(content, i);
    if (skipped !== null) {
      i = skipped;
      continue;
    }
    const ch = content[i];
    if (ch === open) {
      depth += 1;
    } else if (ch === close) {
      depth -= 1;
      if (depth === 0) {
        return i + 1;
      }
    }
    i += 1;
  }
  return null;
}

/**
 * Ruby keyword blocks. Strings and comments are alternates in the same regex
 * so a `do` inside either never counts.
 *
 * ponytail: token counting, not parsing. A modifier `if` (`x = 1 if y`)
 * falsely opens a block. When that happens the block never balances, we return
 * null, and the caller `skip`s — never a false `fail`. Upgrade to a real lexer
 * only if fixtures show this misfiring in practice.
 */
const RUBY_TOKEN_RE =
  /\b(do|def|if|unless|case|begin|while|until|class|module|end)\b|#[^\n]*|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g;

function scanRubyBlock(content: string, from: number): number | null {
  RUBY_TOKEN_RE.lastIndex = from;
  let depth = 0;
  let match = RUBY_TOKEN_RE.exec(content);

  while (match !== null) {
    const token = match[1];
    if (token !== undefined) {
      if (token === "end") {
        depth -= 1;
        if (depth === 0) {
          return match.index + "end".length;
        }
      } else {
        depth += 1;
      }
    }
    match = RUBY_TOKEN_RE.exec(content);
  }
  return null;
}

/**
 * Find `marker` in `content` and capture the delimited block that follows.
 * Returns `null` when the marker is absent or the block never closes — both of
 * which the caller must surface as `skip`, never `fail`.
 */
export function captureBlock(
  content: string,
  marker: RegExp,
  delims: BlockDelims
): BlockSpan | null {
  const probe = new RegExp(marker.source, marker.flags.replace("g", ""));
  const match = probe.exec(content);
  if (!match) {
    return null;
  }

  const start = match.index;
  const afterMarker = start + match[0].length;
  const end =
    delims === "ruby"
      ? scanRubyBlock(content, afterMarker)
      : scanPairs(content, start, PAIRS[delims]);

  if (end === null) {
    return null;
  }

  return {
    line: content.slice(0, start).split("\n").length,
    text: content.slice(start, end),
  };
}

/** `key: value`, `key = value`, and `KEY=value`, one per capture. */
const KEY_ASSIGN_RE = /(?:^|[\s,{(])([A-Za-z_][\w.]*)\s*[:=]\s*([^\n,]+)/gm;

const QUOTED_RE = /^(["'`])([\s\S]*)\1$/;
const BOOLEAN_RE = /^(true|false)$/i;
const NUMBER_RE = /^-?\d+(?:\.\d+)?$/;
const TRAILING_PUNCT_RE = /[,;]+$/;

/**
 * `dynamic: true` means "the key is present but its value is an expression we
 * refused to evaluate." Checks must treat that as unknown, not as absent —
 * `dsn: process.env.SENTRY_DSN` is a configured DSN, just not a readable one.
 */
function classifyValue(raw: string): CapturedKey {
  const quoted = QUOTED_RE.exec(raw);
  if (quoted?.[2] !== undefined) {
    return { value: quoted[2], dynamic: false };
  }
  if (BOOLEAN_RE.test(raw)) {
    return { value: raw.toLowerCase(), dynamic: false };
  }
  if (NUMBER_RE.test(raw)) {
    return { value: raw, dynamic: false };
  }
  return { dynamic: true };
}

/** Pull scalar keys out of a captured block. First occurrence wins. */
export function extractKeys(text: string): Record<string, CapturedKey> {
  const keys: Record<string, CapturedKey> = {};
  KEY_ASSIGN_RE.lastIndex = 0;

  let match = KEY_ASSIGN_RE.exec(text);
  while (match !== null) {
    const qualified = match[1] ?? "";
    const name = qualified.split(".").pop() ?? qualified;
    const raw = (match[2] ?? "").trim().replace(TRAILING_PUNCT_RE, "");

    if (name && !(name in keys)) {
      keys[name] = classifyValue(raw);
    }
    match = KEY_ASSIGN_RE.exec(text);
  }

  return keys;
}
