/**
 * Unit tests for the byte-driven upgrade progress bar.
 *
 * The bar is cosmetic-only and must never abort the operation it decorates.
 * Coverage: determinate fraction rendering, indeterminate byte counter,
 * plain-output (non-interactive) header-only behavior, byte accumulation,
 * full-bar clamping, and the never-throws contract for both onProgress and
 * done().
 *
 * Rendering is gated on `isPlainOutput()`, so we force rich output via
 * SENTRY_PLAIN_OUTPUT=0 (see plain-detect.ts precedence) and drive a fake
 * TTY stream.
 */

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { makeByteProgress } from "../../src/lib/progress.js";

type FakeOut = {
  isTTY: boolean;
  writes: string[];
  write: (s: string) => boolean;
};

function fakeOut(isTTY: boolean): FakeOut {
  const writes: string[] = [];
  return {
    isTTY,
    writes,
    write(s: string) {
      writes.push(s);
      return true;
    },
  };
}

describe("makeByteProgress", () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    // Force rich output so the interactive path renders regardless of CI env
    // (NO_COLOR=1 etc.). SENTRY_PLAIN_OUTPUT has highest precedence.
    for (const key of ["SENTRY_PLAIN_OUTPUT", "NO_COLOR", "FORCE_COLOR"]) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
    process.env.SENTRY_PLAIN_OUTPUT = "0"; // force rich
  });

  afterEach(() => {
    for (const key of ["SENTRY_PLAIN_OUTPUT", "NO_COLOR", "FORCE_COLOR"]) {
      const v = saved[key];
      if (v === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = v;
      }
    }
  });

  test("renders a determinate bar advancing with reported bytes", () => {
    const out = fakeOut(true);
    const p = makeByteProgress("Applying 3 patch(es)", 1000, out);
    p.onProgress(500);
    p.onProgress(500);
    p.done();

    const last = out.writes.at(-2); // last real line before the clear
    expect(last).toContain("Applying 3 patch(es)");
    expect(last).toContain("█".repeat(16)); // 1000/1000 → full bar
  });

  test("renders an indeterminate byte counter when total is null", () => {
    const out = fakeOut(true);
    const p = makeByteProgress("Downloading", null, out);
    p.onProgress(2048);
    p.done();

    const last = out.writes.at(-2);
    expect(last).toContain("Downloading");
    expect(last).not.toContain("░"); // no bar in indeterminate mode
  });

  test("accumulates bytes across multiple onProgress calls", () => {
    const out = fakeOut(true);
    const p = makeByteProgress("Applying", 100, out);
    p.onProgress(10);
    p.onProgress(40);
    p.onProgress(50); // total 100 → full
    p.done();
    expect(out.writes.at(-2)).toContain("█".repeat(16));
  });

  test("clamps the bar at full even if bytes exceed the total", () => {
    const out = fakeOut(true);
    const p = makeByteProgress("Applying", 100, out);
    p.onProgress(5000);
    p.done();
    const last = out.writes.at(-2);
    expect(last).toContain("█".repeat(16));
    expect(last).not.toContain("░");
  });

  test("prints the header once (no bar) in plain output", () => {
    process.env.SENTRY_PLAIN_OUTPUT = "1"; // force plain
    const out = fakeOut(true);
    const p = makeByteProgress("Applying 3 patch(es)", 1000, out);
    p.onProgress(500);
    p.onProgress(500);
    p.done();
    expect(out.writes).toEqual(["Applying 3 patch(es)\n"]);
  });

  test("prints the header once (no bar) off a TTY", () => {
    const out = fakeOut(false);
    const p = makeByteProgress("Applying", 1000, out);
    p.onProgress(1000);
    p.done();
    expect(out.writes).toEqual(["Applying\n"]);
  });

  test("never throws even if the output stream throws (onProgress and done)", () => {
    const throwing = {
      isTTY: true,
      write(): boolean {
        throw new Error("boom");
      },
    };
    const p = makeByteProgress("Applying", 100, throwing);
    expect(() => {
      p.onProgress(50);
      p.done();
    }).not.toThrow();
  });
});
