import { describe, expect, test } from "bun:test";
import {
  getReplayRequestFields,
  isSupportedReplayField,
} from "../../src/lib/replay-search.js";

describe("getReplayRequestFields", () => {
  test("normalizes replay field aliases for API requests", () => {
    expect(getReplayRequestFields(["url", "trace_id"])).toEqual([
      "id",
      "urls",
      "trace_ids",
    ]);
  });
});

describe("isSupportedReplayField", () => {
  test("does not expose replay detail-only fields in replay explore", () => {
    expect(isSupportedReplayField("replay_type")).toBe(false);
  });
});
