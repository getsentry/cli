import { describe, expect, test } from "bun:test";
import {
  getReplayRequestFields,
  isSupportedReplayField,
  replayUrlPathMatches,
} from "../../src/lib/replay-search.js";

describe("getReplayRequestFields", () => {
  test("normalizes replay field aliases for API requests", () => {
    expect(getReplayRequestFields(["url", "trace_id"])).toEqual([
      "id",
      "urls",
      "trace_ids",
    ]);
  });

  test("requests backing array fields for convenience replay columns", () => {
    expect(
      getReplayRequestFields([
        "error_id",
        "info_id",
        "release",
        "screen",
        "warning_id",
      ])
    ).toEqual([
      "id",
      "error_ids",
      "info_ids",
      "releases",
      "urls",
      "warning_ids",
    ]);
  });
});

describe("isSupportedReplayField", () => {
  test("does not expose replay detail-only fields in replay explore", () => {
    expect(isSupportedReplayField("replay_type")).toBe(false);
  });
});

describe("replayUrlPathMatches", () => {
  test("matches root filter against child paths", () => {
    expect(replayUrlPathMatches("https://example.com/signup", "/")).toBe(true);
    expect(replayUrlPathMatches("https://example.com/", "/")).toBe(true);
  });

  test("matches child paths without matching siblings", () => {
    expect(
      replayUrlPathMatches("https://example.com/signup/team", "/signup")
    ).toBe(true);
    expect(
      replayUrlPathMatches("https://example.com/signup-flow", "/signup")
    ).toBe(false);
  });
});
