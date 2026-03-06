import { describe, expect, test } from "bun:test";
import {
  COMMON_PLATFORMS,
  isValidPlatform,
  normalizePlatform,
  suggestPlatform,
  VALID_PLATFORM_SET,
  VALID_PLATFORMS,
} from "../../src/lib/platforms.js";

describe("isValidPlatform", () => {
  test("returns true for known platforms", () => {
    expect(isValidPlatform("node")).toBe(true);
    expect(isValidPlatform("node-hono")).toBe(true);
    expect(isValidPlatform("javascript-nextjs")).toBe(true);
    expect(isValidPlatform("other")).toBe(true);
    expect(isValidPlatform("python-django")).toBe(true);
  });

  test("returns false for invalid platforms", () => {
    expect(isValidPlatform("javascript-node")).toBe(false);
    expect(isValidPlatform("foo")).toBe(false);
    expect(isValidPlatform("sentry.javascript.node")).toBe(false);
    expect(isValidPlatform("")).toBe(false);
  });
});

describe("normalizePlatform", () => {
  test("converts dots to hyphens", () => {
    expect(normalizePlatform("javascript.nextjs")).toBe("javascript-nextjs");
    expect(normalizePlatform("python.django.rest")).toBe("python-django-rest");
  });

  test("returns unchanged string when no dots", () => {
    expect(normalizePlatform("node")).toBe("node");
    expect(normalizePlatform("javascript-nextjs")).toBe("javascript-nextjs");
  });
});

describe("suggestPlatform", () => {
  test("suggests suffix match: nextjs → javascript-nextjs", () => {
    const results = suggestPlatform("nextjs");
    expect(results).toContain("javascript-nextjs");
  });

  test("suggests suffix match: hono → node-hono", () => {
    const results = suggestPlatform("hono");
    expect(results).toContain("node-hono");
  });

  test("suggests prefix swap: javascript-node → node", () => {
    const results = suggestPlatform("javascript-node");
    expect(results).toContain("node");
  });

  test("suggests prefix swap: javascript-hono → node-hono", () => {
    const results = suggestPlatform("javascript-hono");
    expect(results).toContain("node-hono");
  });

  test("suggests fuzzy match for typo: noude → node family", () => {
    const results = suggestPlatform("noude");
    expect(results).toContain("node");
    expect(results.length).toBeGreaterThan(1);
    expect(results.some((r) => r.startsWith("node-"))).toBe(true);
  });

  test("suggests fuzzy match for typo: pythn → python family", () => {
    const results = suggestPlatform("pythn");
    expect(results).toContain("python");
    expect(results.length).toBeGreaterThan(1);
    expect(results.some((r) => r.startsWith("python-"))).toBe(true);
  });

  test("suggests fuzzy match for extra char: node-expresss → node-express", () => {
    const results = suggestPlatform("node-expresss");
    expect(results).toContain("node-express");
  });

  test("suggests fuzzy match for compound typo: javascript-reeact → javascript-react", () => {
    const results = suggestPlatform("javascript-reeact");
    expect(results).toContain("javascript-react");
  });

  test("returns empty array for garbage input", () => {
    expect(suggestPlatform("xyzgarbage")).toEqual([]);
  });

  test("returns at most 15 suggestions", () => {
    const results = suggestPlatform("javascript");
    expect(results.length).toBeLessThanOrEqual(15);
  });
});

describe("COMMON_PLATFORMS is a subset of VALID_PLATFORMS", () => {
  test("every common platform is valid", () => {
    for (const p of COMMON_PLATFORMS) {
      expect(VALID_PLATFORM_SET.has(p)).toBe(true);
    }
  });
});

describe("VALID_PLATFORMS", () => {
  test("contains 109 entries", () => {
    expect(VALID_PLATFORMS.length).toBe(109);
  });
});
