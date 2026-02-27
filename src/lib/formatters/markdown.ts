/**
 * Markdown-to-Terminal Renderer
 *
 * Custom renderer that walks `marked` tokens and produces ANSI-styled
 * terminal output using `chalk`. Replaces `marked-terminal` to eliminate
 * its ~970KB dependency chain (cli-highlight, node-emoji, cli-table3,
 * parse5) while giving us full control over table rendering.
 *
 * Table rendering delegates to the text-table module which uses
 * OpenTUI-inspired column fitting algorithms and Unicode box-drawing
 * borders.
 *
 * Pre-rendered ANSI escape codes embedded in markdown source are preserved
 * — `string-width` correctly treats them as zero-width.
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
import { highlight as cliHighlight } from "cli-highlight";
import { marked, type Token, type Tokens } from "marked";
import { muted, terminalLink } from "./colors.js";
import { type Alignment, renderTextTable } from "./text-table.js";

// ──────────────────────────── Environment ─────────────────────────────

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
 * 1. `SENTRY_PLAIN_OUTPUT` — explicit project-specific override (custom
 *    semantics: `"0"` / `"false"` / `""` force color on)
 * 2. `NO_COLOR` — follows the no-color.org spec: any **non-empty** value
 *    disables color, regardless of its content (including `"0"` / `"false"`)
 * 3. `process.stdout.isTTY` — auto-detect interactive terminal
 */
export function isPlainOutput(): boolean {
  const plain = process.env.SENTRY_PLAIN_OUTPUT;
  if (plain !== undefined) {
    return isTruthyEnv(plain);
  }

  // no-color.org spec: presence of a non-empty value disables color.
  // Unlike SENTRY_PLAIN_OUTPUT, "0" and "false" still mean "disable color".
  const noColor = process.env.NO_COLOR;
  if (noColor !== undefined) {
    return noColor !== "";
  }

  return !process.stdout.isTTY;
}

// ──────────────────────────── Escape helpers ──────────────────────────

/**
 * Escape a string for safe use inside a markdown table cell.
 *
 * Collapses newlines, escapes backslashes, then pipes.
 */
export function escapeMarkdownCell(value: string): string {
  return value.replace(/\n/g, " ").replace(/\\/g, "\\\\").replace(/\|/g, "\\|");
}

/**
 * Escape CommonMark inline emphasis characters.
 *
 * Prevents `_`, `*`, `` ` ``, `[`, `]` from being consumed by the parser.
 */
export function escapeMarkdownInline(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\*/g, "\\*")
    .replace(/_/g, "\\_")
    .replace(/`/g, "\\`")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]");
}

/**
 * Wrap a string in a backtick code span, sanitising characters that
 * would break the span or surrounding table structure.
 */
export function safeCodeSpan(value: string): string {
  return `\`${value.replace(/`/g, "\u02CB").replace(/\|/g, "\u2502").replace(/\n/g, " ")}\``;
}

// ──────────────────────── Streaming table helpers ─────────────────────

/**
 * Build a raw markdown table header row + separator from column names.
 *
 * Column names ending with `:` are right-aligned (the `:` is stripped).
 */
export function mdTableHeader(cols: readonly string[]): string {
  const names = cols.map((c) => (c.endsWith(":") ? c.slice(0, -1) : c));
  const seps = cols.map((c) => (c.endsWith(":") ? "---:" : "---"));
  return `| ${names.join(" | ")} |\n| ${seps.join(" | ")} |`;
}

/**
 * Build a streaming markdown table row. In plain mode emits raw markdown;
 * in rendered mode applies inline styling and replaces `|` with `│`.
 */
export function mdRow(cells: readonly string[]): string {
  if (isPlainOutput()) {
    return `| ${cells.join(" | ")} |\n`;
  }
  const out = cells.map((c) =>
    renderInline(marked.lexer(c).flatMap(flattenInline)).replace(
      /\|/g,
      "\u2502"
    )
  );
  return `| ${out.join(" | ")} |\n`;
}

/**
 * Build a key-value markdown table section with an optional heading.
 *
 * Each entry is rendered as `| **Label** | value |`.
 */
export function mdKvTable(
  rows: ReadonlyArray<readonly [string, string]>,
  heading?: string
): string {
  const lines: string[] = [];
  if (heading) {
    lines.push(`### ${heading}`);
    lines.push("");
  }
  lines.push("| | |");
  lines.push("|---|---|");
  for (const [label, value] of rows) {
    lines.push(
      `| **${label}** | ${value.replace(/\n/g, " ").replace(/\|/g, "\u2502")} |`
    );
  }
  return lines.join("\n");
}

/**
 * Render a muted horizontal rule.
 */
export function divider(width = 80): string {
  return muted("\u2500".repeat(width));
}

// ──────────────────────── Inline token rendering ─────────────────────

/** Sentinel-inspired color palette */
const COLORS = {
  red: "#fe4144",
  green: "#83da90",
  yellow: "#FDB81B",
  blue: "#226DFC",
  magenta: "#FF45A8",
  cyan: "#79B8FF",
  muted: "#898294",
} as const;

/**
 * Semantic HTML color tags supported in markdown strings.
 *
 * Formatters can embed `<red>text</red>`, `<green>text</green>`, etc. in
 * any markdown string and the custom renderer will apply the corresponding
 * ANSI color. In plain (non-TTY) mode the tags are stripped, leaving only
 * the inner text.
 *
 * Supported tags: red, green, yellow, blue, magenta, cyan, muted
 */
const COLOR_TAGS: Record<string, (text: string) => string> = {
  red: (t) => chalk.hex(COLORS.red)(t),
  green: (t) => chalk.hex(COLORS.green)(t),
  yellow: (t) => chalk.hex(COLORS.yellow)(t),
  blue: (t) => chalk.hex(COLORS.blue)(t),
  magenta: (t) => chalk.hex(COLORS.magenta)(t),
  cyan: (t) => chalk.hex(COLORS.cyan)(t),
  muted: (t) => chalk.hex(COLORS.muted)(t),
};

/**
 * Wrap text in a semantic color tag for use in markdown strings.
 *
 * In TTY mode the tag is rendered as an ANSI color by the custom renderer.
 * In plain mode the tag is stripped and only the inner text is emitted.
 *
 * @example
 * colorTag("red", "ERROR")   // → "<red>ERROR</red>"
 * colorTag("green", "✓")     // → "<green>✓</green>"
 */
export function colorTag(tag: keyof typeof COLOR_TAGS, text: string): string {
  return `<${tag}>${text}</${tag}>`;
}

// Pre-compiled regexes for HTML color tag parsing (module-level for performance)
const RE_OPEN_TAG = /^<([a-z]+)>$/i;
const RE_CLOSE_TAG = /^<\/([a-z]+)>$/i;
const RE_SELF_TAG = /^<([a-z]+)>([\s\S]*?)<\/\1>$/i;

/**
 * Render an inline HTML token as a color-tagged string.
 *
 * Handles self-contained `<tag>text</tag>` forms. Bare open/close
 * tags are dropped (marked emits them as separate tokens; the
 * self-contained form is produced by `colorTag()`).
 */
function renderHtmlToken(raw: string): string {
  const trimmed = raw.trim();
  if (RE_OPEN_TAG.test(trimmed) || RE_CLOSE_TAG.test(trimmed)) {
    return "";
  }
  const m = RE_SELF_TAG.exec(trimmed);
  if (m) {
    const tagName = m[1];
    const inner = m[2];
    if (tagName !== undefined && inner !== undefined) {
      const colorFn = COLOR_TAGS[tagName.toLowerCase()];
      return colorFn ? colorFn(inner) : inner;
    }
  }
  return "";
}

/**
 * Syntax-highlight a code block. Falls back to uniform yellow if the
 * language is unknown or highlighting fails.
 */
function highlightCode(code: string, language?: string): string {
  try {
    return cliHighlight(code, { language, ignoreIllegals: true });
  } catch {
    return chalk.hex(COLORS.yellow)(code);
  }
}

/**
 * Flatten a top-level token's inline content. Paragraphs and other block
 * tokens that wrap inline tokens are unwrapped; bare inline tokens pass
 * through as-is.
 */
function flattenInline(token: Token): Token[] {
  if (
    "tokens" in token &&
    token.tokens &&
    token.type !== "strong" &&
    token.type !== "em" &&
    token.type !== "link"
  ) {
    return token.tokens;
  }
  return [token];
}

/**
 * Render a single inline token to an ANSI string.
 */
function renderOneInline(token: Token): string {
  switch (token.type) {
    case "strong":
      return chalk.bold(renderInline((token as Tokens.Strong).tokens));
    case "em":
      return chalk.italic(renderInline((token as Tokens.Em).tokens));
    case "codespan":
      return chalk.hex(COLORS.yellow)((token as Tokens.Codespan).text);
    case "link": {
      const link = token as Tokens.Link;
      const linkText = renderInline(link.tokens);
      const styled = chalk.hex(COLORS.blue)(linkText);
      return link.href ? terminalLink(styled, link.href) : styled;
    }
    case "del":
      return chalk.dim.gray.strikethrough(
        renderInline((token as Tokens.Del).tokens)
      );
    case "br":
      return "\n";
    case "escape":
      return (token as Tokens.Escape).text;
    case "text":
      if ("tokens" in token && (token as Tokens.Text).tokens) {
        return renderInline((token as Tokens.Text).tokens ?? []);
      }
      return (token as Tokens.Text).text;
    case "html": {
      const raw = (token as Tokens.HTML).raw ?? (token as Tokens.HTML).text;
      return renderHtmlToken(raw);
    }
    default:
      return (token as { raw?: string }).raw ?? "";
  }
}

/**
 * Render an array of inline tokens into an ANSI-styled string.
 *
 * Handles paired color tags (`<red>\u2026</red>`) that `marked` emits as
 * separate `html` tokens (open, inner tokens, close). Buffers inner
 * tokens until the matching close tag, then applies the color function.
 *
 * Also handles: strong, em, codespan, link, text, br, del, escape.
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: paired color tag buffering
function renderInline(tokens: Token[]): string {
  const parts: string[] = [];
  let i = 0;

  while (i < tokens.length) {
    const token = tokens[i] as Token;

    // Check for color tag open: <red>, <green>, etc.
    if (token.type === "html") {
      const raw = (
        (token as Tokens.HTML).raw ?? (token as Tokens.HTML).text
      ).trim();
      const openMatch = RE_OPEN_TAG.exec(raw);
      if (openMatch) {
        const tagName = (openMatch[1] ?? "").toLowerCase();
        const colorFn = COLOR_TAGS[tagName];
        if (colorFn) {
          // Collect inner tokens until matching </tag>
          const closeTag = `</${openMatch[1]}>`;
          const inner: Token[] = [];
          i += 1;
          while (i < tokens.length) {
            const t = tokens[i] as Token;
            if (
              t.type === "html" &&
              ((t as Tokens.HTML).raw ?? (t as Tokens.HTML).text)
                .trim()
                .toLowerCase() === closeTag.toLowerCase()
            ) {
              i += 1; // consume close tag
              break;
            }
            inner.push(t);
            i += 1;
          }
          parts.push(colorFn(renderInline(inner)));
          continue;
        }
      }
    }

    parts.push(renderOneInline(token));
    i += 1;
  }

  return parts.join("");
}

// ──────────────────────── Block token rendering ──────────────────────

/**
 * Render an array of block-level tokens into ANSI-styled terminal output.
 *
 * Handles: heading, paragraph, code, blockquote, list, table, hr, space.
 */
function renderBlocks(tokens: Token[]): string {
  const parts: string[] = [];

  for (const token of tokens) {
    switch (token.type) {
      case "heading": {
        const t = token as Tokens.Heading;
        const text = renderInline(t.tokens);
        if (t.depth <= 2) {
          parts.push(chalk.hex(COLORS.cyan).bold(text));
        } else {
          parts.push(chalk.hex(COLORS.cyan).bold(text));
        }
        parts.push("");
        break;
      }
      case "paragraph": {
        const t = token as Tokens.Paragraph;
        parts.push(renderInline(t.tokens));
        parts.push("");
        break;
      }
      case "code": {
        const t = token as Tokens.Code;
        const highlighted = highlightCode(t.text, t.lang ?? undefined);
        const lines = highlighted.split("\n").map((l) => `  ${l}`);
        parts.push(lines.join("\n"));
        parts.push("");
        break;
      }
      case "blockquote": {
        const t = token as Tokens.Blockquote;
        const inner = renderBlocks(t.tokens).trim();
        const quoted = inner
          .split("\n")
          .map((l) => chalk.hex(COLORS.muted).italic(`  ${l}`))
          .join("\n");
        parts.push(quoted);
        parts.push("");
        break;
      }
      case "list": {
        const t = token as Tokens.List;
        parts.push(renderList(t));
        parts.push("");
        break;
      }
      case "table": {
        const t = token as Tokens.Table;
        parts.push(renderTableToken(t));
        break;
      }
      case "hr":
        parts.push(muted("\u2500".repeat(40)));
        parts.push("");
        break;
      case "space":
        // Intentional blank line — skip
        break;
      default: {
        // Unknown block type — emit raw text as fallback
        const raw = (token as { raw?: string }).raw;
        if (raw) {
          parts.push(raw);
        }
      }
    }
  }

  return parts.join("\n");
}

/**
 * Render a list token (ordered or unordered) with proper indentation.
 */
function renderList(list: Tokens.List, depth = 0): string {
  const indent = "  ".repeat(depth);
  const lines: string[] = [];

  for (let i = 0; i < list.items.length; i++) {
    const item = list.items[i];
    if (!item) {
      continue;
    }
    const start = Number(list.start ?? 1);
    const bullet = list.ordered ? `${start + i}.` : "•";
    const body = item.tokens
      .map((t) => {
        if (t.type === "list") {
          return renderList(t as Tokens.List, depth + 1);
        }
        if (t.type === "text" && "tokens" in t && (t as Tokens.Text).tokens) {
          return renderInline((t as Tokens.Text).tokens ?? []);
        }
        if ("tokens" in t && (t as Tokens.Generic).tokens) {
          return renderInline(((t as Tokens.Generic).tokens as Token[]) ?? []);
        }
        return (t as { raw?: string }).raw ?? "";
      })
      .join("\n");

    lines.push(`${indent}${bullet} ${body}`);
  }

  return lines.join("\n");
}

/**
 * Render a markdown table token using the text-table renderer.
 *
 * Converts marked's `Tokens.Table` into headers + rows + alignments and
 * delegates to `renderTextTable()` for column fitting and box drawing.
 */
function renderTableToken(table: Tokens.Table): string {
  const headers = table.header.map((cell) => renderInline(cell.tokens));
  const rows = table.rows.map((row) =>
    row.map((cell) => renderInline(cell.tokens))
  );

  const alignments: Alignment[] = table.align.map((a) => {
    if (a === "right") {
      return "right";
    }
    if (a === "center") {
      return "center";
    }
    return "left";
  });

  return renderTextTable(headers, rows, { alignments });
}

// ──────────────────────── Public API ─────────────────────────────────

/**
 * Render a full markdown document as styled terminal output, or return
 * the raw CommonMark string when in plain mode.
 *
 * Uses `marked.lexer()` to tokenize and a custom block/inline renderer
 * for ANSI output. Tables are rendered with Unicode box-drawing borders
 * via the text-table module.
 *
 * @param md - Markdown source text
 * @returns Styled terminal string (TTY) or raw CommonMark (non-TTY / plain mode)
 */
export function renderMarkdown(md: string): string {
  if (isPlainOutput()) {
    return md.trimEnd();
  }
  const tokens = marked.lexer(md);
  return renderBlocks(tokens).trimEnd();
}

/**
 * Render inline markdown (bold, code spans, emphasis, links) as styled
 * terminal output, or return the raw markdown string when in plain mode.
 *
 * @param md - Inline markdown text
 * @returns Styled string (TTY) or raw markdown text (non-TTY / plain mode)
 */
export function renderInlineMarkdown(md: string): string {
  if (isPlainOutput()) {
    return md;
  }
  const tokens = marked.lexer(md);
  return renderInline(tokens.flatMap(flattenInline));
}
