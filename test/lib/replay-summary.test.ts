import { describe, expect, test } from "bun:test";
import { extractNormalizedReplayEvents } from "../../src/lib/replay-events.js";
import { summarizeReplay } from "../../src/lib/replay-summary.js";
import type {
  ReplayDetails,
  ReplayRecordingSegments,
} from "../../src/types/index.js";

const REPLAY_ID = "346789a703f6454384f1de473b8b9fcc";

function replay(): ReplayDetails {
  return {
    id: REPLAY_ID,
    count_errors: 0,
    count_segments: 1,
    duration: 20,
    error_ids: [],
    info_ids: [],
    project_id: "42",
    started_at: "2025-01-01T00:00:00.000Z",
    tags: {},
    trace_ids: [],
    urls: ["https://example.com/signup", "https://example.com/signup/step-2"],
    user: null,
    warning_ids: [],
  };
}

describe("summarizeReplay", () => {
  test("summarizes routes, timings, and friction signals", () => {
    const segments: ReplayRecordingSegments = [
      [
        {
          type: 4,
          timestamp: Date.parse("2025-01-01T00:00:01.000Z"),
          data: { href: "https://example.com/signup" },
        },
        {
          type: 5,
          timestamp: Date.parse("2025-01-01T00:00:02.000Z"),
          data: {
            tag: "performanceSpan",
            payload: {
              op: "navigation.navigate",
              description: "https://example.com/signup",
              data: { duration: 3500 },
            },
          },
        },
        {
          type: 5,
          timestamp: Date.parse("2025-01-01T00:00:03.000Z"),
          data: {
            tag: "breadcrumb",
            payload: {
              category: "fetch",
              message: "POST /api/signup",
              data: { status_code: 500, url: "/api/signup" },
            },
          },
        },
        {
          type: 3,
          timestamp: Date.parse("2025-01-01T00:00:04.000Z"),
          data: { source: 2, type: 2, x: 100, y: 100 },
        },
        {
          type: 3,
          timestamp: Date.parse("2025-01-01T00:00:05.000Z"),
          data: { source: 2, type: 2, x: 105, y: 103 },
        },
      ],
    ];

    const events = extractNormalizedReplayEvents(replay(), segments);
    const summary = summarizeReplay(replay(), events, {
      org: "test-org",
      project: "web",
    });

    expect(summary.routes.map((route) => route.path)).toEqual(["/signup"]);
    expect(summary.routes[0]?.counts.network).toBe(1);
    expect(summary.counts.clicks).toBe(2);
    expect(summary.timings.navigationDurationMs).toBe(3500);
    expect(summary.signals.map((signal) => signal.kind)).toEqual(
      expect.arrayContaining([
        "slow_navigation",
        "network_error",
        "repeated_click",
      ])
    );
  });

  test("summarizes repeated route visits as route windows", () => {
    const segments: ReplayRecordingSegments = [
      [
        {
          type: 4,
          timestamp: Date.parse("2025-01-01T00:00:01.000Z"),
          data: { href: "https://example.com/signup" },
        },
        {
          type: 3,
          timestamp: Date.parse("2025-01-01T00:00:02.000Z"),
          data: { source: 2, type: 2, x: 100, y: 100 },
        },
        {
          type: 4,
          timestamp: Date.parse("2025-01-01T00:00:03.000Z"),
          data: { href: "https://example.com/dashboard" },
        },
        {
          type: 3,
          timestamp: Date.parse("2025-01-01T00:00:04.000Z"),
          data: { source: 5, id: 12, text: "hello" },
        },
        {
          type: 4,
          timestamp: Date.parse("2025-01-01T00:00:05.000Z"),
          data: { href: "https://example.com/signup" },
        },
        {
          type: 3,
          timestamp: Date.parse("2025-01-01T00:00:06.000Z"),
          data: { source: 3, id: 12, x: 0, y: 500 },
        },
      ],
    ];

    const events = extractNormalizedReplayEvents(replay(), segments);
    const summary = summarizeReplay(replay(), events, {
      org: "test-org",
      project: "web",
    });

    expect(summary.routes.map((route) => route.path)).toEqual([
      "/signup",
      "/dashboard",
      "/signup",
    ]);
    expect(summary.routes[0]).toMatchObject({
      enteredAtOffsetMs: 1000,
      leftAtOffsetMs: 3000,
      durationMs: 2000,
      nextPath: "/dashboard",
      eventCount: 2,
      hadUserInteraction: true,
    });
    expect(summary.routes[0]?.counts.clicks).toBe(1);
    expect(summary.routes[1]?.counts.inputs).toBe(1);
    expect(summary.routes[2]?.counts.scrolls).toBe(1);
    expect(summary.routes[2]?.leftAtOffsetMs).toBe(20_000);
    expect(summary.counts.inputs).toBe(1);
    expect(summary.counts.focuses).toBe(0);
    expect(summary.counts.scrolls).toBe(1);

    const focusedSummary = summarizeReplay(replay(), events, {
      org: "test-org",
      project: "web",
      focusPath: "/signup",
    });
    expect(focusedSummary.routes.map((route) => route.path)).toEqual([
      "/signup",
      "/signup",
    ]);
    expect(focusedSummary.counts.inputs).toBe(0);
    expect(focusedSummary.counts.scrolls).toBe(1);
  });
});
