/**
 * Promise Utilities Tests
 */

import { describe, expect, test } from "bun:test";
import { anyTrue } from "../../src/lib/promises.js";

describe("anyTrue", () => {
  test("returns false for empty array", async () => {
    const result = await anyTrue([], async () => true);
    expect(result).toBe(false);
  });

  test("returns true when single item passes", async () => {
    const result = await anyTrue([1], async () => true);
    expect(result).toBe(true);
  });

  test("returns false when single item fails", async () => {
    const result = await anyTrue([1], async () => false);
    expect(result).toBe(false);
  });

  test("returns true when first item passes quickly", async () => {
    const calls: number[] = [];

    const result = await anyTrue([1, 2, 3], async (n) => {
      calls.push(n);
      if (n === 1) {
        return true; // First item passes immediately
      }
      await Bun.sleep(100); // Others are slow
      return false;
    });

    expect(result).toBe(true);
    // First item should have been called
    expect(calls).toContain(1);
  });

  test("returns true when last item passes", async () => {
    const result = await anyTrue([1, 2, 3], async (n) => {
      return n === 3; // Only last item passes
    });

    expect(result).toBe(true);
  });

  test("returns false when all items fail", async () => {
    const result = await anyTrue([1, 2, 3], async () => false);
    expect(result).toBe(false);
  });

  test("treats errors as false", async () => {
    const result = await anyTrue([1, 2, 3], async (n) => {
      if (n === 1) {
        throw new Error("test error");
      }
      return n === 2; // Second item passes
    });

    expect(result).toBe(true);
  });

  test("returns false when all predicates error", async () => {
    const result = await anyTrue([1, 2, 3], async () => {
      throw new Error("test error");
    });

    expect(result).toBe(false);
  });

  test("starts all predicates concurrently", async () => {
    const startTimes: number[] = [];
    const startTime = Date.now();

    await anyTrue([1, 2, 3], async (n) => {
      startTimes.push(Date.now() - startTime);
      await Bun.sleep(50);
      return n === 3;
    });

    // All should start within ~10ms of each other (concurrent)
    // If sequential, they'd be ~50ms apart
    const maxDiff = Math.max(...startTimes) - Math.min(...startTimes);
    expect(maxDiff).toBeLessThan(20);
  });

  test("resolves only once even with multiple true values", async () => {
    let resolveCount = 0;

    const promise = anyTrue([1, 2, 3], async () => {
      await Bun.sleep(10);
      return true; // All pass
    });

    // Wrap to count resolutions
    const result = await promise.then((r) => {
      resolveCount += 1;
      return r;
    });

    expect(result).toBe(true);
    expect(resolveCount).toBe(1);
  });

  test("works with complex async predicates", async () => {
    const files = ["exists.txt", "missing.txt", "also-missing.txt"];

    const result = await anyTrue(files, async (filename) => {
      // Simulate async file check
      await Bun.sleep(5);
      return filename === "exists.txt";
    });

    expect(result).toBe(true);
  });

  test("does not wait for slow false predicates after finding true", async () => {
    const startTime = Date.now();

    const result = await anyTrue([1, 2, 3], async (n) => {
      if (n === 1) {
        return true; // Fast true
      }
      await Bun.sleep(500); // Slow false
      return false;
    });

    const elapsed = Date.now() - startTime;

    expect(result).toBe(true);
    // Should resolve well under 500ms since we found true immediately
    expect(elapsed).toBeLessThan(100);
  });
});
