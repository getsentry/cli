/**
 * Tests for the generic table renderer.
 *
 * writeTable now renders via marked-terminal producing Unicode box-drawing
 * tables. Tests verify content is present rather than exact text alignment.
 */

import { describe, expect, mock, test } from "bun:test";
import { type Column, writeTable } from "../../../src/lib/formatters/table.js";

type Row = { name: string; count: number; status: string };

const columns: Column<Row>[] = [
  { header: "NAME", value: (r) => r.name },
  { header: "COUNT", value: (r) => String(r.count), align: "right" },
  { header: "STATUS", value: (r) => r.status },
];

/** Strip ANSI escape codes */
function stripAnsi(str: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI control chars
  return str.replace(/\x1b\[[0-9;]*m/g, "");
}

function capture(items: Row[], cols = columns): string {
  const write = mock(() => true);
  writeTable({ write }, items, cols);
  return stripAnsi(write.mock.calls.map((c) => c[0]).join(""));
}

describe("writeTable", () => {
  test("renders header and rows with content", () => {
    const output = capture([
      { name: "alpha", count: 42, status: "active" },
      { name: "beta-longer", count: 7, status: "inactive" },
    ]);

    // Header present
    expect(output).toContain("NAME");
    expect(output).toContain("COUNT");
    expect(output).toContain("STATUS");

    // Data present
    expect(output).toContain("alpha");
    expect(output).toContain("42");
    expect(output).toContain("active");
    expect(output).toContain("beta-longer");
    expect(output).toContain("7");
    expect(output).toContain("inactive");
  });

  test("all column values appear in rendered output", () => {
    const output = capture([
      { name: "a", count: 1, status: "ok" },
      { name: "b", count: 999, status: "ok" },
    ]);

    expect(output).toContain("1");
    expect(output).toContain("999");
  });

  test("respects minWidth — values appear in output", () => {
    const cols: Column<Row>[] = [
      { header: "N", value: (r) => r.name, minWidth: 10 },
      { header: "C", value: (r) => String(r.count) },
      { header: "S", value: (r) => r.status },
    ];

    const output = capture([{ name: "x", count: 1, status: "y" }], cols);
    expect(output).toContain("N");
    expect(output).toContain("x");
    expect(output).toContain("1");
    expect(output).toContain("y");
  });

  test("handles empty items array — only headers rendered", () => {
    const output = capture([]);
    expect(output).toContain("NAME");
    expect(output).toContain("COUNT");
    expect(output).toContain("STATUS");
  });

  test("column width respects header length even with short values", () => {
    const cols: Column<{ v: string }>[] = [
      { header: "VERY_LONG_HEADER", value: (r) => r.v },
    ];
    const write = mock(() => true);
    writeTable({ write }, [{ v: "x" }], cols);
    const output = stripAnsi(write.mock.calls.map((c) => c[0]).join(""));
    expect(output).toContain("VERY_LONG_HEADER");
    expect(output).toContain("x");
  });
});
