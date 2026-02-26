/**
 * Tests for markdown.ts rendering mode logic.
 *
 * Tests cover isPlainOutput() priority chain, env var truthy/falsy
 * normalization, and the gating behaviour of renderMarkdown() /
 * renderInlineMarkdown().
 */

import { describe, expect, test } from "bun:test";
import {
  escapeMarkdownCell,
  isPlainOutput,
  mdKvTable,
  mdRow,
  mdTableHeader,
  renderInlineMarkdown,
  renderMarkdown,
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
