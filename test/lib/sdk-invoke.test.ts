/**
 * Unit tests for the SDK invoke layer.
 *
 * Focuses on `applyFlagDefaults` which replicates Stricli's default
 * application for the SDK direct-invoke path (bypasses Stricli parsing).
 */

import { describe, expect, test } from "vitest";
import { applyFlagDefaults, type FlagDef } from "../../src/lib/sdk-invoke.js";

// ---------------------------------------------------------------------------
// applyFlagDefaults — parsed flags with defaults
// ---------------------------------------------------------------------------

describe("applyFlagDefaults: parsed flags with defaults", () => {
  test("calls parse on string default when flag is missing", () => {
    const flagDefs: Record<string, FlagDef> = {
      period: {
        kind: "parsed",
        default: "7d",
        parse: (v: string) => ({ type: "relative", period: v }),
      },
    };
    const result = applyFlagDefaults({}, flagDefs);
    expect(result.period).toEqual({ type: "relative", period: "7d" });
  });

  test("calls parse on string default when flag value is undefined", () => {
    const flagDefs: Record<string, FlagDef> = {
      period: {
        kind: "parsed",
        default: "90d",
        parse: (v: string) => ({ type: "relative", period: v }),
      },
    };
    const result = applyFlagDefaults({ period: undefined }, flagDefs);
    expect(result.period).toEqual({ type: "relative", period: "90d" });
  });

  test("preserves caller-provided value over default", () => {
    const flagDefs: Record<string, FlagDef> = {
      period: {
        kind: "parsed",
        default: "7d",
        parse: (v: string) => ({ type: "relative", period: v }),
      },
    };
    const callerValue = { type: "relative", period: "24h" };
    const result = applyFlagDefaults({ period: callerValue }, flagDefs);
    expect(result.period).toBe(callerValue);
  });

  test("handles parse function that returns a number", () => {
    const flagDefs: Record<string, FlagDef> = {
      limit: {
        kind: "parsed",
        default: "25",
        parse: (v: string) => Number(v),
      },
    };
    const result = applyFlagDefaults({}, flagDefs);
    expect(result.limit).toBe(25);
  });

  test("re-throws if parse function rejects its own default", () => {
    const flagDefs: Record<string, FlagDef> = {
      period: {
        kind: "parsed",
        default: "invalid",
        parse: () => {
          throw new Error("parse error");
        },
      },
    };
    expect(() => applyFlagDefaults({}, flagDefs)).toThrow("parse error");
  });
});

// ---------------------------------------------------------------------------
// applyFlagDefaults — boolean flags
// ---------------------------------------------------------------------------

describe("applyFlagDefaults: boolean flags", () => {
  test("applies raw boolean default", () => {
    const flagDefs: Record<string, FlagDef> = {
      json: { kind: "boolean", default: false },
      fresh: { kind: "boolean", default: false },
    };
    const result = applyFlagDefaults({}, flagDefs);
    expect(result.json).toBe(false);
    expect(result.fresh).toBe(false);
  });

  test("preserves caller-provided boolean over default", () => {
    const flagDefs: Record<string, FlagDef> = {
      fresh: { kind: "boolean", default: false },
    };
    const result = applyFlagDefaults({ fresh: true }, flagDefs);
    expect(result.fresh).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// applyFlagDefaults — enum flags
// ---------------------------------------------------------------------------

describe("applyFlagDefaults: enum flags", () => {
  test("applies raw enum default", () => {
    const flagDefs: Record<string, FlagDef> = {
      sort: { kind: "enum", default: "date" },
    };
    const result = applyFlagDefaults({}, flagDefs);
    expect(result.sort).toBe("date");
  });
});

// ---------------------------------------------------------------------------
// applyFlagDefaults — optional flags without defaults
// ---------------------------------------------------------------------------

describe("applyFlagDefaults: optional flags without defaults", () => {
  test("does not inject value for optional flag with no default", () => {
    const flagDefs: Record<string, FlagDef> = {
      query: { kind: "parsed", optional: true },
    };
    const result = applyFlagDefaults({}, flagDefs);
    expect("query" in result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// applyFlagDefaults — strips undefined, preserves other falsy values
// ---------------------------------------------------------------------------

describe("applyFlagDefaults: undefined stripping", () => {
  test("strips undefined values from input flags", () => {
    const flagDefs: Record<string, FlagDef> = {};
    const result = applyFlagDefaults(
      { a: undefined, b: null, c: 0, d: "", e: false },
      flagDefs
    );
    expect("a" in result).toBe(false);
    expect(result.b).toBeNull();
    expect(result.c).toBe(0);
    expect(result.d).toBe("");
    expect(result.e).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// applyFlagDefaults — multiple flags combined
// ---------------------------------------------------------------------------

describe("applyFlagDefaults: combined scenario", () => {
  test("applies defaults for missing flags while preserving provided ones", () => {
    const flagDefs: Record<string, FlagDef> = {
      period: {
        kind: "parsed",
        default: "7d",
        parse: (v: string) => ({ type: "relative", period: v }),
      },
      limit: {
        kind: "parsed",
        default: "25",
        parse: (v: string) => Number(v),
      },
      sort: { kind: "enum", default: "date" },
      fresh: { kind: "boolean", default: false },
      query: { kind: "parsed", optional: true },
    };
    const result = applyFlagDefaults({ limit: 50, query: undefined }, flagDefs);
    // period: default applied via parse
    expect(result.period).toEqual({ type: "relative", period: "7d" });
    // limit: caller value preserved
    expect(result.limit).toBe(50);
    // sort: default applied (raw)
    expect(result.sort).toBe("date");
    // fresh: default applied (raw)
    expect(result.fresh).toBe(false);
    // query: undefined stripped, no default → absent
    expect("query" in result).toBe(false);
  });
});
