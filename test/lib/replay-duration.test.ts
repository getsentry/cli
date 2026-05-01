import { describe, expect, test } from "bun:test";

import {
  formatReplayDurationCompact,
  formatReplayDurationVerbose,
} from "../../src/lib/replay-duration.js";

describe("formatReplayDurationCompact", () => {
  test("formats short durations", () => {
    expect(formatReplayDurationCompact(59)).toBe("59s");
    expect(formatReplayDurationCompact(60)).toBe("1m");
    expect(formatReplayDurationCompact(125)).toBe("2m 5s");
  });

  test("formats long durations", () => {
    expect(formatReplayDurationCompact(3600)).toBe("1h");
    expect(formatReplayDurationCompact(3665)).toBe("1h 1m");
    expect(formatReplayDurationCompact(90_061)).toBe("1d 1h");
  });

  test("handles missing durations", () => {
    expect(formatReplayDurationCompact(null)).toBe("—");
    expect(formatReplayDurationCompact(undefined)).toBe("—");
  });
});

describe("formatReplayDurationVerbose", () => {
  test("formats short durations", () => {
    expect(formatReplayDurationVerbose(1)).toBe("1 second");
    expect(formatReplayDurationVerbose(125)).toBe("2 minutes and 5 seconds");
  });

  test("formats long durations", () => {
    expect(formatReplayDurationVerbose(3600)).toBe("1 hour");
    expect(formatReplayDurationVerbose(3665)).toBe("1 hour and 1 minute");
    expect(formatReplayDurationVerbose(90_061)).toBe("1 day and 1 hour");
  });
});
