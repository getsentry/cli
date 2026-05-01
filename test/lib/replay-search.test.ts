import { describe, expect, test } from "bun:test";
import { getReplayRequestFields } from "../../src/lib/replay-search.js";

describe("getReplayRequestFields", () => {
  test("normalizes replay field aliases for API requests", () => {
    expect(getReplayRequestFields(["url", "trace_id"])).toEqual([
      "id",
      "urls",
      "trace_ids",
    ]);
  });
});
