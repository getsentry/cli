/**
 * Tests for the OpenTUI dashboard renderer (`dashboard-tui.ts`).
 *
 * The renderer is a thin bridge: it lazy-imports OpenTUI, mounts
 * the React tree from `dashboard-app.tsx` into an off-screen test
 * renderer, and captures the rendered character grid as a string.
 *
 * These tests exercise the bridge end-to-end (real OpenTUI test
 * renderer, real React reconciler) and assert on coarse properties
 * of the captured frame:
 *
 *   - Dashboard title is in the output
 *   - Period badge is present
 *   - Widget titles appear
 *   - Box-drawing characters frame the widgets
 *
 * We don't snapshot the exact frame content because OpenTUI's
 * layout engine can shift cell positions between releases — coarse
 * "this content is somewhere in the output" assertions are
 * resilient enough to keep the suite green across upstream
 * upgrades.
 *
 * Skipped on Node test runs (Bun's `bun test` is required) because
 * OpenTUI's Zig bindings only load under the Bun runtime.
 */

import { describe, expect, test } from "bun:test";
import type { DashboardViewData } from "../../../src/lib/formatters/dashboard.js";
import { renderDashboardTui } from "../../../src/lib/formatters/dashboard-tui.js";

const SAMPLE_DATA: DashboardViewData = {
  id: "42",
  title: "Test Dashboard",
  period: "24h",
  fetchedAt: "2024-01-15T10:30:00Z",
  url: "https://sentry.io/organizations/test/dashboard/42/",
  environment: ["production"],
  widgets: [
    {
      title: "Big Number Widget",
      displayType: "big_number",
      layout: { x: 0, y: 0, w: 2, h: 2 },
      data: { type: "scalar", value: 42_000, unit: null },
    },
    {
      title: "Time Series Widget",
      displayType: "line",
      layout: { x: 2, y: 0, w: 4, h: 2 },
      data: {
        type: "timeseries",
        series: [
          {
            label: "errors",
            unit: null,
            values: [
              { timestamp: 1, value: 10 },
              { timestamp: 2, value: 20 },
              { timestamp: 3, value: 15 },
              { timestamp: 4, value: 30 },
            ],
          },
        ],
      },
    },
  ],
};

describe("renderDashboardTui", () => {
  test("renders the dashboard title in the output", async () => {
    const output = await renderDashboardTui(SAMPLE_DATA);
    expect(output).toContain("Test Dashboard");
  });

  test("renders the period badge", async () => {
    const output = await renderDashboardTui(SAMPLE_DATA);
    expect(output).toContain("24h");
  });

  test("renders the environment badge", async () => {
    const output = await renderDashboardTui(SAMPLE_DATA);
    expect(output).toContain("production");
  });

  test("renders widget titles", async () => {
    const output = await renderDashboardTui(SAMPLE_DATA);
    expect(output).toContain("Big Number Widget");
    expect(output).toContain("Time Series Widget");
  });

  test("draws bordered widget boxes", async () => {
    const output = await renderDashboardTui(SAMPLE_DATA);
    // Rounded box-drawing corners — at least one of each must
    // appear since we render two bordered widgets.
    expect(output).toContain("╭");
    expect(output).toContain("╯");
  });

  test("returns a non-empty string", async () => {
    const output = await renderDashboardTui(SAMPLE_DATA);
    expect(output.length).toBeGreaterThan(0);
  });

  test("trims trailing blank lines", async () => {
    const output = await renderDashboardTui(SAMPLE_DATA);
    // The captured frame is sized to a generous render height,
    // but the bridge strips trailing whitespace lines so output
    // doesn't pad scrollback. Last line should be non-blank.
    const lines = output.split("\n");
    const lastLine = lines.at(-1) ?? "";
    expect(lastLine.trim().length).toBeGreaterThan(0);
  });

  test("handles empty widget list without throwing", async () => {
    const output = await renderDashboardTui({
      ...SAMPLE_DATA,
      widgets: [],
    });
    // Header still renders with no widgets.
    expect(output).toContain("Test Dashboard");
  });

  test("handles widgets without layout (orphans)", async () => {
    const output = await renderDashboardTui({
      ...SAMPLE_DATA,
      widgets: [
        {
          title: "Orphan Widget",
          displayType: "big_number",
          // No layout — should render full-width at the bottom.
          data: { type: "scalar", value: 1, unit: null },
        },
      ],
    });
    expect(output).toContain("Orphan Widget");
  });

  test("handles error widget data", async () => {
    const output = await renderDashboardTui({
      ...SAMPLE_DATA,
      widgets: [
        {
          title: "Errored Widget",
          displayType: "big_number",
          layout: { x: 0, y: 0, w: 6, h: 1 },
          data: { type: "error", message: "API call failed" },
        },
      ],
    });
    expect(output).toContain("Errored Widget");
    expect(output).toContain("API call failed");
  });
});
