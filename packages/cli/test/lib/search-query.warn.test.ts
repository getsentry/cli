/**
 * Warning copy for stacked search-query rewrites.
 *
 * `sanitizeQuery` must emit one `Running query:` line, quoting the
 * string that is actually sent — not an intermediate rewrite.
 */

import { beforeEach, describe, expect, test, vi } from "vitest";

const { fakeLog } = vi.hoisted(() => {
  const log = {
    warn: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    withTag() {
      return log;
    },
  };
  return { fakeLog: log };
});

vi.mock("../../src/lib/logger.js", () => ({
  logger: fakeLog,
}));

const { sanitizeQuery } = await import("../../src/lib/search-query.js");

function runningQueries(): string[] {
  return fakeLog.warn.mock.calls
    .map((call) => String(call[0]))
    .filter((msg) => msg.includes("Running query:"));
}

describe("sanitizeQuery: rewrite warnings", () => {
  beforeEach(() => {
    fakeLog.warn.mockClear();
  });

  test("numeric project: plus OR warns once with the final in-list", () => {
    expect(sanitizeQuery("project:123 OR project:456")).toBe(
      "project_id:[123,456]"
    );
    const warns = runningQueries();
    expect(warns).toHaveLength(1);
    expect(warns[0]).toContain('Running query: "project_id:[123,456]"');
    expect(warns[0]).not.toContain("project_id:123 OR project_id:456");
    expect(warns[0]).toContain("Rewrote numeric project:");
    expect(warns[0]).toContain("Rewrote OR using in-list syntax");
  });

  test("numeric project: plus AND warns once with the stripped query", () => {
    expect(sanitizeQuery("project:123 AND is:unresolved")).toBe(
      "project_id:123 is:unresolved"
    );
    const warns = runningQueries();
    expect(warns).toHaveLength(1);
    expect(warns[0]).toContain('Running query: "project_id:123 is:unresolved"');
    expect(warns[0]).toContain("removed explicit AND operator");
    expect(warns[0]).not.toContain('Running query: "project:123 AND');
  });

  test("OR-only still warns once with the in-list", () => {
    expect(sanitizeQuery("level:error OR level:warning")).toBe(
      "level:[error,warning]"
    );
    const warns = runningQueries();
    expect(warns).toHaveLength(1);
    expect(warns[0]).toContain('Running query: "level:[error,warning]"');
  });

  test("does not warn Running query: when OR rewrite fails", () => {
    expect(() => sanitizeQuery("level:error OR assigned:me")).toThrow();
    expect(runningQueries()).toHaveLength(0);
  });

  test("does not warn Running query: when numeric rewrite is followed by a failed OR", () => {
    expect(() => sanitizeQuery("project:123 OR assigned:me")).toThrow();
    expect(runningQueries()).toHaveLength(0);
  });
});
