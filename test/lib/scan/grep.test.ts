/**
 * Unit tests for `src/lib/scan/grep.ts` (`grepFiles`, `collectGrep`).
 *
 * Each test builds a small sandbox under `tmpdir()`, runs grep with
 * specific options, and asserts on the returned matches.
 *
 * We use `collectGrep` in most tests — it gives us a stable sorted
 * order plus the stats bag to assert on. The iterable variant is
 * tested separately for streaming and early-break semantics.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ValidationError } from "../../../src/lib/errors.js";
import { collectGrep, grepFiles } from "../../../src/lib/scan/grep.js";

const ROOT = mkdtempSync(join(tmpdir(), "scan-grep-test-"));

afterAll(() => {
  rmSync(ROOT, { recursive: true, force: true });
});

/** Build a sandbox directory with the given relative-path → content map. */
function makeSandbox(layout: Record<string, string>): {
  cwd: string;
  cleanup: () => void;
} {
  const cwd = mkdtempSync(join(ROOT, "box-"));
  for (const [rel, content] of Object.entries(layout)) {
    const abs = join(cwd, rel);
    const parent = abs.slice(0, abs.lastIndexOf("/"));
    mkdirSync(parent, { recursive: true });
    writeFileSync(abs, content, "utf8");
  }
  return { cwd, cleanup: () => rmSync(cwd, { recursive: true, force: true }) };
}

describe("collectGrep — basic matching", () => {
  test("finds a simple literal pattern across files", async () => {
    const { cwd, cleanup } = makeSandbox({
      "a.txt": "line one\nhello world\nline three",
      "b.txt": "nothing here\nhello again",
      "c.txt": "no match at all",
    });
    try {
      const { matches } = await collectGrep({ cwd, pattern: "hello" });
      expect(matches.map((m) => `${m.path}:${m.lineNum}`)).toEqual([
        "a.txt:2",
        "b.txt:2",
      ]);
      expect(matches[0]?.line).toBe("hello world");
    } finally {
      cleanup();
    }
  });

  test("no matches returns empty result with truncated: false", async () => {
    const { cwd, cleanup } = makeSandbox({ "a.txt": "no match" });
    try {
      const result = await collectGrep({ cwd, pattern: "xyz" });
      expect(result.matches).toEqual([]);
      expect(result.stats.truncated).toBe(false);
      expect(result.stats.filesRead).toBe(1);
    } finally {
      cleanup();
    }
  });

  test("regex metachars work as patterns", async () => {
    const { cwd, cleanup } = makeSandbox({
      "a.txt": "one\ntwo\n\nthree",
    });
    try {
      // `^t.*` matches any line starting with t.
      const { matches } = await collectGrep({ cwd, pattern: "^t" });
      expect(matches.map((m) => m.line)).toEqual(["two", "three"]);
    } finally {
      cleanup();
    }
  });
});

describe("collectGrep — case sensitivity", () => {
  test("default is case-sensitive", async () => {
    const { cwd, cleanup } = makeSandbox({
      "a.txt": "Hello\nhello\nHELLO",
    });
    try {
      const { matches } = await collectGrep({ cwd, pattern: "hello" });
      expect(matches.map((m) => m.line)).toEqual(["hello"]);
    } finally {
      cleanup();
    }
  });

  test("caseSensitive: false matches any case", async () => {
    const { cwd, cleanup } = makeSandbox({
      "a.txt": "Hello\nhello\nHELLO",
    });
    try {
      const { matches } = await collectGrep({
        cwd,
        pattern: "hello",
        caseSensitive: false,
      });
      expect(matches.map((m) => m.line)).toEqual(["Hello", "hello", "HELLO"]);
    } finally {
      cleanup();
    }
  });

  test("leading (?i) in pattern also enables case-insensitive", async () => {
    const { cwd, cleanup } = makeSandbox({
      "a.txt": "Hello\nhello\nHELLO",
    });
    try {
      const { matches } = await collectGrep({ cwd, pattern: "(?i)hello" });
      expect(matches.length).toBe(3);
    } finally {
      cleanup();
    }
  });
});

describe("collectGrep — multiline mode", () => {
  test("default: ^ matches at line boundaries (grep-like)", async () => {
    // Default `multiline: true` gives rg/grep semantics: `^foo` hits
    // any line starting with `foo`, not just the first line of the
    // file. Regression test for a PR 791 review finding that the
    // `multiline` option was always forced to true internally; the
    // fix ties behavior to the caller's explicit opt-in/out.
    const { cwd, cleanup } = makeSandbox({
      "a.txt": "nope\nfoo line\nalso nope\nfoo again",
    });
    try {
      const { matches } = await collectGrep({ cwd, pattern: "^foo" });
      expect(matches.map((m) => m.line)).toEqual(["foo line", "foo again"]);
    } finally {
      cleanup();
    }
  });

  test("multiline: false applies strict buffer-boundary anchoring", async () => {
    // With `multiline: false`, `^` anchors to the buffer start only.
    // Only the first line can match `^foo`; a later `foo`-start line
    // inside the same file does NOT.
    const { cwd, cleanup } = makeSandbox({
      "a.txt": "nope\nfoo line\nalso nope",
      "b.txt": "foo buffer-start",
    });
    try {
      const { matches } = await collectGrep({
        cwd,
        pattern: "^foo",
        multiline: false,
      });
      expect(matches.map((m) => `${m.path}:${m.line}`)).toEqual([
        "b.txt:foo buffer-start",
      ]);
    } finally {
      cleanup();
    }
  });
});

describe("collectGrep — include / exclude globs", () => {
  test("include narrows to matching files", async () => {
    const { cwd, cleanup } = makeSandbox({
      "a.ts": "foo",
      "b.js": "foo",
      "c.md": "foo",
    });
    try {
      const { matches } = await collectGrep({
        cwd,
        pattern: "foo",
        include: "*.ts",
      });
      expect(matches.map((m) => m.path)).toEqual(["a.ts"]);
    } finally {
      cleanup();
    }
  });

  test("exclude suppresses matching files", async () => {
    const { cwd, cleanup } = makeSandbox({
      "a.ts": "foo",
      "b.test.ts": "foo",
      "c.ts": "foo",
    });
    try {
      const { matches } = await collectGrep({
        cwd,
        pattern: "foo",
        include: "*.ts",
        exclude: "*.test.ts",
      });
      expect(matches.map((m) => m.path).sort()).toEqual(["a.ts", "c.ts"]);
    } finally {
      cleanup();
    }
  });

  test("include array with multiple patterns ORs them", async () => {
    const { cwd, cleanup } = makeSandbox({
      "a.ts": "foo",
      "b.js": "foo",
      "c.md": "foo",
    });
    try {
      const { matches } = await collectGrep({
        cwd,
        pattern: "foo",
        include: ["*.ts", "*.js"],
      });
      expect(matches.map((m) => m.path).sort()).toEqual(["a.ts", "b.js"]);
    } finally {
      cleanup();
    }
  });

  test("path narrows the walk root", async () => {
    const { cwd, cleanup } = makeSandbox({
      "src/a.ts": "foo",
      "src/b.ts": "foo",
      "other/c.ts": "foo",
    });
    try {
      const { matches } = await collectGrep({
        cwd,
        pattern: "foo",
        path: "src",
      });
      expect(matches.map((m) => m.path).sort()).toEqual([
        "src/a.ts",
        "src/b.ts",
      ]);
    } finally {
      cleanup();
    }
  });
});

describe("collectGrep — truncation / limits", () => {
  test("maxResults caps total matches and sets truncated", async () => {
    const { cwd, cleanup } = makeSandbox({
      "a.txt": "hit\nhit\nhit\nhit\nhit",
    });
    try {
      const { matches, stats } = await collectGrep({
        cwd,
        pattern: "hit",
        maxResults: 3,
      });
      expect(matches.length).toBe(3);
      expect(stats.truncated).toBe(true);
    } finally {
      cleanup();
    }
  });

  test("maxResults == exact match count does NOT set truncated", async () => {
    // Regression for PR 791 review finding: `collectGrep` previously
    // set `truncated = true` whenever `matchesEmitted >= maxResults`,
    // so asking for `maxResults: 3` against a corpus with exactly 3
    // matches falsely reported truncation. The fix mirrors
    // `collectGlob`'s `+1` overshoot probe.
    const { cwd, cleanup } = makeSandbox({
      "a.txt": "hit\nhit\nhit",
    });
    try {
      const { matches, stats } = await collectGrep({
        cwd,
        pattern: "hit",
        maxResults: 3,
      });
      expect(matches.length).toBe(3);
      // Exactly 3 matches exist; we requested 3; no truncation.
      expect(stats.truncated).toBe(false);
    } finally {
      cleanup();
    }
  });

  test("stopOnFirst returns on first match", async () => {
    const { cwd, cleanup } = makeSandbox({
      "a.txt": "hit\nhit\nhit",
    });
    try {
      const { matches, stats } = await collectGrep({
        cwd,
        pattern: "hit",
        stopOnFirst: true,
      });
      expect(matches.length).toBe(1);
      expect(stats.truncated).toBe(true);
    } finally {
      cleanup();
    }
  });

  test("maxMatchesPerFile caps per-file output", async () => {
    const { cwd, cleanup } = makeSandbox({
      "a.txt": "hit\nhit\nhit\nhit\nhit",
      "b.txt": "hit\nhit\nhit\nhit\nhit",
    });
    try {
      const { matches } = await collectGrep({
        cwd,
        pattern: "hit",
        maxMatchesPerFile: 2,
      });
      // 2 files × 2 matches/file = 4 total.
      expect(matches.length).toBe(4);
      const perFile = matches.reduce<Record<string, number>>((acc, m) => {
        acc[m.path] = (acc[m.path] ?? 0) + 1;
        return acc;
      }, {});
      expect(perFile["a.txt"]).toBe(2);
      expect(perFile["b.txt"]).toBe(2);
    } finally {
      cleanup();
    }
  });

  test("long lines truncated at maxLineLength with ellipsis", async () => {
    const long = "x".repeat(3000);
    const { cwd, cleanup } = makeSandbox({ "a.txt": `hit${long}` });
    try {
      const { matches } = await collectGrep({
        cwd,
        pattern: "hit",
        maxLineLength: 50,
      });
      expect(matches.length).toBe(1);
      const line = matches[0]?.line ?? "";
      expect(line.length).toBe(50);
      expect(line.endsWith("…")).toBe(true);
    } finally {
      cleanup();
    }
  });

  test("lines shorter than maxLineLength are emitted verbatim", async () => {
    const { cwd, cleanup } = makeSandbox({ "a.txt": "hit: short" });
    try {
      const { matches } = await collectGrep({
        cwd,
        pattern: "hit",
      });
      expect(matches[0]?.line).toBe("hit: short");
    } finally {
      cleanup();
    }
  });
});

describe("collectGrep — binary-file handling", () => {
  test("default skips NUL-containing files", async () => {
    const { cwd, cleanup } = makeSandbox({});
    try {
      // 256-byte "binary" blob with a hit string in it and a NUL.
      const bin = new Uint8Array(256);
      const enc = new TextEncoder();
      const prefix = enc.encode("hitme\n");
      bin.set(prefix, 0);
      bin[100] = 0;
      writeFileSync(join(cwd, "blob.bin"), bin);
      const { matches, stats } = await collectGrep({
        cwd,
        pattern: "hitme",
      });
      expect(matches.length).toBe(0);
      expect(stats.filesSkippedBinary).toBeGreaterThanOrEqual(1);
    } finally {
      cleanup();
    }
  });

  test("includeBinary: true scans binary files", async () => {
    const { cwd, cleanup } = makeSandbox({});
    try {
      const bin = new Uint8Array(256);
      const enc = new TextEncoder();
      const prefix = enc.encode("hitme\n");
      bin.set(prefix, 0);
      bin[100] = 0;
      writeFileSync(join(cwd, "blob.bin"), bin);
      const { matches } = await collectGrep({
        cwd,
        pattern: "hitme",
        includeBinary: true,
      });
      expect(matches.length).toBe(1);
    } finally {
      cleanup();
    }
  });
});

describe("collectGrep — result ordering", () => {
  test("matches sorted by [path, lineNum]", async () => {
    const { cwd, cleanup } = makeSandbox({
      "z.txt": "hit\nhit",
      "a.txt": "hit\nhit",
      "m.txt": "hit",
    });
    try {
      const { matches } = await collectGrep({ cwd, pattern: "hit" });
      expect(matches.map((m) => `${m.path}:${m.lineNum}`)).toEqual([
        "a.txt:1",
        "a.txt:2",
        "m.txt:1",
        "z.txt:1",
        "z.txt:2",
      ]);
    } finally {
      cleanup();
    }
  });
});

describe("collectGrep — regex errors", () => {
  test("bad regex throws ValidationError", async () => {
    const { cwd, cleanup } = makeSandbox({ "a.txt": "foo" });
    try {
      await expect(collectGrep({ cwd, pattern: "[unclosed" })).rejects.toThrow(
        ValidationError
      );
    } finally {
      cleanup();
    }
  });

  test("pre-compiled RegExp used verbatim", async () => {
    const { cwd, cleanup } = makeSandbox({
      "a.txt": "Foo\nfoo\nFOO",
    });
    try {
      const { matches } = await collectGrep({ cwd, pattern: /foo/i });
      expect(matches.length).toBe(3);
    } finally {
      cleanup();
    }
  });
});

describe("grepFiles — iterable variant", () => {
  test("yields matches lazily", async () => {
    const { cwd, cleanup } = makeSandbox({
      "a.txt": "hit\nhit\nhit\nhit\nhit",
    });
    try {
      const collected: number[] = [];
      for await (const match of grepFiles({ cwd, pattern: "hit" })) {
        collected.push(match.lineNum);
        if (collected.length === 2) {
          break;
        }
      }
      expect(collected.length).toBe(2);
    } finally {
      cleanup();
    }
  });

  test("AbortSignal fires mid-iteration", async () => {
    // Many files so the walker has work to do while the abort fires.
    const layout: Record<string, string> = {};
    for (let i = 0; i < 20; i += 1) {
      layout[`dir${i}/file.txt`] = "hit\nhit\nhit";
    }
    const { cwd, cleanup } = makeSandbox(layout);
    try {
      const controller = new AbortController();
      const iter = grepFiles({
        cwd,
        pattern: "hit",
        signal: controller.signal,
        concurrency: 2,
      });
      let yields = 0;
      let threw: unknown = null;
      try {
        for await (const _ of iter) {
          yields += 1;
          if (yields === 2) {
            controller.abort();
          }
        }
      } catch (error) {
        threw = error;
      }
      expect(threw).toBeInstanceOf(DOMException);
      expect((threw as DOMException).name).toBe("AbortError");
    } finally {
      cleanup();
    }
  });
});

describe("collectGrep — pre-compiled RegExp isolation", () => {
  test("concurrent workers each emit every match for a shared RegExp", async () => {
    // Guards against a foot-gun identified in review: when a caller
    // passes a pre-compiled `/gm` RegExp, `ensureGlobalMultilineFlags`
    // returns the same object, which workers mutate via
    // `regex.exec`'s `lastIndex`. Today the match loop is fully
    // synchronous so JS's single-threaded microtask model hides the
    // sharing — but if anyone introduces an `await` inside the loop
    // the bug would manifest. The fix is a per-file `new RegExp(...)`
    // clone. This test exercises the shared-regex shape so a
    // regression would blow up here before landing.
    const PATTERN_LINE = "hit-marker-unique-42";
    const NUM_FILES = 30;
    const MATCHES_PER_FILE = 5;
    const NOISE_LINES = 200; // large enough to force multi-line scan per file

    const layout: Record<string, string> = {};
    for (let f = 0; f < NUM_FILES; f += 1) {
      const lines: string[] = [];
      for (let i = 0; i < NOISE_LINES; i += 1) {
        lines.push(`noise noise noise line ${i}`);
        if (i % Math.floor(NOISE_LINES / MATCHES_PER_FILE) === 0) {
          lines.push(PATTERN_LINE);
        }
      }
      layout[`file-${f}.txt`] = lines.join("\n");
    }
    const { cwd, cleanup } = makeSandbox(layout);
    try {
      // Pre-compile with /gm — exactly the shape that would have
      // returned-as-is through `ensureGlobalMultilineFlags`.
      const sharedRegex = /hit-marker-unique-\d+/gm;
      const { matches } = await collectGrep({
        cwd,
        pattern: sharedRegex,
        concurrency: 8, // plenty of room for interleaving
      });
      // Each file emits one match per unique-matching line. Across all
      // files, total = NUM_FILES * MATCHES_PER_FILE. If the race were
      // present, some files would miss matches whose `index` is
      // behind a concurrent worker's advanced `lastIndex`.
      const perFile = new Map<string, number>();
      for (const m of matches) {
        perFile.set(m.path, (perFile.get(m.path) ?? 0) + 1);
      }
      expect(perFile.size).toBe(NUM_FILES);
      for (const [file, count] of perFile) {
        expect([file, count]).toEqual([file, MATCHES_PER_FILE]);
      }
    } finally {
      cleanup();
    }
  });
});

describe("collectGrep — literal prefilter fast path", () => {
  /**
   * These tests exercise the `grepByLiteralPrefilter` path that kicks
   * in when the pattern has an extractable literal but isn't itself a
   * pure literal (e.g., `import.*from` → literal `import`). The tests
   * verify both correctness (same results as whole-buffer) and that
   * the multiline-false fallback path produces buffer-anchored
   * matches.
   */

  test("regex with extractable literal produces same matches as whole-buffer", async () => {
    const { cwd, cleanup } = makeSandbox({
      "a.ts": [
        "import { foo } from 'bar';",
        "const x = 42;",
        "import { baz } from 'qux';",
        "// not an import statement",
        "ximport_typeXYZ", // contains "import" but no "from" after
      ].join("\n"),
    });
    try {
      const { matches } = await collectGrep({
        cwd,
        pattern: "import.*from",
      });
      // Two true matches: lines 1 and 3. Line 5 has "import" but no
      // "from" after — literal prefilter catches it as a candidate
      // but regex verify rejects it.
      expect(matches.map((m) => m.lineNum)).toEqual([1, 3]);
    } finally {
      cleanup();
    }
  });

  test("literal prefilter correctly handles escape sequences like Sentry\\.init", async () => {
    const { cwd, cleanup } = makeSandbox({
      "a.ts": [
        "import * as Sentry from 'sentry';",
        "Sentry.init({ dsn: '...' });",
        "const x = Sentryxinit; // not a match",
      ].join("\n"),
    });
    try {
      const { matches } = await collectGrep({
        cwd,
        pattern: "Sentry\\.init",
      });
      expect(matches).toHaveLength(1);
      expect(matches[0].lineNum).toBe(2);
    } finally {
      cleanup();
    }
  });

  test("case-insensitive literal prefilter finds all casings", async () => {
    const { cwd, cleanup } = makeSandbox({
      "a.ts": ["IMPORT X FROM Y", "import y from z", "Import Z From W"].join(
        "\n"
      ),
    });
    try {
      const { matches } = await collectGrep({
        cwd,
        pattern: "import.*from",
        caseSensitive: false,
      });
      expect(matches).toHaveLength(3);
    } finally {
      cleanup();
    }
  });

  test("literal prefilter correctly handles file with zero literal hits", async () => {
    // Pattern `import.*from` extracts literal "import". This file
    // contains no "import" substring at all — prefilter short-
    // circuits without running the regex.
    const { cwd, cleanup } = makeSandbox({
      "a.ts": "const x = 42;\nconst y = x + 1;\n",
    });
    try {
      const { matches } = await collectGrep({
        cwd,
        pattern: "import.*from",
      });
      expect(matches).toEqual([]);
    } finally {
      cleanup();
    }
  });

  test("pure literal patterns go through whole-buffer (not prefilter)", async () => {
    // `SENTRY_DSN` is a pure literal — the extractor returns it but
    // `isPureLiteral` flags it, so we skip the prefilter (would add
    // overhead without benefit — the regex engine is already optimal
    // for pure literals). Behavior test: identical results.
    const { cwd, cleanup } = makeSandbox({
      "a.ts": "const SENTRY_DSN = 'abc';\nconst other = 1;\nSENTRY_DSN again",
    });
    try {
      const { matches } = await collectGrep({
        cwd,
        pattern: "SENTRY_DSN",
      });
      expect(matches.map((m) => m.lineNum)).toEqual([1, 3]);
    } finally {
      cleanup();
    }
  });

  test("patterns with top-level alternation go through whole-buffer", async () => {
    // `foo|bar` has no extractable literal (extractor bails on
    // alternation). Must use whole-buffer path.
    const { cwd, cleanup } = makeSandbox({
      "a.ts": "has foo\nhas bar\nhas qux",
    });
    try {
      const { matches } = await collectGrep({
        cwd,
        pattern: "foo|bar",
      });
      expect(matches.map((m) => m.lineNum)).toEqual([1, 2]);
    } finally {
      cleanup();
    }
  });
});
