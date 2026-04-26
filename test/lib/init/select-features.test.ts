import { describe, expect, test } from "bun:test";
import {
  FEATURE_LABELS,
  normaliseFromFlag,
  sortFeatures,
} from "../../../src/lib/init/select-features.js";

describe("normaliseFromFlag", () => {
  test("returns empty array for undefined / empty input", () => {
    expect(normaliseFromFlag(undefined)).toEqual([]);
    expect(normaliseFromFlag([])).toEqual([]);
  });

  test("passes through canonical IDs unchanged", () => {
    expect(normaliseFromFlag(["tracing", "sessionReplay"])).toEqual([
      "tracing",
      "sessionReplay",
    ]);
  });

  test("resolves aliases", () => {
    expect(normaliseFromFlag(["replay"])).toEqual(["sessionReplay"]);
    expect(normaliseFromFlag(["sourcemaps"])).toEqual(["sourceMaps"]);
    expect(normaliseFromFlag(["cron"])).toEqual(["crons"]);
    expect(normaliseFromFlag(["ai"])).toEqual(["aiMonitoring"]);
  });

  test("trims whitespace", () => {
    expect(normaliseFromFlag([" tracing ", "  logs"])).toEqual([
      "tracing",
      "logs",
    ]);
  });

  test("dedupes when canonical and alias are both present", () => {
    expect(normaliseFromFlag(["sessionReplay", "replay"])).toEqual([
      "sessionReplay",
    ]);
  });

  test("silently drops unknown values", () => {
    expect(normaliseFromFlag(["tracing", "made-up-feature", ""])).toEqual([
      "tracing",
    ]);
  });
});

describe("sortFeatures", () => {
  test("sorts into canonical display order", () => {
    expect(
      sortFeatures(["crons", "tracing", "sourceMaps", "logs"])
    ).toEqual(["tracing", "logs", "sourceMaps", "crons"]);
  });

  test("stable for unknown ids (pushed to the end)", () => {
    expect(sortFeatures(["zzz", "tracing"])).toEqual(["tracing", "zzz"]);
  });
});

describe("FEATURE_LABELS", () => {
  test("provides label + hint for every selectable id used by the agent", () => {
    for (const id of [
      "tracing",
      "logs",
      "sessionReplay",
      "profiling",
      "aiMonitoring",
      "userFeedback",
      "sourceMaps",
      "crons",
    ]) {
      expect(FEATURE_LABELS[id]?.label).toBeTruthy();
      expect(FEATURE_LABELS[id]?.hint).toBeTruthy();
    }
  });
});
