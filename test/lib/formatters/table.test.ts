/**
 * Tests for the generic table renderer.
 */

import { describe, expect, mock, test } from "bun:test";
import { type Column, writeTable } from "../../../src/lib/formatters/table.js";

type Row = { name: string; count: number; status: string };

const columns: Column<Row>[] = [
  { header: "NAME", value: (r) => r.name },
  { header: "COUNT", value: (r) => String(r.count), align: "right" },
  { header: "STATUS", value: (r) => r.status },
];

function capture(items: Row[], cols = columns): string {
  const write = mock(() => true);
  writeTable({ write }, items, cols);
  return write.mock.calls.map((c) => c[0]).join("");
}

describe("writeTable", () => {
  test("renders header and rows with auto-sized columns", () => {
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

  test("right-aligns columns when specified", () => {
    const output = capture([
      { name: "a", count: 1, status: "ok" },
      { name: "b", count: 999, status: "ok" },
    ]);

    const lines = output.split("\n").filter(Boolean);
    // The COUNT column should have right-aligned values
    // Header: "COUNT" is 5 chars, max value "999" is 3 chars, so width = 5
    // "1" should be padded: "    1" (5 chars, right-aligned)
    const headerLine = lines[0]!;
    const countHeaderIdx = headerLine.indexOf("COUNT");
    expect(countHeaderIdx).toBeGreaterThan(-1);

    // Row with count=1 should have right-padding before count
    const dataLine1 = lines[1]!;
    const countSlice1 = dataLine1.slice(
      countHeaderIdx,
      countHeaderIdx + "COUNT".length
    );
    expect(countSlice1.trim()).toBe("1");
  });

  test("respects minWidth for columns", () => {
    const cols: Column<Row>[] = [
      { header: "N", value: (r) => r.name, minWidth: 10 },
      { header: "C", value: (r) => String(r.count) },
      { header: "S", value: (r) => r.status },
    ];

    const output = capture([{ name: "x", count: 1, status: "y" }], cols);
    const lines = output.split("\n").filter(Boolean);
    // Header "N" should be padded to at least 10 chars
    const headerLine = lines[0]!;
    const firstColEnd = headerLine.indexOf("  C");
    // First column should be at least 10 chars wide
    expect(firstColEnd).toBeGreaterThanOrEqual(10);
  });

  test("handles empty items array (header only)", () => {
    const output = capture([]);
    const lines = output.split("\n").filter(Boolean);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("NAME");
    expect(lines[0]).toContain("COUNT");
    expect(lines[0]).toContain("STATUS");
  });

  test("column width respects header length even with short values", () => {
    const cols: Column<{ v: string }>[] = [
      { header: "VERY_LONG_HEADER", value: (r) => r.v },
    ];
    const write = mock(() => true);
    writeTable({ write }, [{ v: "x" }], cols);
    const output = write.mock.calls.map((c) => c[0]).join("");
    const lines = output.split("\n").filter(Boolean);
    // Header line should have the full header
    expect(lines[0]).toContain("VERY_LONG_HEADER");
    // Data line should be padded to header width
    expect(lines[1]!.length).toBeGreaterThanOrEqual("VERY_LONG_HEADER".length);
  });
});
