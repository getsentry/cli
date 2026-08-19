/**
 * Dashboard sixel integration tests.
 *
 * Stubs `canRenderSixel` and `terminalPixelWidth` so the dashboard formatter
 * takes the sixel rendering path deterministically, then verifies that the
 * output contains a sixel DCS sequence for eligible timeseries widgets.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  type DashboardViewData,
  type DashboardViewWidget,
  formatDashboardWithData,
} from "../../../src/lib/formatters/dashboard.js";
// biome-ignore lint/performance/noNamespaceImport: needed for vi.spyOn mocking
import * as sixelModule from "../../../src/lib/sixel.js";
import type { TimeseriesResult } from "../../../src/types/dashboard.js";

const ESC = "\x1b";

function makeTimeseries(
  overrides: Partial<TimeseriesResult> = {}
): TimeseriesResult {
  return {
    type: "timeseries",
    series: [
      {
        label: "count()",
        values: [
          { timestamp: 1_700_000_000, value: 10 },
          { timestamp: 1_700_000_060, value: 20 },
          { timestamp: 1_700_000_120, value: 15 },
          { timestamp: 1_700_000_180, value: 30 },
        ],
      },
    ],
    ...overrides,
  };
}

function makeWidget(
  overrides: Partial<DashboardViewWidget> = {}
): DashboardViewWidget {
  return {
    title: "Test Widget",
    displayType: "line",
    data: makeTimeseries(),
    ...overrides,
  };
}

function makeDashboardData(
  overrides: Partial<DashboardViewData> = {}
): DashboardViewData {
  return {
    id: "12345",
    title: "My Dashboard",
    period: "24h",
    fetchedAt: "2024-01-15T10:30:00Z",
    url: "https://sentry.io/organizations/test-org/dashboard/12345/",
    environment: ["production"],
    widgets: [makeWidget()],
    ...overrides,
  };
}

describe("dashboard sixel integration", () => {
  let savedSixelEnv: string | undefined;

  beforeEach(() => {
    savedSixelEnv = process.env.SENTRY_DASHBOARD_SIXEL;
    process.env.SENTRY_DASHBOARD_SIXEL = "1";
    process.env.SENTRY_PLAIN_OUTPUT = "0";
    vi.spyOn(sixelModule, "canRenderSixel").mockReturnValue(true);
    vi.spyOn(sixelModule, "terminalPixelWidth").mockReturnValue(320);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (savedSixelEnv === undefined) {
      delete process.env.SENTRY_DASHBOARD_SIXEL;
    } else {
      process.env.SENTRY_DASHBOARD_SIXEL = savedSixelEnv;
    }
  });

  test("renders a sixel DCS sequence for timeseries widgets when enabled", () => {
    const data = makeDashboardData({
      widgets: [
        makeWidget({
          title: "Sixel Chart",
          displayType: "line",
          layout: { x: 0, y: 0, w: 6, h: 2 },
        }),
      ],
    });

    const output = formatDashboardWithData(data);
    expect(output).toContain(`${ESC}P`);
    expect(output).toContain(`${ESC}\\`);
    expect(output).toContain("Sixel Chart");
  });

  test("uses displayType=timeseries_sixel as an opt-in signal", () => {
    const data = makeDashboardData({
      widgets: [
        makeWidget({
          title: "Explicit Sixel",
          displayType: "timeseries_sixel",
          layout: { x: 0, y: 0, w: 6, h: 2 },
        }),
      ],
    });
    // Disable the env flag so only the displayType triggers sixel rendering.
    delete process.env.SENTRY_DASHBOARD_SIXEL;

    const output = formatDashboardWithData(data);
    expect(output).toContain(`${ESC}P`);
    expect(output).toContain(`${ESC}\\`);
    expect(output).toContain("Explicit Sixel");
  });

  test("does not emit sixel for non-timeseries widget types", () => {
    const data = makeDashboardData({
      widgets: [
        makeWidget({
          title: "Big Number",
          displayType: "big_number",
          data: { type: "scalar", value: 42 },
          layout: { x: 0, y: 0, w: 3, h: 1 },
        }),
        makeWidget({
          title: "Sixel Chart",
          displayType: "line",
          layout: { x: 3, y: 0, w: 3, h: 2 },
        }),
      ],
    });

    const output = formatDashboardWithData(data);
    expect(output).toContain("Big Number");
    expect(output).toContain("Sixel Chart");
    expect(output).toContain(`${ESC}P`);
    expect(output).toContain(`${ESC}\\`);
  });

  test("categorical_bar widgets keep the ASCII renderer, not sixel", () => {
    const data = makeDashboardData({
      widgets: [
        makeWidget({
          title: "Categorical",
          displayType: "categorical_bar",
          layout: { x: 0, y: 0, w: 6, h: 2 },
        }),
      ],
    });

    const output = formatDashboardWithData(data);
    expect(output).toContain("Categorical");
    // The chart core has no categorical mode, so these must not be rasterized.
    expect(output).not.toContain(`${ESC}P`);
  });

  test("sixel widgets render as a standalone block, keeping the grid intact", () => {
    const data = makeDashboardData({
      widgets: [
        makeWidget({
          title: "Big Number",
          displayType: "big_number",
          data: { type: "scalar", value: 42 },
          layout: { x: 0, y: 0, w: 3, h: 2 },
        }),
        makeWidget({
          title: "Sixel Chart",
          displayType: "line",
          layout: { x: 3, y: 0, w: 3, h: 2 },
        }),
      ],
    });

    const output = formatDashboardWithData(data);
    const lines = output.split("\n");
    // The DCS image must not share a terminal row with any bordered widget.
    const sixelLine = lines.find((l) => l.includes(`${ESC}P`));
    expect(sixelLine).toBeDefined();
    expect(sixelLine).not.toContain("│");
    expect(sixelLine).not.toContain("─");
    // The character grid (big-number widget) still renders; the sixel image
    // appears after the grid (full-width, no hole in the packed layout).
    expect(output).toContain("Big Number");
    expect(output).toContain("Sixel Chart");
  });
});
