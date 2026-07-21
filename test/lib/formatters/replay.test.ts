/**
 * Tests for shape-specific Session Replay activity extraction.
 */

import { describe, expect, test } from "vitest";
import { extractReplayActivityEvents } from "../../../src/lib/formatters/replay.js";

describe("extractReplayActivityEvents", () => {
  test("extracts page, click, performance, and breadcrumb shapes", () => {
    const events = extractReplayActivityEvents(
      [
        [
          { timestamp: 1, data: { href: "/checkout" } },
          {
            timestamp: 2,
            data: {
              tag: "click",
              payload: { selector: "#pay", label: "Pay now" },
            },
          },
          {
            timestamp: 3,
            data: {
              tag: "performanceSpan",
              payload: {
                op: "resource.fetch",
                description: "GET /api/cart",
                data: { duration: 42 },
              },
            },
          },
          {
            timestamp: 4,
            data: {
              tag: "breadcrumb",
              payload: { category: "ui.click", message: "Submitted cart" },
            },
          },
        ],
      ],
      10
    );

    expect(events).toEqual([
      {
        timestampMs: 1,
        label: "page.view",
        details: ["href=/checkout"],
      },
      {
        timestampMs: 2,
        label: "click",
        details: ["selector=#pay", "label=Pay now"],
      },
      {
        timestampMs: 3,
        label: "resource.fetch",
        details: ["description=GET /api/cart", "duration_ms=42"],
      },
      {
        timestampMs: 4,
        label: "ui.click",
        details: ["message=Submitted cart"],
      },
    ]);
  });

  test("ignores malformed shapes and keeps empty click payload behavior", () => {
    const events = extractReplayActivityEvents(
      [
        [
          null,
          [],
          { timestamp: 1 },
          { timestamp: 2, data: null },
          { timestamp: 3, data: { href: "" } },
          { timestamp: 4, data: { tag: "click", payload: {} } },
          {
            timestamp: 5,
            data: {
              tag: "performanceSpan",
              payload: { op: "db", data: { duration: "slow" } },
            },
          },
        ],
      ],
      10
    );

    expect(events).toEqual([
      { timestampMs: 4, label: "click", details: [] },
      { timestampMs: 5, label: "db", details: [] },
    ]);
  });
});
