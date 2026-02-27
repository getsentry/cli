/**
 * Trace List Command Tests
 *
 * Tests for internal helper functions and the command func() body
 * in src/commands/trace/list.ts.
 *
 * Uses mock.module to mock api-client and resolve-target to test
 * the func() body without real HTTP calls or database access.
 */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from "bun:test";
import { listCommand, parseSort } from "../../../src/commands/trace/list.js";
import type { ProjectWithOrg } from "../../../src/lib/api-client.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as apiClient from "../../../src/lib/api-client.js";
import { validateLimit } from "../../../src/lib/arg-parsing.js";
import { ContextError, ResolutionError } from "../../../src/lib/errors.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as resolveTarget from "../../../src/lib/resolve-target.js";
import type { TransactionListItem } from "../../../src/types/sentry.js";

// ============================================================================
// validateLimit (shared utility from arg-parsing.ts)
// ============================================================================

describe("validateLimit", () => {
  test("returns number for valid value", () => {
    expect(validateLimit("1", 1, 1000)).toBe(1);
    expect(validateLimit("500", 1, 1000)).toBe(500);
    expect(validateLimit("1000", 1, 1000)).toBe(1000);
  });

  test("returns number for boundary values", () => {
    expect(validateLimit("1", 1, 1000)).toBe(1);
    expect(validateLimit("1000", 1, 1000)).toBe(1000);
  });

  test("throws for value below minimum", () => {
    expect(() => validateLimit("0", 1, 1000)).toThrow("must be between");
    expect(() => validateLimit("-1", 1, 1000)).toThrow("must be between");
  });

  test("throws for value above maximum", () => {
    expect(() => validateLimit("1001", 1, 1000)).toThrow("must be between");
    expect(() => validateLimit("9999", 1, 1000)).toThrow("must be between");
  });

  test("throws for non-numeric value", () => {
    expect(() => validateLimit("abc", 1, 1000)).toThrow("must be between");
    expect(() => validateLimit("", 1, 1000)).toThrow("must be between");
  });
});

// ============================================================================
// parseSort
// ============================================================================

describe("parseSort", () => {
  test("accepts 'date'", () => {
    expect(parseSort("date")).toBe("date");
  });

  test("accepts 'duration'", () => {
    expect(parseSort("duration")).toBe("duration");
  });

  test("throws for invalid sort value", () => {
    expect(() => parseSort("invalid")).toThrow("Invalid sort value");
    expect(() => parseSort("")).toThrow("Invalid sort value");
    expect(() => parseSort("name")).toThrow("Invalid sort value");
  });
});

// ============================================================================
// resolveOrgProjectFromArg (via shared resolve-target.ts)
// ============================================================================

describe("resolveOrgProjectFromArg", () => {
  let findProjectsBySlugSpy: ReturnType<typeof spyOn>;
  let resolveOrgAndProjectSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    findProjectsBySlugSpy = spyOn(apiClient, "findProjectsBySlug");
    resolveOrgAndProjectSpy = spyOn(resolveTarget, "resolveOrgAndProject");
  });

  afterEach(() => {
    findProjectsBySlugSpy.mockRestore();
    resolveOrgAndProjectSpy.mockRestore();
  });

  test("returns explicit org/project directly", async () => {
    const result = await resolveTarget.resolveOrgProjectFromArg(
      "my-org/my-project",
      "/tmp",
      "trace list"
    );
    expect(result).toEqual({ org: "my-org", project: "my-project" });
    expect(findProjectsBySlugSpy).not.toHaveBeenCalled();
    expect(resolveOrgAndProjectSpy).not.toHaveBeenCalled();
  });

  test("throws for org-all target (org/ without project)", async () => {
    await expect(
      resolveTarget.resolveOrgProjectFromArg("my-org/", "/tmp", "trace list")
    ).rejects.toThrow(ContextError);
  });

  test("throws ContextError with project hint for org-all", async () => {
    try {
      await resolveTarget.resolveOrgProjectFromArg(
        "my-org/",
        "/tmp",
        "trace list"
      );
      expect.unreachable("Should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ContextError);
      expect((error as ContextError).message).toContain("specify a project");
    }
  });

  test("resolves single project match", async () => {
    findProjectsBySlugSpy.mockResolvedValue([
      { slug: "frontend", orgSlug: "acme", id: "1", name: "Frontend" },
    ] as ProjectWithOrg[]);

    const result = await resolveTarget.resolveOrgProjectFromArg(
      "frontend",
      "/tmp",
      "trace list"
    );
    expect(result).toEqual({ org: "acme", project: "frontend" });
  });

  test("throws when no project found", async () => {
    findProjectsBySlugSpy.mockResolvedValue([]);

    await expect(
      resolveTarget.resolveOrgProjectFromArg(
        "nonexistent",
        "/tmp",
        "trace list"
      )
    ).rejects.toThrow(ResolutionError);
  });

  test("throws when multiple projects found", async () => {
    findProjectsBySlugSpy.mockResolvedValue([
      { slug: "frontend", orgSlug: "org-a", id: "1", name: "Frontend" },
      { slug: "frontend", orgSlug: "org-b", id: "2", name: "Frontend" },
    ] as ProjectWithOrg[]);

    try {
      await resolveTarget.resolveOrgProjectFromArg(
        "frontend",
        "/tmp",
        "trace list"
      );
      expect.unreachable("Should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ResolutionError);
      // Message says "is ambiguous", not "is required"
      expect((error as ResolutionError).message).toContain("is ambiguous");
      expect((error as ResolutionError).message).toContain("2 organizations");
    }
  });

  test("uses auto-detect when no target provided", async () => {
    resolveOrgAndProjectSpy.mockResolvedValue({
      org: "detected-org",
      project: "detected-project",
    });

    const result = await resolveTarget.resolveOrgProjectFromArg(
      undefined,
      "/tmp",
      "trace list"
    );
    expect(result).toEqual({
      org: "detected-org",
      project: "detected-project",
    });
    expect(resolveOrgAndProjectSpy).toHaveBeenCalledWith({
      cwd: "/tmp",
      usageHint: "sentry trace list <org>/<project>",
    });
  });

  test("throws when auto-detect returns null", async () => {
    resolveOrgAndProjectSpy.mockResolvedValue(null);

    await expect(
      resolveTarget.resolveOrgProjectFromArg(undefined, "/tmp", "trace list")
    ).rejects.toThrow(ContextError);
  });
});

// ============================================================================
// listCommand.func()
// ============================================================================

describe("listCommand.func", () => {
  let listTransactionsSpy: ReturnType<typeof spyOn>;
  let findProjectsBySlugSpy: ReturnType<typeof spyOn>;
  let resolveOrgAndProjectSpy: ReturnType<typeof spyOn>;

  const sampleTraces: TransactionListItem[] = [
    {
      trace: "aaaa1111bbbb2222cccc3333dddd4444",
      id: "evt001",
      transaction: "GET /api/users",
      timestamp: "2025-01-30T14:32:15+00:00",
      "transaction.duration": 245,
      project: "test-project",
    },
    {
      trace: "eeee5555ffff6666aaaa7777bbbb8888",
      id: "evt002",
      transaction: "POST /api/checkout",
      timestamp: "2025-01-30T14:31:00+00:00",
      "transaction.duration": 1823,
      project: "test-project",
    },
  ];

  function createMockContext() {
    const stdoutWrite = mock(() => true);
    return {
      context: {
        stdout: { write: stdoutWrite },
        stderr: { write: mock(() => true) },
        cwd: "/tmp",
        setContext: mock(() => {
          // no-op for test
        }),
      },
      stdoutWrite,
    };
  }

  beforeEach(() => {
    listTransactionsSpy = spyOn(apiClient, "listTransactions");
    findProjectsBySlugSpy = spyOn(apiClient, "findProjectsBySlug");
    resolveOrgAndProjectSpy = spyOn(resolveTarget, "resolveOrgAndProject");
  });

  afterEach(() => {
    listTransactionsSpy.mockRestore();
    findProjectsBySlugSpy.mockRestore();
    resolveOrgAndProjectSpy.mockRestore();
  });

  test("outputs JSON array when --json flag is set", async () => {
    listTransactionsSpy.mockResolvedValue(sampleTraces);

    const { context, stdoutWrite } = createMockContext();
    const func = await listCommand.loader();
    await func.call(
      context,
      { limit: 20, sort: "date", json: true },
      "test-org/test-project"
    );

    const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
    const parsed = JSON.parse(output);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].transaction).toBe("GET /api/users");
  });

  test("outputs empty JSON array when no traces found with --json", async () => {
    listTransactionsSpy.mockResolvedValue([]);

    const { context, stdoutWrite } = createMockContext();
    const func = await listCommand.loader();
    await func.call(
      context,
      { limit: 20, sort: "date", json: true },
      "test-org/test-project"
    );

    const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
    expect(JSON.parse(output)).toEqual([]);
  });

  test("writes 'No traces found.' when empty without --json", async () => {
    listTransactionsSpy.mockResolvedValue([]);

    const { context, stdoutWrite } = createMockContext();
    const func = await listCommand.loader();
    await func.call(
      context,
      { limit: 20, sort: "date", json: false },
      "test-org/test-project"
    );

    const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("No traces found.");
  });

  test("writes header, rows, and footer for human output", async () => {
    listTransactionsSpy.mockResolvedValue(sampleTraces);

    const { context, stdoutWrite } = createMockContext();
    const func = await listCommand.loader();
    await func.call(
      context,
      { limit: 20, sort: "date", json: false },
      "test-org/test-project"
    );

    const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("Recent traces in test-org/test-project:");
    expect(output).toContain("GET /api/users");
    expect(output).toContain("POST /api/checkout");
    expect(output).toContain("Showing 2 traces.");
    expect(output).toContain("sentry trace view");
  });

  test("shows 'Use --limit' tip when results match limit", async () => {
    // 2 results with limit=2 means hasMore=true
    listTransactionsSpy.mockResolvedValue(sampleTraces);

    const { context, stdoutWrite } = createMockContext();
    const func = await listCommand.loader();
    await func.call(
      context,
      { limit: 2, sort: "date", json: false },
      "test-org/test-project"
    );

    const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("Use --limit to show more.");
  });

  test("does not show --limit tip when fewer results than limit", async () => {
    listTransactionsSpy.mockResolvedValue(sampleTraces);

    const { context, stdoutWrite } = createMockContext();
    const func = await listCommand.loader();
    await func.call(
      context,
      { limit: 100, sort: "date", json: false },
      "test-org/test-project"
    );

    const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
    expect(output).not.toContain("Use --limit to show more.");
  });

  test("uses singular 'trace' for single result", async () => {
    listTransactionsSpy.mockResolvedValue([sampleTraces[0]]);

    const { context, stdoutWrite } = createMockContext();
    const func = await listCommand.loader();
    await func.call(
      context,
      { limit: 20, sort: "date", json: false },
      "test-org/test-project"
    );

    const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("Showing 1 trace.");
    expect(output).not.toContain("Showing 1 traces.");
  });

  test("calls setContext with resolved org and project", async () => {
    listTransactionsSpy.mockResolvedValue([]);

    const { context } = createMockContext();
    const func = await listCommand.loader();
    await func.call(
      context,
      { limit: 20, sort: "date", json: false },
      "my-org/my-project"
    );

    expect(context.setContext).toHaveBeenCalledWith(["my-org"], ["my-project"]);
  });

  test("passes query, limit, and sort to listTransactions", async () => {
    listTransactionsSpy.mockResolvedValue([]);

    const { context } = createMockContext();
    const func = await listCommand.loader();
    await func.call(
      context,
      { limit: 50, sort: "duration", json: false, query: "transaction:GET" },
      "test-org/test-project"
    );

    expect(listTransactionsSpy).toHaveBeenCalledWith(
      "test-org",
      "test-project",
      { query: "transaction:GET", limit: 50, sort: "duration" }
    );
  });
});
