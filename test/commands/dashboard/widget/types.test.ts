/**
 * Dashboard Widget Types Command Tests
 *
 * Tests for the widget types command in src/commands/dashboard/widget/types.ts.
 * This is a purely local command (no API calls), so no mocking is needed.
 */

import { describe, expect, mock, test } from "bun:test";

import {
  typesCommand,
  type WidgetTypesResult,
} from "../../../../src/commands/dashboard/widget/types.js";
import {
  DISCOVER_AGGREGATE_FUNCTIONS,
  DISPLAY_TYPES,
  SPAN_AGGREGATE_FUNCTIONS,
  WIDGET_TYPES,
} from "../../../../src/types/dashboard.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockContext() {
  const stdoutWrite = mock(() => true);
  return {
    context: {
      stdout: { write: stdoutWrite },
      stderr: { write: mock(() => true) },
      cwd: "/tmp",
      setContext: mock(() => {
        // no-op for test
      }),
    },
    stdoutWrite,
  };
}

async function runTypesCommand(
  json = true
): Promise<{ output: string; result: WidgetTypesResult }> {
  const { context, stdoutWrite } = createMockContext();
  const func = await typesCommand.loader();
  await func.call(context as never, { json } as never);

  const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
  const result = JSON.parse(output) as WidgetTypesResult;
  return { output, result };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("sentry dashboard widget types", () => {
  test("grid reports 6 columns", async () => {
    const { result } = await runTypesCommand();
    expect(result.grid.columns).toBe(6);
  });

  test("includes all display types", async () => {
    const { result } = await runTypesCommand();
    const names = result.displayTypes.map((dt) => dt.name);
    for (const dt of DISPLAY_TYPES) {
      expect(names).toContain(dt);
    }
    expect(result.displayTypes).toHaveLength(DISPLAY_TYPES.length);
  });

  test("big_number has correct default size", async () => {
    const { result } = await runTypesCommand();
    const bigNumber = result.displayTypes.find(
      (dt) => dt.name === "big_number"
    );
    expect(bigNumber).toBeDefined();
    expect(bigNumber!.defaultWidth).toBe(2);
    expect(bigNumber!.defaultHeight).toBe(1);
    expect(bigNumber!.category).toBe("common");
  });

  test("table is full-width", async () => {
    const { result } = await runTypesCommand();
    const table = result.displayTypes.find((dt) => dt.name === "table");
    expect(table).toBeDefined();
    expect(table!.defaultWidth).toBe(6);
    expect(table!.category).toBe("common");
  });

  test("common types are categorized correctly", async () => {
    const { result } = await runTypesCommand();
    const common = result.displayTypes
      .filter((dt) => dt.category === "common")
      .map((dt) => dt.name);
    expect(common).toContain("big_number");
    expect(common).toContain("line");
    expect(common).toContain("area");
    expect(common).toContain("bar");
    expect(common).toContain("table");
  });

  test("includes all datasets", async () => {
    const { result } = await runTypesCommand();
    const names = result.datasets.map((ds) => ds.name);
    for (const wt of WIDGET_TYPES) {
      expect(names).toContain(wt);
    }
    expect(result.datasets).toHaveLength(WIDGET_TYPES.length);
  });

  test("spans is the default dataset", async () => {
    const { result } = await runTypesCommand();
    const defaults = result.datasets.filter((ds) => ds.isDefault);
    expect(defaults).toHaveLength(1);
    expect(defaults[0]!.name).toBe("spans");
  });

  test("span aggregate functions are included", async () => {
    const { result } = await runTypesCommand();
    const fns = result.aggregateFunctions.spans;
    expect(fns).toContain("count");
    expect(fns).toContain("p95");
    expect(fns).toContain("avg");
    expect(fns).toContain("sum");
    expect(fns.length).toBe(SPAN_AGGREGATE_FUNCTIONS.length);
  });

  test("discover aggregates are a superset of span aggregates", async () => {
    const { result } = await runTypesCommand();
    const spanSet = new Set(result.aggregateFunctions.spans);
    const discoverSet = new Set(result.aggregateFunctions.discover);
    for (const fn of spanSet) {
      expect(discoverSet.has(fn)).toBe(true);
    }
    expect(discoverSet.size).toBeGreaterThan(spanSet.size);
    expect(result.aggregateFunctions.discover.length).toBe(
      DISCOVER_AGGREGATE_FUNCTIONS.length
    );
  });

  test("aggregate aliases are included", async () => {
    const { result } = await runTypesCommand();
    expect(result.aggregateAliases.spm).toBe("epm");
    expect(result.aggregateAliases.tpm).toBe("epm");
    expect(result.aggregateAliases.sps).toBe("eps");
    expect(result.aggregateAliases.tps).toBe("eps");
  });

  test("human output contains grid info and display types", async () => {
    const { context, stdoutWrite } = createMockContext();
    const func = await typesCommand.loader();
    await func.call(context as never, { json: false } as never);

    const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("6 columns");
    expect(output).toContain("big_number");
    expect(output).toContain("table");
    expect(output).toContain("spans");
    expect(output).toContain("count");
  });
});
