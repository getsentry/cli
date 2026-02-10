/**
 * Trace View Command Func Tests
 *
 * Tests for the viewCommand func() body and writeHumanOutput
 * in src/commands/trace/view.ts.
 *
 * Uses spyOn to mock api-client and resolve-target to test
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
import {
  viewCommand,
  writeHumanOutput,
} from "../../../src/commands/trace/view.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as apiClient from "../../../src/lib/api-client.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as browser from "../../../src/lib/browser.js";
import { ContextError, ValidationError } from "../../../src/lib/errors.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as resolveTarget from "../../../src/lib/resolve-target.js";
import type { TraceSpan } from "../../../src/types/sentry.js";

// ============================================================================
// writeHumanOutput
// ============================================================================

describe("writeHumanOutput", () => {
  test("writes summary and span tree lines", () => {
    const stdoutWrite = mock(() => true);
    const stdout = { write: stdoutWrite };

    writeHumanOutput(stdout, {
      summaryLines: ["Trace: abc123", "Duration: 245ms"],
      spanTreeLines: ["  └─ GET /api/users [245ms]"],
    });

    const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("Trace: abc123");
    expect(output).toContain("Duration: 245ms");
    expect(output).toContain("GET /api/users");
  });

  test("writes only summary when spanTreeLines is undefined", () => {
    const stdoutWrite = mock(() => true);
    const stdout = { write: stdoutWrite };

    writeHumanOutput(stdout, {
      summaryLines: ["Trace: abc123"],
      spanTreeLines: undefined,
    });

    const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("Trace: abc123");
    // Only one write call for summary
    expect(stdoutWrite).toHaveBeenCalledTimes(1);
  });

  test("writes only summary when spanTreeLines is empty", () => {
    const stdoutWrite = mock(() => true);
    const stdout = { write: stdoutWrite };

    writeHumanOutput(stdout, {
      summaryLines: ["Trace: abc123"],
      spanTreeLines: [],
    });

    const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("Trace: abc123");
    // Empty array means no span tree write
    expect(stdoutWrite).toHaveBeenCalledTimes(1);
  });
});

// ============================================================================
// viewCommand.func()
// ============================================================================

describe("viewCommand.func", () => {
  let getDetailedTraceSpy: ReturnType<typeof spyOn>;
  let findProjectsBySlugSpy: ReturnType<typeof spyOn>;
  let resolveOrgAndProjectSpy: ReturnType<typeof spyOn>;
  let openInBrowserSpy: ReturnType<typeof spyOn>;

  const sampleSpans: TraceSpan[] = [
    {
      span_id: "span-root-001",
      op: "http.server",
      description: "GET /api/users",
      transaction: "GET /api/users",
      "transaction.op": "http.server",
      start_timestamp: 1_706_621_535.0,
      end_timestamp: 1_706_621_535.245,
      project_slug: "test-project",
      event_id: "evt001",
      children: [
        {
          span_id: "span-child-001",
          op: "db.query",
          description: "SELECT * FROM users",
          start_timestamp: 1_706_621_535.01,
          end_timestamp: 1_706_621_535.08,
          project_slug: "test-project",
          children: [],
        },
      ],
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
    getDetailedTraceSpy = spyOn(apiClient, "getDetailedTrace");
    findProjectsBySlugSpy = spyOn(apiClient, "findProjectsBySlug");
    resolveOrgAndProjectSpy = spyOn(resolveTarget, "resolveOrgAndProject");
    openInBrowserSpy = spyOn(browser, "openInBrowser");
  });

  afterEach(() => {
    getDetailedTraceSpy.mockRestore();
    findProjectsBySlugSpy.mockRestore();
    resolveOrgAndProjectSpy.mockRestore();
    openInBrowserSpy.mockRestore();
  });

  test("outputs JSON with summary and spans when --json flag is set", async () => {
    getDetailedTraceSpy.mockResolvedValue(sampleSpans);

    const { context, stdoutWrite } = createMockContext();
    const func = await viewCommand.loader();
    await func.call(
      context,
      { json: true, web: false, spans: 100 },
      "test-org/test-project",
      "aaaa1111bbbb2222cccc3333dddd4444"
    );

    const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
    const parsed = JSON.parse(output);
    expect(parsed).toHaveProperty("summary");
    expect(parsed).toHaveProperty("spans");
    expect(parsed.summary.traceId).toBe("aaaa1111bbbb2222cccc3333dddd4444");
    expect(parsed.spans).toHaveLength(1);
  });

  test("writes human output with summary and span tree", async () => {
    getDetailedTraceSpy.mockResolvedValue(sampleSpans);

    const { context, stdoutWrite } = createMockContext();
    const func = await viewCommand.loader();
    await func.call(
      context,
      { json: false, web: false, spans: 100 },
      "test-org/test-project",
      "aaaa1111bbbb2222cccc3333dddd4444"
    );

    const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("aaaa1111bbbb2222cccc3333dddd4444");
    expect(output).toContain("sentry trace view --web");
  });

  test("throws ValidationError when no spans found", async () => {
    getDetailedTraceSpy.mockResolvedValue([]);

    const { context } = createMockContext();
    const func = await viewCommand.loader();

    await expect(
      func.call(
        context,
        { json: false, web: false, spans: 100 },
        "test-org/test-project",
        "0000000000000000"
      )
    ).rejects.toThrow(ValidationError);
  });

  test("error message contains trace ID when not found", async () => {
    getDetailedTraceSpy.mockResolvedValue([]);

    const { context } = createMockContext();
    const func = await viewCommand.loader();

    try {
      await func.call(
        context,
        { json: false, web: false, spans: 100 },
        "test-org/test-project",
        "deadbeef12345678"
      );
      expect.unreachable("Should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).message).toContain("deadbeef12345678");
    }
  });

  test("opens browser when --web flag is set", async () => {
    openInBrowserSpy.mockResolvedValue(undefined);

    const { context } = createMockContext();
    const func = await viewCommand.loader();
    await func.call(
      context,
      { json: false, web: true, spans: 100 },
      "test-org/test-project",
      "aaaa1111bbbb2222cccc3333dddd4444"
    );

    expect(openInBrowserSpy).toHaveBeenCalled();
    // Should NOT call getDetailedTrace when using --web
    expect(getDetailedTraceSpy).not.toHaveBeenCalled();
  });

  test("omits span tree when --spans 0", async () => {
    getDetailedTraceSpy.mockResolvedValue(sampleSpans);

    const { context, stdoutWrite } = createMockContext();
    const func = await viewCommand.loader();
    await func.call(
      context,
      { json: false, web: false, spans: 0 },
      "test-org/test-project",
      "aaaa1111bbbb2222cccc3333dddd4444"
    );

    const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
    // Summary should be present
    expect(output).toContain("aaaa1111bbbb2222cccc3333dddd4444");
    // Span tree details should not appear (no span_id rendered)
    // The footer should still be present
    expect(output).toContain("sentry trace view --web");
  });

  test("throws ContextError for org-all target", async () => {
    const { context } = createMockContext();
    const func = await viewCommand.loader();

    await expect(
      func.call(
        context,
        { json: false, web: false, spans: 100 },
        "my-org/",
        "aaaa1111bbbb2222cccc3333dddd4444"
      )
    ).rejects.toThrow(ContextError);
  });

  test("throws ContextError when auto-detect returns null", async () => {
    resolveOrgAndProjectSpy.mockResolvedValue(null);

    const { context } = createMockContext();
    const func = await viewCommand.loader();

    await expect(
      func.call(
        context,
        { json: false, web: false, spans: 100 },
        "aaaa1111bbbb2222cccc3333dddd4444"
      )
    ).rejects.toThrow(ContextError);
  });

  test("calls setContext with resolved org and project", async () => {
    getDetailedTraceSpy.mockResolvedValue(sampleSpans);

    const { context } = createMockContext();
    const func = await viewCommand.loader();
    await func.call(
      context,
      { json: true, web: false, spans: 100 },
      "my-org/my-project",
      "aaaa1111bbbb2222cccc3333dddd4444"
    );

    expect(context.setContext).toHaveBeenCalledWith(["my-org"], ["my-project"]);
  });

  test("resolves project search target", async () => {
    findProjectsBySlugSpy.mockResolvedValue([
      { slug: "frontend", orgSlug: "acme", id: "1", name: "Frontend" },
    ]);
    getDetailedTraceSpy.mockResolvedValue(sampleSpans);

    const { context } = createMockContext();
    const func = await viewCommand.loader();
    await func.call(
      context,
      { json: true, web: false, spans: 100 },
      "frontend",
      "aaaa1111bbbb2222cccc3333dddd4444"
    );

    expect(findProjectsBySlugSpy).toHaveBeenCalledWith("frontend");
    expect(context.setContext).toHaveBeenCalledWith(["acme"], ["frontend"]);
  });
});
