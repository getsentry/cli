/**
 * Profile Analyzer Tests
 *
 * Tests for flamegraph analysis utilities in src/lib/profile/analyzer.ts.
 * Combines property-based tests (for pure functions) with unit tests (for analysis).
 */

import { describe, expect, test } from "bun:test";
import { double, assert as fcAssert, integer, nat, property } from "fast-check";
import {
  analyzeFlamegraph,
  analyzeHotPaths,
  calculatePercentiles,
  formatDurationMs,
  hasProfileData,
  nsToMs,
} from "../../../src/lib/profile/analyzer.js";
import type {
  Flamegraph,
  FlamegraphFrame,
  FlamegraphFrameInfo,
} from "../../../src/types/index.js";
import { DEFAULT_NUM_RUNS } from "../../model-based/helpers.js";

// Helpers

function createFrame(
  overrides: Partial<FlamegraphFrame> = {}
): FlamegraphFrame {
  return {
    file: "src/app.ts",
    is_application: true,
    line: 42,
    name: "processRequest",
    fingerprint: 1,
    ...overrides,
  };
}

function createFrameInfo(
  overrides: Partial<FlamegraphFrameInfo> = {}
): FlamegraphFrameInfo {
  return {
    count: 100,
    weight: 5000,
    sumDuration: 10_000_000,
    sumSelfTime: 5_000_000,
    p75Duration: 8_000_000,
    p95Duration: 12_000_000,
    p99Duration: 15_000_000,
    ...overrides,
  };
}

function createFlamegraph(
  frames: FlamegraphFrame[] = [createFrame()],
  frameInfos: FlamegraphFrameInfo[] = [createFrameInfo()]
): Flamegraph {
  return {
    activeProfileIndex: 0,
    platform: "node",
    profiles: [
      {
        endValue: 1000,
        isMainThread: true,
        name: "main",
        samples: [[0], [0, 1]],
        startValue: 0,
        threadID: 1,
        type: "sampled",
        unit: "nanoseconds",
        weights: [100, 200],
      },
    ],
    projectID: 123,
    shared: {
      frames,
      frame_infos: frameInfos,
    },
  };
}

// nsToMs

describe("nsToMs", () => {
  test("property: converts nanoseconds to milliseconds", () => {
    fcAssert(
      property(double({ min: 0, max: 1e15, noNaN: true }), (ns) => {
        expect(nsToMs(ns)).toBeCloseTo(ns / 1_000_000, 5);
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("zero nanoseconds is zero milliseconds", () => {
    expect(nsToMs(0)).toBe(0);
  });

  test("1 million nanoseconds is 1 millisecond", () => {
    expect(nsToMs(1_000_000)).toBe(1);
  });
});

// formatDuration

describe("formatDurationMs", () => {
  test("formats seconds for values >= 1000ms", () => {
    expect(formatDurationMs(1000)).toBe("1.0s");
    expect(formatDurationMs(1500)).toBe("1.5s");
    expect(formatDurationMs(12_345)).toBe("12.3s");
  });

  test("formats whole milliseconds for values >= 100ms", () => {
    expect(formatDurationMs(100)).toBe("100ms");
    expect(formatDurationMs(999)).toBe("999ms");
    expect(formatDurationMs(500)).toBe("500ms");
  });

  test("formats 1 decimal place for values >= 10ms", () => {
    expect(formatDurationMs(10)).toBe("10.0ms");
    expect(formatDurationMs(55.5)).toBe("55.5ms");
    expect(formatDurationMs(99.9)).toBe("99.9ms");
  });

  test("formats 2 decimal places for values >= 1ms", () => {
    expect(formatDurationMs(1)).toBe("1.00ms");
    expect(formatDurationMs(5.55)).toBe("5.55ms");
    expect(formatDurationMs(9.99)).toBe("9.99ms");
  });

  test("formats microseconds for sub-millisecond values", () => {
    expect(formatDurationMs(0.5)).toBe("500\u00B5s");
    expect(formatDurationMs(0.001)).toBe("1\u00B5s");
  });

  test("formats nanoseconds for sub-microsecond values", () => {
    expect(formatDurationMs(0.0001)).toBe("100ns");
    expect(formatDurationMs(0.000_001)).toBe("1ns");
  });

  test("handles boundary rounding: 999.5ms promotes to seconds", () => {
    // Math.round(999.5) = 1000, which should display as "1.0s" not "1000ms"
    expect(formatDurationMs(999.5)).toBe("1.0s");
    expect(formatDurationMs(999.9)).toBe("1.0s");
  });

  test("handles boundary rounding: 99.95ms promotes to whole ms", () => {
    // (99.95).toFixed(1) = "100.0", which should display as "100ms" not "100.0ms"
    expect(formatDurationMs(99.95)).toBe("100ms");
    expect(formatDurationMs(99.99)).toBe("100ms");
  });

  test("property: output always contains a unit", () => {
    fcAssert(
      property(double({ min: 0.000_001, max: 100_000, noNaN: true }), (ms) => {
        const result = formatDurationMs(ms);
        const hasUnit =
          result.endsWith("s") ||
          result.endsWith("ms") ||
          result.endsWith("\u00B5s") ||
          result.endsWith("ns");
        expect(hasUnit).toBe(true);
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("property: output is non-empty for positive values", () => {
    fcAssert(
      property(double({ min: 0.000_001, max: 100_000, noNaN: true }), (ms) => {
        expect(formatDurationMs(ms).length).toBeGreaterThan(0);
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });
});

// hasProfileData

describe("hasProfileData", () => {
  test("returns true when flamegraph has profiles, frames, and frame_infos", () => {
    const flamegraph = createFlamegraph();
    expect(hasProfileData(flamegraph)).toBe(true);
  });

  test("returns false when profiles array is empty", () => {
    const flamegraph = createFlamegraph();
    flamegraph.profiles = [];
    expect(hasProfileData(flamegraph)).toBe(false);
  });

  test("returns false when frames array is empty", () => {
    const flamegraph = createFlamegraph([], [createFrameInfo()]);
    expect(hasProfileData(flamegraph)).toBe(false);
  });

  test("returns false when frame_infos array is empty", () => {
    const flamegraph = createFlamegraph([createFrame()], []);
    expect(hasProfileData(flamegraph)).toBe(false);
  });

  test("returns false when all arrays are empty", () => {
    const flamegraph = createFlamegraph([], []);
    flamegraph.profiles = [];
    expect(hasProfileData(flamegraph)).toBe(false);
  });
});

// analyzeHotPaths

describe("analyzeHotPaths", () => {
  test("returns empty array when no frames exist", () => {
    const flamegraph = createFlamegraph([], []);
    expect(analyzeHotPaths(flamegraph, 10, false)).toEqual([]);
  });

  test("returns empty array when total self time is zero", () => {
    const flamegraph = createFlamegraph(
      [createFrame()],
      [createFrameInfo({ sumSelfTime: 0 })]
    );
    expect(analyzeHotPaths(flamegraph, 10, false)).toEqual([]);
  });

  test("returns hot paths sorted by self time descending", () => {
    const frames = [
      createFrame({ name: "low", fingerprint: 1 }),
      createFrame({ name: "high", fingerprint: 2 }),
      createFrame({ name: "medium", fingerprint: 3 }),
    ];
    const infos = [
      createFrameInfo({ sumSelfTime: 100 }),
      createFrameInfo({ sumSelfTime: 500 }),
      createFrameInfo({ sumSelfTime: 300 }),
    ];

    const flamegraph = createFlamegraph(frames, infos);
    const hotPaths = analyzeHotPaths(flamegraph, 10, false);

    expect(hotPaths.length).toBe(3);
    expect(hotPaths[0]?.frames[0]?.name).toBe("high");
    expect(hotPaths[1]?.frames[0]?.name).toBe("medium");
    expect(hotPaths[2]?.frames[0]?.name).toBe("low");
  });

  test("respects limit parameter", () => {
    const frames = [
      createFrame({ name: "a", fingerprint: 1 }),
      createFrame({ name: "b", fingerprint: 2 }),
      createFrame({ name: "c", fingerprint: 3 }),
    ];
    const infos = [
      createFrameInfo({ sumSelfTime: 300 }),
      createFrameInfo({ sumSelfTime: 200 }),
      createFrameInfo({ sumSelfTime: 100 }),
    ];

    const flamegraph = createFlamegraph(frames, infos);
    const hotPaths = analyzeHotPaths(flamegraph, 2, false);

    expect(hotPaths.length).toBe(2);
    expect(hotPaths[0]?.frames[0]?.name).toBe("a");
    expect(hotPaths[1]?.frames[0]?.name).toBe("b");
  });

  test("filters to user code only when requested", () => {
    const frames = [
      createFrame({ name: "userFunc", is_application: true, fingerprint: 1 }),
      createFrame({ name: "libFunc", is_application: false, fingerprint: 2 }),
    ];
    const infos = [
      createFrameInfo({ sumSelfTime: 100 }),
      createFrameInfo({ sumSelfTime: 500 }),
    ];

    const flamegraph = createFlamegraph(frames, infos);
    const hotPaths = analyzeHotPaths(flamegraph, 10, true);

    expect(hotPaths.length).toBe(1);
    expect(hotPaths[0]?.frames[0]?.name).toBe("userFunc");
  });

  test("includes all frames when userCodeOnly is false", () => {
    const frames = [
      createFrame({ name: "userFunc", is_application: true, fingerprint: 1 }),
      createFrame({ name: "libFunc", is_application: false, fingerprint: 2 }),
    ];
    const infos = [
      createFrameInfo({ sumSelfTime: 100 }),
      createFrameInfo({ sumSelfTime: 500 }),
    ];

    const flamegraph = createFlamegraph(frames, infos);
    const hotPaths = analyzeHotPaths(flamegraph, 10, false);

    expect(hotPaths.length).toBe(2);
  });

  test("calculates correct percentages", () => {
    const frames = [
      createFrame({ name: "a", fingerprint: 1 }),
      createFrame({ name: "b", fingerprint: 2 }),
    ];
    const infos = [
      createFrameInfo({ sumSelfTime: 750 }),
      createFrameInfo({ sumSelfTime: 250 }),
    ];

    const flamegraph = createFlamegraph(frames, infos);
    const hotPaths = analyzeHotPaths(flamegraph, 10, false);

    expect(hotPaths[0]?.percentage).toBeCloseTo(75, 1);
    expect(hotPaths[1]?.percentage).toBeCloseTo(25, 1);
  });

  test("property: percentages sum to <= 100", () => {
    fcAssert(
      property(integer({ min: 1, max: 10 }), (frameCount) => {
        const frames = Array.from({ length: frameCount }, (_, i) =>
          createFrame({ name: `func${i}`, fingerprint: i })
        );
        const infos = Array.from({ length: frameCount }, () =>
          createFrameInfo({ sumSelfTime: Math.floor(Math.random() * 1000) + 1 })
        );

        const flamegraph = createFlamegraph(frames, infos);
        const hotPaths = analyzeHotPaths(flamegraph, frameCount, false);

        const totalPct = hotPaths.reduce((sum, hp) => sum + hp.percentage, 0);
        expect(totalPct).toBeLessThanOrEqual(100.01);
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });
});

// calculatePercentiles

describe("calculatePercentiles", () => {
  test("returns zeros for empty frame_infos", () => {
    const flamegraph = createFlamegraph([], []);
    const result = calculatePercentiles(flamegraph);
    expect(result).toEqual({ p75: 0, p95: 0, p99: 0 });
  });

  test("returns max percentiles across all frames in milliseconds", () => {
    const infos = [
      createFrameInfo({
        p75Duration: 5_000_000,
        p95Duration: 10_000_000,
        p99Duration: 20_000_000,
      }),
      createFrameInfo({
        p75Duration: 8_000_000,
        p95Duration: 12_000_000,
        p99Duration: 15_000_000,
      }),
    ];

    const flamegraph = createFlamegraph(
      [createFrame({ fingerprint: 1 }), createFrame({ fingerprint: 2 })],
      infos
    );
    const result = calculatePercentiles(flamegraph);

    // Max of each: p75=8M ns = 8ms, p95=12M ns = 12ms, p99=20M ns = 20ms
    expect(result.p75).toBe(8);
    expect(result.p95).toBe(12);
    expect(result.p99).toBe(20);
  });

  test("property: p75 <= p95 <= p99 when frame infos have that ordering", () => {
    fcAssert(
      property(
        nat(1_000_000_000),
        nat(1_000_000_000),
        nat(1_000_000_000),
        (a, b, c) => {
          const sorted = [a, b, c].sort((x, y) => x - y) as [
            number,
            number,
            number,
          ];
          const info = createFrameInfo({
            p75Duration: sorted[0],
            p95Duration: sorted[1],
            p99Duration: sorted[2],
          });
          const flamegraph = createFlamegraph([createFrame()], [info]);
          const result = calculatePercentiles(flamegraph);

          expect(result.p75).toBeLessThanOrEqual(result.p95);
          expect(result.p95).toBeLessThanOrEqual(result.p99);
        }
      ),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });
});

// analyzeFlamegraph

describe("analyzeFlamegraph", () => {
  test("returns structured analysis with all fields", () => {
    const flamegraph = createFlamegraph();
    const result = analyzeFlamegraph(flamegraph, {
      transactionName: "/api/users",
      period: "24h",
      limit: 10,
      userCodeOnly: true,
    });

    expect(result.transactionName).toBe("/api/users");
    expect(result.platform).toBe("node");
    expect(result.period).toBe("24h");
    expect(result.userCodeOnly).toBe(true);
    expect(result.percentiles).toBeDefined();
    expect(result.hotPaths).toBeDefined();
    expect(result.totalSamples).toBeGreaterThan(0);
  });

  test("counts total samples across all profiles", () => {
    const flamegraph = createFlamegraph();
    // Default has 2 samples in one profile
    const result = analyzeFlamegraph(flamegraph, {
      transactionName: "test",
      period: "7d",
      limit: 10,
      userCodeOnly: false,
    });

    expect(result.totalSamples).toBe(2);
  });

  test("propagates userCodeOnly to hot paths analysis", () => {
    const frames = [
      createFrame({ name: "userFunc", is_application: true, fingerprint: 1 }),
      createFrame({ name: "libFunc", is_application: false, fingerprint: 2 }),
    ];
    const infos = [
      createFrameInfo({ sumSelfTime: 100 }),
      createFrameInfo({ sumSelfTime: 500 }),
    ];
    const flamegraph = createFlamegraph(frames, infos);

    const userOnly = analyzeFlamegraph(flamegraph, {
      transactionName: "test",
      period: "24h",
      limit: 10,
      userCodeOnly: true,
    });

    const allFrames = analyzeFlamegraph(flamegraph, {
      transactionName: "test",
      period: "24h",
      limit: 10,
      userCodeOnly: false,
    });

    expect(userOnly.hotPaths.length).toBe(1);
    expect(allFrames.hotPaths.length).toBe(2);
  });

  test("handles empty flamegraph gracefully", () => {
    const flamegraph = createFlamegraph([], []);
    const result = analyzeFlamegraph(flamegraph, {
      transactionName: "test",
      period: "24h",
      limit: 10,
      userCodeOnly: false,
    });

    expect(result.hotPaths).toEqual([]);
    expect(result.percentiles).toEqual({ p75: 0, p95: 0, p99: 0 });
    expect(result.totalSamples).toBe(2); // profiles still have samples
  });
});
