/**
 * Sixel Banner Tests
 *
 * Covers the pure, terminal-independent pieces of sixel support: DA1/cell-size
 * reply parsing, fit calculation, the safe non-TTY default, and the shape of the
 * baked banner module. The terminal round-trip in `probe()` is intentionally not
 * exercised (it requires a real tty); everything it feeds is unit-tested here.
 */

import { assert as fcAssert, integer, property, uniqueArray } from "fast-check";
import { describe, expect, test } from "vitest";
import { BANNER_SIXEL } from "../../src/generated/banner-sixel.js";
import { parseSixelCaps, sixelBanner, sixelFits } from "../../src/lib/sixel.js";
import { DEFAULT_NUM_RUNS } from "../model-based/helpers.js";

const ESC = "\x1b";

describe("parseSixelCaps", () => {
  test("detects sixel from DA1 attribute 4", () => {
    const caps = parseSixelCaps(`${ESC}[?62;4;6c`);
    expect(caps.supported).toBe(true);
  });

  test("treats missing attribute 4 as unsupported", () => {
    expect(parseSixelCaps(`${ESC}[?62;1;6c`).supported).toBe(false);
  });

  test("does not match 4 as a substring of another attribute", () => {
    // 14, 40, 64 all contain '4' but are not the sixel attribute.
    expect(parseSixelCaps(`${ESC}[?14;40;64c`).supported).toBe(false);
  });

  test("parses cell size from CSI 16 t report", () => {
    const caps = parseSixelCaps(`${ESC}[?62;4c${ESC}[6;20;10t`);
    expect(caps).toMatchObject({
      supported: true,
      cellHeight: 20,
      cellWidth: 10,
    });
  });

  test("supported but no cell size when 16t is absent", () => {
    const caps = parseSixelCaps(`${ESC}[?62;4c`);
    expect(caps.supported).toBe(true);
    expect(caps.cellWidth).toBeUndefined();
  });

  test("garbage / empty replies are unsupported", () => {
    expect(parseSixelCaps("").supported).toBe(false);
    expect(parseSixelCaps("not a terminal reply").supported).toBe(false);
  });

  test("property: supported iff the attribute list contains exactly '4'", () => {
    fcAssert(
      property(
        uniqueArray(integer({ min: 0, max: 99 }), { maxLength: 8 }),
        (attrs) => {
          const reply = `${ESC}[?${attrs.join(";")}c`;
          expect(parseSixelCaps(reply).supported).toBe(attrs.includes(4));
        }
      ),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });
});

describe("sixelFits", () => {
  const caps = { supported: true, cellWidth: 10, cellHeight: 20 };

  test("fits when banner width <= columns * cellWidth", () => {
    expect(sixelFits(caps, 80, 640)).toBe(true); // 800px available >= 640
    expect(sixelFits(caps, 64, 640)).toBe(true); // exactly 640px
  });

  test("does not fit when the image is wider than the terminal", () => {
    expect(sixelFits(caps, 60, 640)).toBe(false); // 600px < 640
  });

  test("declines without a known cell width", () => {
    expect(sixelFits({ supported: true }, 200, 640)).toBe(false);
    expect(sixelFits({ supported: true, cellWidth: 0 }, 200, 640)).toBe(false);
  });

  test("declines when unsupported", () => {
    expect(sixelFits({ supported: false, cellWidth: 10 }, 200, 640)).toBe(
      false
    );
  });
});

describe("sixelBanner", () => {
  test("returns undefined in a non-interactive (test) environment", () => {
    // Under vitest stdin/stdout are not TTYs, so the probe opts out and no
    // sixel is emitted — the caller falls back to block art.
    expect(sixelBanner(200)).toBeUndefined();
  });
});

describe("BANNER_SIXEL (generated)", () => {
  test("is a well-formed sixel payload with positive dimensions", () => {
    expect(BANNER_SIXEL.width).toBeGreaterThan(0);
    expect(BANNER_SIXEL.height).toBeGreaterThan(0);
    // DCS sixel introducer ... String Terminator.
    expect(BANNER_SIXEL.data.startsWith(`${ESC}P`)).toBe(true);
    expect(BANNER_SIXEL.data.endsWith(`${ESC}\\`)).toBe(true);
    // Transparent background: P2 = 1 in the DCS parameters.
    expect(BANNER_SIXEL.data.startsWith(`${ESC}P0;1;0q`)).toBe(true);
  });
});
