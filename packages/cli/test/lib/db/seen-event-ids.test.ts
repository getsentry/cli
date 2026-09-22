/**
 * Seen event ID cache.
 *
 * Covers prefix resolution of event IDs the CLI has already printed.
 * Sentry search cannot match a partial event ID, so `event view` of a
 * copied prefix depends on this table.
 */

import { describe, expect, test } from "vitest";
import {
  clearAllSeenEventIds,
  findCachedEventIds,
  rememberSeenEventIds,
} from "../../../src/lib/db/seen-event-ids.js";
import { useTestConfigDir } from "../../helpers.js";

useTestConfigDir("test-seen-event-ids-");

const EVENT_A = "aaaa1111bbbb2222cccc3333dddd4444";
const EVENT_B = "aaaa1111bbbb2222cccc3333dddd5555";
const EVENT_C = "bbbb1111bbbb2222cccc3333dddd4444";

describe("findCachedEventIds", () => {
  test("returns an empty list when nothing was remembered", () => {
    expect(findCachedEventIds("aaaa1111bbbb")).toEqual([]);
  });

  test("resolves a 12-character prefix to the full ID", () => {
    rememberSeenEventIds("acme", "frontend", [EVENT_A]);
    expect(findCachedEventIds("aaaa1111bbbb")).toEqual([EVENT_A]);
  });

  test("scopes a hit to the project when one is given", () => {
    rememberSeenEventIds("acme", "frontend", [EVENT_A]);
    expect(
      findCachedEventIds("aaaa1111bbbb", { org: "acme", project: "backend" })
    ).toEqual([]);
    expect(
      findCachedEventIds("aaaa1111bbbb", { org: "acme", project: "frontend" })
    ).toEqual([EVENT_A]);
  });

  test("returns every ID that shares the prefix", () => {
    rememberSeenEventIds("acme", "frontend", [EVENT_A, EVENT_B, EVENT_C]);
    expect(findCachedEventIds("aaaa1111bbbb").sort()).toEqual(
      [EVENT_A, EVENT_B].sort()
    );
  });

  test("ignores prefixes that are not hex", () => {
    rememberSeenEventIds("acme", "frontend", [EVENT_A]);
    expect(findCachedEventIds("aaaa1111bbb%")).toEqual([]);
  });
});

describe("clearAllSeenEventIds", () => {
  test("drops every remembered ID", () => {
    rememberSeenEventIds("acme", "frontend", [EVENT_A]);
    clearAllSeenEventIds();
    expect(findCachedEventIds("aaaa1111bbbb")).toEqual([]);
  });
});
