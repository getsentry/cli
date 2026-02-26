/**
 * Markdown-to-Terminal Renderer
 *
 * Central utility for rendering markdown content as styled terminal output
 * using `marked` + `marked-terminal`. Provides a single `renderMarkdown()`
 * function that all formatters can use for rich text output.
 *
 * Pre-rendered ANSI escape codes embedded in markdown source (e.g. inside
 * table cells) survive the pipeline — `cli-table3` computes column widths
 * via `string-width`, which correctly treats ANSI codes as zero-width.
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
 * Render a markdown string as styled terminal output.
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
 * @returns Styled terminal string with trailing whitespace trimmed
 */
export function renderMarkdown(md: string): string {
  return (marked.parse(md) as string).trimEnd();
}
