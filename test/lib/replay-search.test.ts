import { describe, expect, test } from "vitest";
import {
  getReplayRequestFields,
  isSupportedReplayField,
  normalizeVariadicFlag,
  parseReplayEnvironmentFilter,
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

describe("normalizeVariadicFlag", () => {
  test("wraps a single string value into an array", () => {
    // A single `-e` flag arrives from the parser as a bare string, not a
    // one-element array (CLI-28C).
    expect(normalizeVariadicFlag("production")).toEqual(["production"]);
  });

  test("passes an array through and returns [] for undefined", () => {
    expect(normalizeVariadicFlag(["a", "b"])).toEqual(["a", "b"]);
    expect(normalizeVariadicFlag(undefined)).toEqual([]);
  });
});

describe("parseReplayEnvironmentFilter", () => {
  test("treats a single -e value as one environment, not per-character", () => {
    // Regression: a bare string must not be spread into characters.
    expect(
      parseReplayEnvironmentFilter("production" as unknown as string[])
    ).toEqual(["production"]);
  });

  test("splits comma-separated and repeated values", () => {
    expect(parseReplayEnvironmentFilter(["prod,staging", "dev"])).toEqual([
      "prod",
      "staging",
      "dev",
    ]);
  });

  test("returns undefined when empty", () => {
    expect(parseReplayEnvironmentFilter(undefined)).toBeUndefined();
    expect(parseReplayEnvironmentFilter([])).toBeUndefined();
  });
});
