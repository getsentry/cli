/**
 * Markdown-to-Terminal Renderer
 *
 * Central utility for rendering markdown content as styled terminal output
 * using `marked` + `marked-terminal`. Provides `renderMarkdown()` and
 * `renderInlineMarkdown()` for rich text output, with automatic plain-mode
 * fallback when stdout is not a TTY or the user has opted out of rich output.
 *
 * Pre-rendered ANSI escape codes embedded in markdown source (e.g. inside
 * table cells) survive the pipeline — `cli-table3` computes column widths
 * via `string-width`, which correctly treats ANSI codes as zero-width.
 *
 * ## Output mode resolution (highest → lowest priority)
 *
 * 1. `SENTRY_PLAIN_OUTPUT=1` → plain (raw CommonMark)
 * 2. `SENTRY_PLAIN_OUTPUT=0` → rendered (force rich, even when piped)
 * 3. `NO_COLOR=1` (or any truthy value) → plain
 * 4. `NO_COLOR=0` (or any falsy value) → rendered
 * 5. `!process.stdout.isTTY` → plain
 * 6. default (TTY, no overrides) → rendered
 */

import chalk from "chalk";
import { type MarkedExtension, marked } from "marked";
import { markedTerminal as _markedTerminal } from "marked-terminal";

// @types/marked-terminal@6 describes the legacy class-based API; the package's
// actual markedTerminal() returns a {renderer, useNewRenderer} MarkedExtension
// object compatible with marked@15's marked.use().
const markedTerminal = _markedTerminal as unknown as (
  options?: Parameters<typeof _markedTerminal>[0]
) => MarkedExtension;

/** Sentinel-inspired color palette (mirrors colors.ts) */
const COLORS = {
  red: "#fe4144",
  green: "#83da90",
  yellow: "#FDB81B",
  blue: "#226DFC",
  cyan: "#79B8FF",
  muted: "#898294",
} as const;

marked.use(
  markedTerminal({
    // Map markdown elements to our Sentinel palette
    code: chalk.hex(COLORS.yellow),
    blockquote: chalk.hex(COLORS.muted).italic,
    heading: chalk.hex(COLORS.cyan).bold,
    firstHeading: chalk.hex(COLORS.cyan).bold,
    hr: chalk.hex(COLORS.muted),
    listitem: chalk.reset,
    table: chalk.reset,
    paragraph: chalk.reset,
    strong: chalk.bold,
    em: chalk.italic,
    codespan: chalk.hex(COLORS.yellow),
    del: chalk.dim.gray.strikethrough,
    link: chalk.hex(COLORS.blue),
    href: chalk.hex(COLORS.blue).underline,

    // No "§ " section prefix before headings
    showSectionPrefix: false,

    // Standard 80-column width; no reflow (let terminal wrap naturally)
    width: 80,
    reflowText: false,

    // Unescape HTML entities produced by the markdown parser
    unescape: true,

    // Render emoji shortcodes (e.g. :tada:)
    emoji: true,

    // Two-space tabs for code blocks
    tab: 2,
  })
);

/**
 * Returns true if an env var value should be treated as "truthy" for
 * purposes of enabling/disabling output modes.
 *
 * Falsy values: `"0"`, `"false"`, `""` (case-insensitive).
 * Everything else (e.g. `"1"`, `"true"`, `"yes"`) is truthy.
 */
function isTruthyEnv(val: string): boolean {
  const normalized = val.toLowerCase().trim();
  return normalized !== "0" && normalized !== "false" && normalized !== "";
}

/**
 * Determines whether output should be plain CommonMark markdown (no ANSI).
 *
 * Evaluated fresh on each call so tests can flip env vars between assertions
 * and changes to `process.stdout.isTTY` are picked up immediately.
 *
 * Priority (highest first):
 * 1. `SENTRY_PLAIN_OUTPUT` — explicit project-specific override
 * 2. `NO_COLOR` — widely-supported standard for disabling styled output
 * 3. `process.stdout.isTTY` — auto-detect interactive terminal
 */
export function isPlainOutput(): boolean {
  const plain = process.env.SENTRY_PLAIN_OUTPUT;
  if (plain !== undefined) {
    return isTruthyEnv(plain);
  }

  const noColor = process.env.NO_COLOR;
  if (noColor !== undefined) {
    return isTruthyEnv(noColor);
  }

  return !process.stdout.isTTY;
}

/**
 * Escape a string for safe use inside a markdown table cell.
 *
 * Escapes backslashes first (so the escape character itself is not
 * double-interpreted), then pipe characters (the table cell delimiter).
 *
 * @param value - Raw cell content
 * @returns Markdown-safe string suitable for embedding in `| cell |` syntax
 */
export function escapeMarkdownCell(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\|/g, "\\|");
}

/**
 * Render a full markdown document as styled terminal output, or return the
 * raw CommonMark string when in plain mode.
 *
 * Supports the full CommonMark spec:
 * - Headings, bold, italic, strikethrough
 * - Fenced code blocks with syntax highlighting (via cli-highlight)
 * - Inline code spans
 * - Tables rendered with Unicode box-drawing (via cli-table3)
 * - Ordered and unordered lists
 * - Blockquotes
 * - Links and images
 * - Horizontal rules
 *
 * Pre-rendered ANSI escape codes in the input are preserved.
 *
 * @param md - Markdown source text
 * @returns Styled terminal string (TTY) or raw CommonMark (non-TTY / plain mode)
 */
export function renderMarkdown(md: string): string {
  if (isPlainOutput()) {
    return md.trimEnd();
  }
  return (marked.parse(md) as string).trimEnd();
}

/**
 * Render inline markdown (bold, code spans, emphasis, links) as styled
 * terminal output, or return the raw markdown string when in plain mode.
 *
 * Unlike `renderMarkdown()`, this uses `marked.parseInline()` which handles
 * only inline-level constructs — no paragraph wrapping, no block elements.
 * Suitable for styling individual table cell values in streaming formatters
 * that write rows incrementally rather than as a complete table.
 *
 * @param md - Inline markdown text
 * @returns Styled string (TTY) or raw markdown text (non-TTY / plain mode)
 */
export function renderInlineMarkdown(md: string): string {
  if (isPlainOutput()) {
    return md;
  }
  return marked.parseInline(md) as string;
}
