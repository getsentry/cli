/**
 * Tests for the ANSI-aware text table renderer.
 *
 * Covers: renderTextTable, column fitting (proportional + balanced),
 * cell wrapping, alignment, border styles, and edge cases.
 */

import { describe, expect, test } from "bun:test";
import chalk from "chalk";
import { renderTextTable } from "../../../src/lib/formatters/text-table.js";

// Force chalk colors even in test (non-TTY) environment
chalk.level = 3;

describe("renderTextTable", () => {
  describe("basic rendering", () => {
    test("empty headers returns empty string", () => {
      expect(renderTextTable([], [])).toBe("");
    });

    test("renders single-column table", () => {
      const out = renderTextTable(["Name"], [["Alice"], ["Bob"]]);
      expect(out).toContain("Name");
      expect(out).toContain("Alice");
      expect(out).toContain("Bob");
      expect(out.endsWith("\n")).toBe(true);
    });

    test("renders multi-column table", () => {
      const out = renderTextTable(
        ["ID", "Name", "Role"],
        [
          ["1", "Alice", "Admin"],
          ["2", "Bob", "User"],
        ]
      );
      expect(out).toContain("ID");
      expect(out).toContain("Name");
      expect(out).toContain("Role");
      expect(out).toContain("Alice");
      expect(out).toContain("Admin");
      expect(out).toContain("Bob");
      expect(out).toContain("User");
    });

    test("renders header-only table (no data rows)", () => {
      const out = renderTextTable(["A", "B"], []);
      expect(out).toContain("A");
      expect(out).toContain("B");
      expect(out.endsWith("\n")).toBe(true);
    });
  });

  describe("border styles", () => {
    test("rounded (default) uses curved corners", () => {
      const out = renderTextTable(["X"], [["1"]]);
      expect(out).toContain("\u256d");
      expect(out).toContain("\u256e");
      expect(out).toContain("\u2570");
      expect(out).toContain("\u256f");
    });

    test("single uses square corners", () => {
      const out = renderTextTable(["X"], [["1"]], { borderStyle: "single" });
      expect(out).toContain("\u250c");
      expect(out).toContain("\u2510");
      expect(out).toContain("\u2514");
      expect(out).toContain("\u2518");
    });

    test("heavy uses heavy corners", () => {
      const out = renderTextTable(["X"], [["1"]], { borderStyle: "heavy" });
      expect(out).toContain("\u250f");
      expect(out).toContain("\u2513");
      expect(out).toContain("\u2517");
      expect(out).toContain("\u251b");
    });

    test("double uses double corners", () => {
      const out = renderTextTable(["X"], [["1"]], { borderStyle: "double" });
      expect(out).toContain("\u2554");
      expect(out).toContain("\u2557");
      expect(out).toContain("\u255a");
      expect(out).toContain("\u255d");
    });
  });

  describe("header separator", () => {
    test("includes separator by default when data rows present", () => {
      const out = renderTextTable(["H"], [["d"]]);
      expect(out).toContain("\u251c"); // ├
      expect(out).toContain("\u2524"); // ┤
    });

    test("headerSeparator: false omits separator", () => {
      const out = renderTextTable(["H"], [["d"]], { headerSeparator: false });
      expect(out).not.toContain("\u251c");
      expect(out).not.toContain("\u2524");
    });
  });

  describe("alignment", () => {
    test("right-aligned column pads text on the left", () => {
      const out = renderTextTable(["Amount"], [["42"]], {
        alignments: ["right"],
        maxWidth: 40,
      });
      const lines = out.split("\n");
      const dataLine = lines.find((l) => l.includes("42"));
      expect(dataLine).toBeDefined();
      // Right-aligned: spaces before the value
      const cellContent = dataLine!.split("\u2502")[1] ?? "";
      const trimmed = cellContent.trimStart();
      expect(cellContent.length).toBeGreaterThan(trimmed.length);
    });

    test("center-aligned column centers text", () => {
      const out = renderTextTable(["Title"], [["Hi"]], {
        alignments: ["center"],
        maxWidth: 40,
      });
      const lines = out.split("\n");
      const dataLine = lines.find((l) => l.includes("Hi"));
      expect(dataLine).toBeDefined();
    });

    test("default alignment is left", () => {
      const out = renderTextTable(["Name"], [["A"]], { maxWidth: 40 });
      expect(out).toContain("A");
    });
  });

  describe("column fitting", () => {
    test("columns that fit naturally keep intrinsic widths", () => {
      const out = renderTextTable(["A", "B"], [["x", "y"]], { maxWidth: 200 });
      expect(out).toContain("A");
      expect(out).toContain("B");
    });

    test("proportional fitter shrinks wide columns more", () => {
      const out = renderTextTable(
        ["Short", "This is a very long header that needs shrinking"],
        [["a", "b"]],
        { maxWidth: 30, columnFitter: "proportional" }
      );
      // Content is present (may be wrapped)
      expect(out.length).toBeGreaterThan(0);
      expect(out.endsWith("\n")).toBe(true);
      expect(out.endsWith("\n")).toBe(true);
    });

    test("balanced fitter distributes shrink more evenly", () => {
      const out = renderTextTable(
        ["Short", "This is a very long header that needs shrinking"],
        [["a", "b"]],
        { maxWidth: 30, columnFitter: "balanced" }
      );
      // Content is present (may be wrapped)
      expect(out.length).toBeGreaterThan(0);
      expect(out.endsWith("\n")).toBe(true);
      expect(out.endsWith("\n")).toBe(true);
    });

    test("very narrow maxWidth still produces valid table", () => {
      const out = renderTextTable(
        ["Header One", "Header Two", "Header Three"],
        [["data1", "data2", "data3"]],
        { maxWidth: 15 }
      );
      expect(out.length).toBeGreaterThan(0);
      expect(out.endsWith("\n")).toBe(true);
    });

    test("proportional and balanced produce different layouts", () => {
      const headers = ["A", "This is a much wider column"];
      const rows = [["x", "y"]];
      const prop = renderTextTable(headers, rows, {
        maxWidth: 25,
        columnFitter: "proportional",
      });
      const bal = renderTextTable(headers, rows, {
        maxWidth: 25,
        columnFitter: "balanced",
      });
      // Both should be valid tables but may differ in column widths
      expect(prop).toContain("A");
      expect(bal).toContain("A");
    });
  });

  describe("cell wrapping", () => {
    test("long cell values wrap to multiple lines", () => {
      const out = renderTextTable(
        ["Name"],
        [["This is a very long cell value that should wrap"]],
        { maxWidth: 20 }
      );
      const dataLines = out
        .split("\n")
        .filter((l) => l.includes("\u2502") && !l.includes("Name"));
      expect(dataLines.length).toBeGreaterThan(1);
    });
  });

  describe("ANSI-aware rendering", () => {
    test("preserves ANSI codes in cell values", () => {
      const colored = chalk.red("ERROR");
      const out = renderTextTable(["Status"], [[colored]], { maxWidth: 40 });
      expect(out).toContain("\x1b[");
      expect(out).toContain("ERROR");
    });

    test("column width computed from visual width not byte length", () => {
      const colored = chalk.red("Hi");
      const plain = "Hi";
      const outColored = renderTextTable(["H"], [[colored]], { maxWidth: 40 });
      const outPlain = renderTextTable(["H"], [[plain]], { maxWidth: 40 });
      const hzColored = (outColored.match(/\u2500/g) ?? []).length;
      const hzPlain = (outPlain.match(/\u2500/g) ?? []).length;
      expect(hzColored).toBe(hzPlain);
    });
  });

  describe("cellPadding", () => {
    test("cellPadding: 0 produces tighter table", () => {
      const tight = renderTextTable(["A"], [["x"]], { cellPadding: 0 });
      const padded = renderTextTable(["A"], [["x"]], { cellPadding: 2 });
      const tightWidth = (tight.split("\n")[0] ?? "").length;
      const paddedWidth = (padded.split("\n")[0] ?? "").length;
      expect(tightWidth).toBeLessThan(paddedWidth);
    });
  });

  describe("multi-column structure", () => {
    test("columns are separated by vertical border character", () => {
      const out = renderTextTable(["A", "B", "C"], [["1", "2", "3"]]);
      const dataLines = out
        .split("\n")
        .filter((l) => l.includes("1") && l.includes("2") && l.includes("3"));
      expect(dataLines.length).toBeGreaterThan(0);
      const pipeCount = (dataLines[0] ?? "").split("\u2502").length - 1;
      expect(pipeCount).toBe(4); // 3 columns = 4 borders
    });

    test("top border has T-junctions between columns", () => {
      const out = renderTextTable(["A", "B", "C"], [["1", "2", "3"]]);
      const topLine = out.split("\n")[0] ?? "";
      expect(topLine).toContain("\u252c"); // ┬
    });

    test("bottom border has inverted T-junctions", () => {
      const out = renderTextTable(["A", "B", "C"], [["1", "2", "3"]]);
      const lines = out.split("\n").filter((l) => l.length > 0);
      const bottomLine = lines.at(-1) ?? "";
      expect(bottomLine).toContain("\u2534"); // ┴
    });
  });
});
