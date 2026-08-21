import { describe, expect, test } from "vitest";
import { formatTimestamp } from "../../../src/lib/formatters/sixel-dashboard.js";

describe("formatTimestamp", () => {
  const timestamp = Date.UTC(2024, 0, 15, 10, 30) / 1000;

  test("uses clock time for periods shorter than two days", () => {
    expect(formatTimestamp(timestamp, 1)).toBe("10:30");
  });

  test("uses calendar dates for multi-day periods", () => {
    expect(formatTimestamp(timestamp, 7)).toBe("01/15");
    expect(formatTimestamp(timestamp, 31)).toBe("Jan 15");
  });
});
