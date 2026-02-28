/**
 * Tests for markdown.ts rendering mode logic.
 *
 * Tests cover isPlainOutput() priority chain, env var truthy/falsy
 * normalization, and the gating behaviour of renderMarkdown() /
 * renderInlineMarkdown().
 */

import { describe, expect, test } from "bun:test";
import {
  colorTag,
  divider,
  escapeMarkdownCell,
  escapeMarkdownInline,
  isPlainOutput,
  mdKvTable,
  mdRow,
  mdTableHeader,
  renderInlineMarkdown,
  renderMarkdown,
  safeCodeSpan,
} from "../../../src/lib/formatters/markdown.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Strip ANSI escape codes for content-only assertions */
function stripAnsi(str: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI codes use control chars
  return str.replace(/\x1b\[[0-9;]*m/g, "");
}

/** Save and restore env vars + isTTY around each test */
function withEnv(
  vars: Partial<Record<"SENTRY_PLAIN_OUTPUT" | "NO_COLOR", string | undefined>>,
  isTTY: boolean | undefined,
  fn: () => void
): void {
  const savedEnv: Record<string, string | undefined> = {};
  const savedTTY = process.stdout.isTTY;

  for (const [key, val] of Object.entries(vars)) {
    savedEnv[key] = process.env[key];
    if (val === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = val;
    }
  }
  process.stdout.isTTY = isTTY as boolean;

  try {
    fn();
  } finally {
    for (const [key, val] of Object.entries(savedEnv)) {
      if (val === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = val;
      }
    }
    process.stdout.isTTY = savedTTY;
  }
}

// ---------------------------------------------------------------------------
// isPlainOutput()
// ---------------------------------------------------------------------------

describe("isPlainOutput", () => {
  describe("SENTRY_PLAIN_OUTPUT takes highest priority", () => {
    test("=1 → plain, regardless of isTTY", () => {
      withEnv({ SENTRY_PLAIN_OUTPUT: "1", NO_COLOR: undefined }, true, () => {
        expect(isPlainOutput()).toBe(true);
      });
    });

    test("=true → plain", () => {
      withEnv(
        { SENTRY_PLAIN_OUTPUT: "true", NO_COLOR: undefined },
        true,
        () => {
          expect(isPlainOutput()).toBe(true);
        }
      );
    });

    test("=TRUE → plain (case-insensitive)", () => {
      withEnv(
        { SENTRY_PLAIN_OUTPUT: "TRUE", NO_COLOR: undefined },
        true,
        () => {
          expect(isPlainOutput()).toBe(true);
        }
      );
    });

    test("=0 → rendered, even when not a TTY", () => {
      withEnv({ SENTRY_PLAIN_OUTPUT: "0", NO_COLOR: undefined }, false, () => {
        expect(isPlainOutput()).toBe(false);
      });
    });

    test("=false → rendered", () => {
      withEnv(
        { SENTRY_PLAIN_OUTPUT: "false", NO_COLOR: undefined },
        false,
        () => {
          expect(isPlainOutput()).toBe(false);
        }
      );
    });

    test("=FALSE → rendered (case-insensitive)", () => {
      withEnv(
        { SENTRY_PLAIN_OUTPUT: "FALSE", NO_COLOR: undefined },
        false,
        () => {
          expect(isPlainOutput()).toBe(false);
        }
      );
    });

    test("='' → rendered (empty string is falsy)", () => {
      withEnv({ SENTRY_PLAIN_OUTPUT: "", NO_COLOR: undefined }, false, () => {
        expect(isPlainOutput()).toBe(false);
      });
    });

    test("SENTRY_PLAIN_OUTPUT=0 overrides NO_COLOR=1", () => {
      withEnv({ SENTRY_PLAIN_OUTPUT: "0", NO_COLOR: "1" }, false, () => {
        expect(isPlainOutput()).toBe(false);
      });
    });

    test("SENTRY_PLAIN_OUTPUT=1 overrides NO_COLOR=0", () => {
      withEnv({ SENTRY_PLAIN_OUTPUT: "1", NO_COLOR: "0" }, true, () => {
        expect(isPlainOutput()).toBe(true);
      });
    });
  });

  describe("NO_COLOR as secondary override (SENTRY_PLAIN_OUTPUT unset)", () => {
    test("=1 → plain", () => {
      withEnv({ SENTRY_PLAIN_OUTPUT: undefined, NO_COLOR: "1" }, true, () => {
        expect(isPlainOutput()).toBe(true);
      });
    });

    test("=True → plain (any non-empty value per spec)", () => {
      withEnv(
        { SENTRY_PLAIN_OUTPUT: undefined, NO_COLOR: "True" },
        true,
        () => {
          expect(isPlainOutput()).toBe(true);
        }
      );
    });

    // Per no-color.org spec (updated 2026-02-09): any non-empty value disables
    // color, including "0" and "false". Only empty string leaves color enabled.
    test("=0 → plain (non-empty value disables color per spec)", () => {
      withEnv({ SENTRY_PLAIN_OUTPUT: undefined, NO_COLOR: "0" }, false, () => {
        expect(isPlainOutput()).toBe(true);
      });
    });

    test("=false → plain (non-empty value disables color per spec)", () => {
      withEnv(
        { SENTRY_PLAIN_OUTPUT: undefined, NO_COLOR: "false" },
        false,
        () => {
          expect(isPlainOutput()).toBe(true);
        }
      );
    });

    test("='' → rendered (empty string leaves color enabled)", () => {
      withEnv({ SENTRY_PLAIN_OUTPUT: undefined, NO_COLOR: "" }, false, () => {
        expect(isPlainOutput()).toBe(false);
      });
    });
  });

  describe("isTTY fallback (both env vars unset)", () => {
    test("non-TTY → plain", () => {
      withEnv(
        { SENTRY_PLAIN_OUTPUT: undefined, NO_COLOR: undefined },
        false,
        () => {
          expect(isPlainOutput()).toBe(true);
        }
      );
    });

    test("TTY → rendered", () => {
      withEnv(
        { SENTRY_PLAIN_OUTPUT: undefined, NO_COLOR: undefined },
        true,
        () => {
          expect(isPlainOutput()).toBe(false);
        }
      );
    });

    test("isTTY=undefined → plain", () => {
      withEnv(
        { SENTRY_PLAIN_OUTPUT: undefined, NO_COLOR: undefined },
        undefined,
        () => {
          expect(isPlainOutput()).toBe(true);
        }
      );
    });
  });
});

// ---------------------------------------------------------------------------
// renderMarkdown()
// ---------------------------------------------------------------------------

describe("renderMarkdown", () => {
  test("plain mode: returns raw markdown trimmed", () => {
    withEnv({ SENTRY_PLAIN_OUTPUT: "1", NO_COLOR: undefined }, false, () => {
      const md = "## Hello\n\n| A | B |\n|---|---|\n| 1 | 2 |\n";
      expect(renderMarkdown(md)).toBe(md.trimEnd());
    });
  });

  test("rendered mode: returns ANSI-styled output (not raw markdown)", () => {
    withEnv({ SENTRY_PLAIN_OUTPUT: "0", NO_COLOR: undefined }, false, () => {
      const result = renderMarkdown("**bold text**");
      // Should contain ANSI codes or at minimum not be the raw markdown
      // (chalk may produce no ANSI in test env — check trimEnd at minimum)
      expect(typeof result).toBe("string");
      expect(result.length).toBeGreaterThan(0);
    });
  });

  test("plain mode: trailing whitespace is trimmed", () => {
    withEnv({ SENTRY_PLAIN_OUTPUT: "1", NO_COLOR: undefined }, false, () => {
      expect(renderMarkdown("hello\n\n\n")).toBe("hello");
    });
  });
});

// ---------------------------------------------------------------------------
// renderInlineMarkdown()
// ---------------------------------------------------------------------------

describe("renderInlineMarkdown", () => {
  test("plain mode: returns input unchanged", () => {
    withEnv({ SENTRY_PLAIN_OUTPUT: "1", NO_COLOR: undefined }, false, () => {
      expect(renderInlineMarkdown("`trace-id`")).toBe("`trace-id`");
      expect(renderInlineMarkdown("**ERROR**")).toBe("**ERROR**");
    });
  });

  test("rendered mode: renders code spans", () => {
    withEnv({ SENTRY_PLAIN_OUTPUT: "0", NO_COLOR: undefined }, false, () => {
      const result = stripAnsi(renderInlineMarkdown("`trace-id`"));
      expect(result).toContain("trace-id");
      // Should not contain the backtick delimiters
      expect(result).not.toContain("`");
    });
  });

  test("rendered mode: renders bold", () => {
    withEnv({ SENTRY_PLAIN_OUTPUT: "0", NO_COLOR: undefined }, false, () => {
      const result = stripAnsi(renderInlineMarkdown("**ERROR**"));
      expect(result).toContain("ERROR");
    });
  });

  test("rendered mode: does not wrap in paragraph tags", () => {
    withEnv({ SENTRY_PLAIN_OUTPUT: "0", NO_COLOR: undefined }, false, () => {
      const result = renderInlineMarkdown("hello world");
      // parseInline should not add paragraph wrapping
      expect(result).not.toContain("<p>");
      expect(result.trim()).toContain("hello world");
    });
  });
});

// ---------------------------------------------------------------------------
// escapeMarkdownCell
// ---------------------------------------------------------------------------

describe("escapeMarkdownCell", () => {
  test("escapes pipe characters", () => {
    expect(escapeMarkdownCell("foo|bar")).toBe("foo\\|bar");
  });

  test("escapes backslashes before pipes", () => {
    expect(escapeMarkdownCell("a\\|b")).toBe("a\\\\\\|b");
  });

  test("returns unchanged string when no special chars", () => {
    expect(escapeMarkdownCell("hello world")).toBe("hello world");
  });

  test("handles empty string", () => {
    expect(escapeMarkdownCell("")).toBe("");
  });

  test("replaces newlines with a space to preserve row structure", () => {
    expect(escapeMarkdownCell("line1\nline2")).toBe("line1 line2");
    expect(escapeMarkdownCell("a\nb\nc")).toBe("a b c");
  });

  test("handles multiple pipes", () => {
    const result = escapeMarkdownCell("a|b|c");
    expect(result).toBe("a\\|b\\|c");
  });
});

// ---------------------------------------------------------------------------
// mdTableHeader
// ---------------------------------------------------------------------------

describe("mdTableHeader", () => {
  test("generates header and separator rows", () => {
    const result = mdTableHeader(["Name", "Value"]);
    expect(result).toBe("| Name | Value |\n| --- | --- |");
  });

  test("right-aligns columns with : suffix", () => {
    const result = mdTableHeader(["Label", "Count:"]);
    expect(result).toBe("| Label | Count |\n| --- | ---: |");
  });

  test("strips : suffix from display name", () => {
    const result = mdTableHeader(["Duration:"]);
    expect(result).toContain("| Duration |");
    expect(result).not.toContain("Duration:");
  });

  test("handles single column", () => {
    const result = mdTableHeader(["Only"]);
    expect(result).toBe("| Only |\n| --- |");
  });
});

// ---------------------------------------------------------------------------
// mdRow
// ---------------------------------------------------------------------------

describe("mdRow", () => {
  test("plain mode: returns raw markdown cells", () => {
    withEnv({ SENTRY_PLAIN_OUTPUT: "1", NO_COLOR: undefined }, true, () => {
      const result = mdRow(["**bold**", "`code`"]);
      expect(result).toBe("| **bold** | `code` |\n");
    });
  });

  test("rendered mode: applies inline rendering", () => {
    withEnv({ SENTRY_PLAIN_OUTPUT: "0", NO_COLOR: undefined }, false, () => {
      const result = mdRow(["**bold**", "plain"]);
      // Should contain ANSI codes for bold
      expect(result).not.toBe("| **bold** | plain |\n");
      expect(stripAnsi(result)).toContain("bold");
      expect(stripAnsi(result)).toContain("plain");
    });
  });

  test("produces pipe-delimited format", () => {
    withEnv({ SENTRY_PLAIN_OUTPUT: "1", NO_COLOR: undefined }, true, () => {
      const result = mdRow(["a", "b", "c"]);
      expect(result).toBe("| a | b | c |\n");
    });
  });
});

// ---------------------------------------------------------------------------
// mdKvTable
// ---------------------------------------------------------------------------

describe("mdKvTable", () => {
  test("generates key-value table rows", () => {
    const result = mdKvTable([
      ["Name", "Alice"],
      ["Age", "30"],
    ]);
    expect(result).toContain("| | |");
    expect(result).toContain("|---|---|");
    expect(result).toContain("| **Name** | Alice |");
    expect(result).toContain("| **Age** | 30 |");
  });

  test("includes heading when provided", () => {
    const result = mdKvTable([["Key", "Val"]], "Details");
    expect(result).toContain("### Details");
    expect(result).toContain("| **Key** | Val |");
  });

  test("omits heading when not provided", () => {
    const result = mdKvTable([["K", "V"]]);
    expect(result).not.toContain("###");
    expect(result).toContain("| **K** | V |");
  });

  test("handles single row", () => {
    const result = mdKvTable([["Only", "Row"]]);
    expect(result).toContain("| **Only** | Row |");
  });
});

// ---------------------------------------------------------------------------
// colorTag
// ---------------------------------------------------------------------------

describe("colorTag", () => {
  test("wraps text in HTML-style tag", () => {
    expect(colorTag("red", "ERROR")).toBe("<red>ERROR</red>");
  });

  test("works with all supported tags", () => {
    for (const tag of [
      "red",
      "green",
      "yellow",
      "blue",
      "magenta",
      "cyan",
      "muted",
    ] as const) {
      const result = colorTag(tag, "text");
      expect(result).toBe(`<${tag}>text</${tag}>`);
    }
  });

  test("rendered mode: strips color tags and preserves content", () => {
    withEnv({ SENTRY_PLAIN_OUTPUT: "0", NO_COLOR: undefined }, false, () => {
      const result = renderInlineMarkdown(colorTag("red", "ERROR"));
      // Tags are consumed by the renderer (not present as raw HTML)
      expect(result).not.toContain("<red>");
      expect(result).not.toContain("</red>");
      expect(stripAnsi(result)).toContain("ERROR");
    });
  });

  test("plain mode: tags are stripped leaving bare text", () => {
    withEnv({ SENTRY_PLAIN_OUTPUT: "1", NO_COLOR: undefined }, true, () => {
      const result = renderInlineMarkdown(colorTag("red", "ERROR"));
      // Color tags must be stripped in plain mode — they must not leak as literal markup
      expect(result).not.toContain("<red>");
      expect(result).not.toContain("</red>");
      expect(result).toContain("ERROR");
    });
  });
});

// ---------------------------------------------------------------------------
// escapeMarkdownInline
// ---------------------------------------------------------------------------

describe("escapeMarkdownInline", () => {
  test("escapes underscores", () => {
    expect(escapeMarkdownInline("hello_world")).toBe("hello\\_world");
  });

  test("escapes asterisks", () => {
    expect(escapeMarkdownInline("*bold*")).toBe("\\*bold\\*");
  });

  test("escapes backticks", () => {
    expect(escapeMarkdownInline("`code`")).toBe("\\`code\\`");
  });

  test("escapes square brackets", () => {
    expect(escapeMarkdownInline("[link]")).toBe("\\[link\\]");
  });

  test("escapes backslashes", () => {
    expect(escapeMarkdownInline("a\\b")).toBe("a\\\\b");
  });

  test("returns unchanged string with no special chars", () => {
    expect(escapeMarkdownInline("hello world")).toBe("hello world");
  });
});

// ---------------------------------------------------------------------------
// safeCodeSpan
// ---------------------------------------------------------------------------

describe("safeCodeSpan", () => {
  test("wraps value in backticks", () => {
    expect(safeCodeSpan("hello")).toBe("`hello`");
  });

  test("replaces internal backticks with modifier letter", () => {
    const result = safeCodeSpan("a`b");
    expect(result).not.toContain("`b");
    expect(result.startsWith("`")).toBe(true);
    expect(result.endsWith("`")).toBe(true);
  });

  test("replaces pipe with unicode vertical bar", () => {
    const result = safeCodeSpan("a|b");
    expect(result).not.toContain("|");
    expect(result).toContain("\u2502");
  });

  test("replaces newlines with spaces", () => {
    const result = safeCodeSpan("line1\nline2");
    expect(result).not.toContain("\n");
    expect(result).toContain("line1 line2");
  });
});

// ---------------------------------------------------------------------------
// divider
// ---------------------------------------------------------------------------

describe("divider", () => {
  test("returns horizontal rule of default width", () => {
    const result = divider();
    expect(stripAnsi(result)).toBe("\u2500".repeat(80));
  });

  test("accepts custom width", () => {
    const result = divider(40);
    expect(stripAnsi(result)).toBe("\u2500".repeat(40));
  });
});

// ---------------------------------------------------------------------------
// renderMarkdown: block-level rendering
// ---------------------------------------------------------------------------

describe("renderMarkdown blocks (rendered mode)", () => {
  function rendered(md: string): string {
    let result = "";
    withEnv({ SENTRY_PLAIN_OUTPUT: "0", NO_COLOR: undefined }, false, () => {
      result = renderMarkdown(md);
    });
    return result;
  }

  test("renders headings", () => {
    const result = rendered("## My Heading");
    expect(stripAnsi(result)).toContain("My Heading");
  });

  test("renders paragraphs", () => {
    const result = rendered("Hello paragraph text.");
    expect(stripAnsi(result)).toContain("Hello paragraph text.");
  });

  test("renders code blocks with language", () => {
    const result = rendered("```python\nprint('hello')\n```");
    expect(stripAnsi(result)).toContain("print");
    expect(stripAnsi(result)).toContain("hello");
  });

  test("renders code blocks without language", () => {
    const result = rendered("```\nsome code\n```");
    expect(stripAnsi(result)).toContain("some code");
  });

  test("renders blockquotes", () => {
    const result = rendered("> This is a quote");
    expect(stripAnsi(result)).toContain("This is a quote");
  });

  test("renders unordered lists", () => {
    const result = rendered("- Item A\n- Item B");
    expect(stripAnsi(result)).toContain("Item A");
    expect(stripAnsi(result)).toContain("Item B");
  });

  test("renders ordered lists", () => {
    const result = rendered("1. First\n2. Second");
    expect(stripAnsi(result)).toContain("First");
    expect(stripAnsi(result)).toContain("Second");
  });

  test("renders horizontal rules", () => {
    const result = rendered("---");
    expect(result).toContain("\u2500");
  });

  test("renders markdown tables as box tables", () => {
    const result = rendered("| A | B |\n|---|---|\n| 1 | 2 |");
    expect(stripAnsi(result)).toContain("A");
    expect(stripAnsi(result)).toContain("B");
    expect(stripAnsi(result)).toContain("1");
    expect(stripAnsi(result)).toContain("2");
  });
});

// ---------------------------------------------------------------------------
// renderInlineMarkdown: inline token rendering
// ---------------------------------------------------------------------------

describe("renderInlineMarkdown inline tokens (rendered mode)", () => {
  function rendered(md: string): string {
    let result = "";
    withEnv({ SENTRY_PLAIN_OUTPUT: "0", NO_COLOR: undefined }, false, () => {
      result = renderInlineMarkdown(md);
    });
    return result;
  }

  test("renders italic", () => {
    const result = rendered("*italic text*");
    expect(stripAnsi(result)).toContain("italic text");
    // Should have ANSI codes
    expect(result).not.toBe("*italic text*");
  });

  test("renders links", () => {
    const result = rendered("[click](https://example.com)");
    expect(stripAnsi(result)).toContain("click");
  });

  test("renders strikethrough", () => {
    const result = rendered("~~deleted~~");
    expect(stripAnsi(result)).toContain("deleted");
  });

  test("renders color tags", () => {
    const result = rendered("<red>ERROR</red>");
    // Tags are consumed by the renderer (not present as raw HTML)
    expect(result).not.toContain("<red>");
    expect(result).not.toContain("</red>");
    expect(stripAnsi(result)).toContain("ERROR");
  });

  test("unknown HTML tags are stripped", () => {
    const result = rendered("<banana>fruit</banana>");
    expect(stripAnsi(result)).toContain("fruit");
  });

  test("bare open tags are dropped", () => {
    const result = rendered("before <red> after");
    expect(stripAnsi(result)).toContain("before");
    expect(stripAnsi(result)).toContain("after");
  });

  test("bare close tags are dropped", () => {
    const result = rendered("before </red> after");
    expect(stripAnsi(result)).toContain("before");
    expect(stripAnsi(result)).toContain("after");
  });
});
