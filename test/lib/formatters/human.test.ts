/**
 * Tests for human-readable formatters
 */

import { describe, expect, test } from "bun:test";
import { formatShortId } from "../../../src/lib/formatters/human.js";

// Helper to strip ANSI codes for content testing
function stripAnsi(str: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI codes use control chars
  return str.replace(/\x1b\[[0-9;]*m/g, "");
}

describe("formatShortId", () => {
  describe("without options (passthrough)", () => {
    test("returns uppercase short ID", () => {
      expect(stripAnsi(formatShortId("craft-g"))).toBe("CRAFT-G");
      expect(stripAnsi(formatShortId("CRAFT-G"))).toBe("CRAFT-G");
    });

    test("handles multi-part project names", () => {
      expect(stripAnsi(formatShortId("spotlight-electron-4y"))).toBe(
        "SPOTLIGHT-ELECTRON-4Y"
      );
    });

    test("handles mixed case input", () => {
      expect(stripAnsi(formatShortId("Craft-g"))).toBe("CRAFT-G");
      expect(stripAnsi(formatShortId("SpotLight-Website-2a"))).toBe(
        "SPOTLIGHT-WEBSITE-2A"
      );
    });
  });

  describe("single project mode (projectSlug only)", () => {
    test("formats short ID uppercase", () => {
      const result = formatShortId("CRAFT-G", { projectSlug: "craft" });
      expect(stripAnsi(result)).toBe("CRAFT-G");
    });

    test("handles lowercase input", () => {
      const result = formatShortId("craft-g", { projectSlug: "craft" });
      expect(stripAnsi(result)).toBe("CRAFT-G");
    });

    test("handles multi-character suffix", () => {
      const result = formatShortId("PROJECT-A3B", { projectSlug: "project" });
      expect(stripAnsi(result)).toBe("PROJECT-A3B");
    });

    test("handles legacy string parameter", () => {
      const result = formatShortId("CRAFT-G", "craft");
      expect(stripAnsi(result)).toBe("CRAFT-G");
    });

    test("handles multi-part project slug", () => {
      const result = formatShortId("SPOTLIGHT-ELECTRON-4Y", {
        projectSlug: "spotlight-electron",
      });
      expect(stripAnsi(result)).toBe("SPOTLIGHT-ELECTRON-4Y");
    });
  });

  describe("multi-project mode (with projectAlias)", () => {
    test("formats simple project name uppercase", () => {
      const result = formatShortId("FRONTEND-G", {
        projectSlug: "frontend",
        projectAlias: "f",
      });
      expect(stripAnsi(result)).toBe("FRONTEND-G");
    });

    test("formats multi-char alias project uppercase", () => {
      const result = formatShortId("FRONTEND-G", {
        projectSlug: "frontend",
        projectAlias: "fr",
      });
      expect(stripAnsi(result)).toBe("FRONTEND-G");
    });

    test("formats spotlight-website with stripped prefix", () => {
      const result = formatShortId("SPOTLIGHT-WEBSITE-2A", {
        projectSlug: "spotlight-website",
        projectAlias: "w",
        strippedPrefix: "spotlight-",
      });
      expect(stripAnsi(result)).toBe("SPOTLIGHT-WEBSITE-2A");
    });

    test("formats spotlight-electron with stripped prefix", () => {
      const result = formatShortId("SPOTLIGHT-ELECTRON-4Y", {
        projectSlug: "spotlight-electron",
        projectAlias: "e",
        strippedPrefix: "spotlight-",
      });
      expect(stripAnsi(result)).toBe("SPOTLIGHT-ELECTRON-4Y");
    });

    test("formats spotlight (no stripped prefix applies) correctly", () => {
      const result = formatShortId("SPOTLIGHT-73", {
        projectSlug: "spotlight",
        projectAlias: "s",
        strippedPrefix: "spotlight-",
      });
      expect(stripAnsi(result)).toBe("SPOTLIGHT-73");
    });

    test("formats project without stripped prefix", () => {
      const result = formatShortId("BACKEND-A3", {
        projectSlug: "backend",
        projectAlias: "b",
      });
      expect(stripAnsi(result)).toBe("BACKEND-A3");
    });

    test("handles lowercase input in multi-project mode", () => {
      const result = formatShortId("spotlight-website-2a", {
        projectSlug: "spotlight-website",
        projectAlias: "w",
        strippedPrefix: "spotlight-",
      });
      expect(stripAnsi(result)).toBe("SPOTLIGHT-WEBSITE-2A");
    });
  });

  describe("output is always uppercase", () => {
    const testCases = [
      { input: "craft-g", expected: "CRAFT-G" },
      { input: "CRAFT-G", expected: "CRAFT-G" },
      { input: "Craft-G", expected: "CRAFT-G" },
      { input: "spotlight-website-2a", expected: "SPOTLIGHT-WEBSITE-2A" },
      { input: "SPOTLIGHT-WEBSITE-2A", expected: "SPOTLIGHT-WEBSITE-2A" },
    ];

    for (const { input, expected } of testCases) {
      test(`"${input}" becomes "${expected}"`, () => {
        expect(stripAnsi(formatShortId(input))).toBe(expected);
      });
    }

    test("single project mode outputs uppercase", () => {
      const result = formatShortId("craft-g", { projectSlug: "craft" });
      expect(stripAnsi(result)).toBe("CRAFT-G");
    });

    test("multi-project mode outputs uppercase", () => {
      const result = formatShortId("spotlight-website-2a", {
        projectSlug: "spotlight-website",
        projectAlias: "w",
        strippedPrefix: "spotlight-",
      });
      expect(stripAnsi(result)).toBe("SPOTLIGHT-WEBSITE-2A");
    });
  });

  describe("edge cases", () => {
    test("handles empty options object", () => {
      expect(stripAnsi(formatShortId("CRAFT-G", {}))).toBe("CRAFT-G");
    });

    test("handles undefined options", () => {
      expect(stripAnsi(formatShortId("CRAFT-G", undefined))).toBe("CRAFT-G");
    });

    test("handles mismatched project slug gracefully", () => {
      const result = formatShortId("CRAFT-G", { projectSlug: "other" });
      expect(stripAnsi(result)).toBe("CRAFT-G");
    });

    test("handles numeric-only suffix", () => {
      const result = formatShortId("PROJECT-123", { projectSlug: "project" });
      expect(stripAnsi(result)).toBe("PROJECT-123");
    });

    test("handles single character suffix", () => {
      const result = formatShortId("PROJECT-A", { projectSlug: "project" });
      expect(stripAnsi(result)).toBe("PROJECT-A");
    });

    test("handles long suffix", () => {
      const result = formatShortId("PROJECT-ABCDEF123", {
        projectSlug: "project",
      });
      expect(stripAnsi(result)).toBe("PROJECT-ABCDEF123");
    });
  });

  describe("display length consistency", () => {
    test("display length matches raw short ID length", () => {
      const shortId = "SPOTLIGHT-WEBSITE-2A";
      const formatted = formatShortId(shortId, {
        projectSlug: "spotlight-website",
        projectAlias: "w",
        strippedPrefix: "spotlight-",
      });
      expect(stripAnsi(formatted).length).toBe(shortId.length);
    });

    test("display length consistent across all modes", () => {
      const shortId = "CRAFT-G";

      const noOptions = formatShortId(shortId);
      const singleProject = formatShortId(shortId, { projectSlug: "craft" });
      const multiProject = formatShortId(shortId, {
        projectSlug: "craft",
        projectAlias: "c",
      });

      expect(stripAnsi(noOptions).length).toBe(shortId.length);
      expect(stripAnsi(singleProject).length).toBe(shortId.length);
      expect(stripAnsi(multiProject).length).toBe(shortId.length);
    });

    test("long project names maintain correct length", () => {
      const shortId = "SPOTLIGHT-ELECTRON-4Y";
      const formatted = formatShortId(shortId, {
        projectSlug: "spotlight-electron",
        projectAlias: "e",
        strippedPrefix: "spotlight-",
      });
      expect(stripAnsi(formatted).length).toBe(shortId.length);
    });
  });

  describe("real-world scenarios", () => {
    test("spotlight monorepo: electron project", () => {
      const result = formatShortId("SPOTLIGHT-ELECTRON-4Y", {
        projectSlug: "spotlight-electron",
        projectAlias: "e",
        strippedPrefix: "spotlight-",
      });
      expect(stripAnsi(result)).toBe("SPOTLIGHT-ELECTRON-4Y");
    });

    test("spotlight monorepo: website project", () => {
      const result = formatShortId("SPOTLIGHT-WEBSITE-2C", {
        projectSlug: "spotlight-website",
        projectAlias: "w",
        strippedPrefix: "spotlight-",
      });
      expect(stripAnsi(result)).toBe("SPOTLIGHT-WEBSITE-2C");
    });

    test("spotlight monorepo: main spotlight project", () => {
      const result = formatShortId("SPOTLIGHT-73", {
        projectSlug: "spotlight",
        projectAlias: "s",
        strippedPrefix: "spotlight-",
      });
      expect(stripAnsi(result)).toBe("SPOTLIGHT-73");
    });

    test("simple monorepo without common prefix", () => {
      const results = [
        formatShortId("FRONTEND-A1", {
          projectSlug: "frontend",
          projectAlias: "f",
        }),
        formatShortId("BACKEND-B2", {
          projectSlug: "backend",
          projectAlias: "b",
        }),
        formatShortId("WORKER-C3", {
          projectSlug: "worker",
          projectAlias: "w",
        }),
      ];

      expect(stripAnsi(results[0])).toBe("FRONTEND-A1");
      expect(stripAnsi(results[1])).toBe("BACKEND-B2");
      expect(stripAnsi(results[2])).toBe("WORKER-C3");
    });
  });
});
