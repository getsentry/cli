import { describe, expect, test } from "bun:test";
import {
  extractInnerLiteral,
  isPureLiteral,
} from "../../../src/lib/scan/literal-extract.js";

describe("extractInnerLiteral — basic patterns", () => {
  test.each([
    // [pattern, flags, expected literal]
    ["import.*from", "", "import"], // quantifier breaks run
    ["function\\s+\\w+", "", "function"], // \s, \w are not literals
    ["http://", "", "http://"], // no metachars at all
    ["SENTRY_DSN", "", "SENTRY_DSN"], // pure literal
    ["hello world", "", "hello world"], // literal with space
    ["^foo$", "", "foo"], // anchors break run, leaving foo
    ["^foo", "", "foo"], // leading anchor only
    ["foo$", "", "foo"], // trailing anchor only
  ])("extracts %p with flags %p → %p", (pattern, flags, expected) => {
    expect(extractInnerLiteral(pattern, flags)).toBe(expected);
  });
});

describe("extractInnerLiteral — escaped metacharacters", () => {
  test.each([
    ["Sentry\\.init", "", "Sentry.init"], // \. is literal dot
    ["foo\\.bar", "", "foo.bar"],
    ["a\\/b", "", "a/b"], // escaped slash
    ["\\\\foo", "", "\\foo"], // escaped backslash
    ["a\\(b\\)", "", "a(b)"], // escaped parens
    ["a\\[b\\]", "", "a[b]"], // escaped brackets
  ])("recognizes escaped literal %p → %p", (pattern, flags, expected) => {
    expect(extractInnerLiteral(pattern, flags)).toBe(expected);
  });
});

describe("extractInnerLiteral — escape sequences that break runs", () => {
  test.each([
    ["\\bfoo\\b", "foo"], // \b anchor, not literal b
    ["\\w+foo\\d+", "foo"], // \w, \d are classes
    ["\\tfoo\\t", "foo"], // \t is tab escape
    ["\\nfoo\\n", "foo"], // \n is newline escape
    ["\\sfoo\\s", "foo"], // \s is whitespace class
  ])("breaks run on non-literal escape %p → %p", (pattern, expected) => {
    expect(extractInnerLiteral(pattern, "")).toBe(expected);
  });
});

describe("extractInnerLiteral — returns null", () => {
  test.each([
    [".*", ""], // no literal content
    [".", ""], // single metachar
    ["foo|bar", ""], // top-level alternation
    ["(foo|bar)", ""], // group with alternation
    ["[abc]", ""], // character class only
    ["a?", ""], // quantified single char (too short after drop)
    ["ab", ""], // below MIN_LITERAL_LEN (3)
    ["   ", ""], // all whitespace
    ["!!!", ""], // all punctuation
  ])("returns null for %p", (pattern, flags) => {
    expect(extractInnerLiteral(pattern, flags)).toBeNull();
  });
});

describe("extractInnerLiteral — case-insensitive flag", () => {
  test("lowercases the extracted literal when flags include i", () => {
    expect(extractInnerLiteral("SENTRY_DSN", "i")).toBe("sentry_dsn");
    expect(extractInnerLiteral("Import.*From", "i")).toBe("import");
  });

  test("leaves the literal case-sensitive without i flag", () => {
    expect(extractInnerLiteral("SENTRY_DSN", "")).toBe("SENTRY_DSN");
    expect(extractInnerLiteral("SENTRY_DSN", "gm")).toBe("SENTRY_DSN");
  });
});

describe("extractInnerLiteral — quantifier handling", () => {
  test("drops the quantified character from the run", () => {
    // `abc*def` — c is quantified (may be absent), so "ab" is one
    // run (length 2, below threshold) and "def" (length 3) wins.
    expect(extractInnerLiteral("abc*def", "")).toBe("def");
  });

  test("handles ? quantifier", () => {
    expect(extractInnerLiteral("a?bcdef", "")).toBe("bcdef");
  });

  test("handles + quantifier", () => {
    // `abc+def` — with +, c IS required (1+ of), but the extractor
    // conservatively drops the preceding char. "ab" too short,
    // "def" wins.
    expect(extractInnerLiteral("abc+def", "")).toBe("def");
  });

  test("handles {n,m} quantifier", () => {
    expect(extractInnerLiteral("abc{2,3}def", "")).toBe("def");
  });

  test("longest run wins when multiple exist", () => {
    // `short.*longer_run.*short` — `longer_run` wins over `short`.
    expect(extractInnerLiteral("short.*longer_run.*short", "")).toBe(
      "longer_run"
    );
  });
});

describe("isPureLiteral", () => {
  test("true when the whole pattern is a literal", () => {
    expect(isPureLiteral("SENTRY_DSN", "")).toBe(true);
    expect(isPureLiteral("hello world", "")).toBe(true);
    expect(isPureLiteral("http://", "")).toBe(true);
  });

  test("false when the pattern contains regex metachars", () => {
    expect(isPureLiteral("import.*from", "")).toBe(false);
    expect(isPureLiteral("^foo", "")).toBe(false);
    expect(isPureLiteral("foo|bar", "")).toBe(false);
    expect(isPureLiteral("[abc]", "")).toBe(false);
  });

  test("false when escaped metachars present (extractor yields them but pattern isn't bare)", () => {
    // Even though `Sentry\.init` extracts to `Sentry.init`, the
    // source isn't the same as the literal (it has a backslash).
    // isPureLiteral compares to source.
    expect(isPureLiteral("Sentry\\.init", "")).toBe(false);
  });

  test("respects the i flag via case-insensitive comparison", () => {
    expect(isPureLiteral("SENTRY_DSN", "i")).toBe(true);
  });
});
