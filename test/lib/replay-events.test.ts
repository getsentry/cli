import { describe, expect, test } from "bun:test";
import {
  extractNormalizedReplayEvents,
  filterNormalizedReplayEvents,
  parseReplayOffset,
} from "../../src/lib/replay-events.js";
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
    duration: 60,
    error_ids: [],
    info_ids: [],
    project_id: "42",
    started_at: "2025-01-01T00:00:00.000Z",
    tags: {},
    trace_ids: [],
    urls: ["/signup"],
    user: null,
    warning_ids: [],
  };
}

describe("extractNormalizedReplayEvents", () => {
  test("normalizes navigation, clicks, breadcrumbs, and input events", () => {
    const segments: ReplayRecordingSegments = [
      [
        {
          type: 4,
          timestamp: Date.parse("2025-01-01T00:00:01.000Z"),
          data: { href: "/signup" },
        },
        {
          type: 5,
          timestamp: Date.parse("2025-01-01T00:00:02.000Z"),
          data: {
            tag: "rageClick",
            payload: { selector: "button[type=submit]", label: "Sign up" },
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
          data: { source: 5, id: 12, text: "********" },
        },
      ],
    ];

    const events = extractNormalizedReplayEvents(replay(), segments);

    expect(events.map((event) => event.kind)).toEqual([
      "navigation",
      "click",
      "network",
      "input",
    ]);
    expect(events[0]?.offsetMs).toBe(1000);
    expect(events[0]?.urlPath).toBe("/signup");
    expect(events[1]?.selector).toBe("button[type=submit]");
    expect(events[1]?.data?.isRageClick).toBe(true);
    expect(events[2]?.url).toBe("/api/signup");
    expect(events[3]?.data?.masked).toBe(true);
    expect(events[3]?.data?.textLength).toBe(8);
  });

  test("filters by kind, url, and offset window", () => {
    const segments: ReplayRecordingSegments = [
      [
        {
          type: 4,
          timestamp: Date.parse("2025-01-01T00:00:01.000Z"),
          data: { href: "/signup" },
        },
        {
          type: 5,
          timestamp: Date.parse("2025-01-01T00:00:20.000Z"),
          data: {
            tag: "breadcrumb",
            payload: { category: "console", level: "error", message: "boom" },
          },
        },
      ],
    ];

    const events = extractNormalizedReplayEvents(replay(), segments);
    const filtered = filterNormalizedReplayEvents(events, {
      kinds: ["error"],
      url: "/signup",
      fromMs: 10_000,
      toMs: 30_000,
    });

    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.message).toBe("boom");
  });

  test("filters by parsed path without matching query text", () => {
    const segments: ReplayRecordingSegments = [
      [
        {
          type: 4,
          timestamp: Date.parse("2025-01-01T00:00:01.000Z"),
          data: { href: "https://example.com/replays/?query=/signup" },
        },
        {
          type: 4,
          timestamp: Date.parse("2025-01-01T00:00:02.000Z"),
          data: { href: "https://example.com/signup/direct" },
        },
      ],
    ];

    const events = extractNormalizedReplayEvents(replay(), segments);
    const filtered = filterNormalizedReplayEvents(events, { path: "/signup" });

    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.urlPath).toBe("/signup/direct");
  });
});

describe("parseReplayOffset", () => {
  test("parses common replay offset formats", () => {
    expect(parseReplayOffset("90")).toBe(90_000);
    expect(parseReplayOffset("90s")).toBe(90_000);
    expect(parseReplayOffset("01:30")).toBe(90_000);
    expect(parseReplayOffset("1:01:30")).toBe(3_690_000);
    expect(parseReplayOffset("83000ms")).toBe(83_000);
  });
});
