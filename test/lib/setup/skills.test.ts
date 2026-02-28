/**
 * Unit tests for fetchSentrySkills() in src/lib/setup/skills.ts.
 *
 * Tests focus on error and failure paths since the success path requires
 * network access or a real tarball fixture.
 */

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

// We mock `fetch` globally before importing the module under test.
// Bun resolves `fetch` from the global scope at call time, so replacing
// globalThis.fetch is sufficient.

const originalFetch = globalThis.fetch;

/** Capture stderr output during a test. */
function captureStderr() {
  const output: string[] = [];
  const mockStderr = {
    write: (s: string) => {
      output.push(s);
    },
  };
  return { mockStderr, output };
}

describe("fetchSentrySkills", () => {
  // Dynamically import so we can mock fetch before the module runs
  let fetchSentrySkills: (stderr: {
    write(s: string): void;
  }) => Promise<string[]>;

  beforeEach(async () => {
    const mod = await import("../../../src/lib/setup/skills.js");
    fetchSentrySkills = mod.fetchSentrySkills;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("returns empty array and warns on network failure", async () => {
    globalThis.fetch = mock(() => Promise.reject(new Error("network error")));

    const { mockStderr, output } = captureStderr();
    const result = await fetchSentrySkills(mockStderr);

    expect(result).toEqual([]);
    expect(output.some((line) => line.includes("[setup] Warning"))).toBe(true);
    expect(output.some((line) => line.includes("network error"))).toBe(true);
  });

  test("returns empty array and warns on non-200 response", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response("Forbidden", { status: 403 }))
    );

    const { mockStderr, output } = captureStderr();
    const result = await fetchSentrySkills(mockStderr);

    expect(result).toEqual([]);
    expect(output.some((line) => line.includes("[setup] Warning"))).toBe(true);
    expect(output.some((line) => line.includes("403"))).toBe(true);
  });

  test("returns empty array and warns on AbortError (timeout)", async () => {
    globalThis.fetch = mock(() => {
      const err = new DOMException("The operation was aborted.", "AbortError");
      return Promise.reject(err);
    });

    const { mockStderr, output } = captureStderr();
    const result = await fetchSentrySkills(mockStderr);

    expect(result).toEqual([]);
    expect(output.some((line) => line.includes("[setup] Warning"))).toBe(true);
  });
});
