/**
 * Log List Command Tests
 *
 * Tests for the `sentry log list` command func() body, covering:
 * - Standard project-scoped mode (no --trace)
 * - Trace-filtered mode (--trace <id>)
 * - Org resolution failure in trace mode
 * - Follow/streaming mode for both standard and trace modes
 *
 * Uses spyOn mocking to avoid real HTTP calls or database access.
 * Follow-mode tests use SIGINT to cleanly stop the setTimeout-based
 * poll loop — the promise resolves on SIGINT (normal termination).
 * AuthError tests verify that fetch failures reject the promise.
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
import { listCommand } from "../../../src/commands/log/list.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as apiClient from "../../../src/lib/api-client.js";
import { AuthError, ContextError } from "../../../src/lib/errors.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as formatters from "../../../src/lib/formatters/index.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as resolveTarget from "../../../src/lib/resolve-target.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as versionCheck from "../../../src/lib/version-check.js";
import type { SentryLog, TraceLog } from "../../../src/types/sentry.js";

// ============================================================================
// Helpers
// ============================================================================

const TRACE_ID = "aaaa1111bbbb2222cccc3333dddd4444";
const ORG = "test-org";
const PROJECT = "test-project";

/**
 * Intercept `process.once("SIGINT", handler)` registrations so tests can
 * invoke the handler directly without sending a real signal (which would
 * kill the Bun test runner).
 *
 * Must be created BEFORE the code under test runs. Call `trigger()` to
 * simulate SIGINT, and `restore()` in afterEach.
 */
function interceptSigint() {
  let handler: ((...args: unknown[]) => void) | null = null;
  const originalOnce = process.once.bind(process);
  const spy = spyOn(process, "once").mockImplementation(((
    event: string,
    fn: (...args: unknown[]) => void
  ) => {
    if (event === "SIGINT") {
      handler = fn;
      return process;
    }
    return originalOnce(event, fn);
  }) as typeof process.once);

  // Also intercept removeListener so AuthError path works
  const originalRemoveListener = process.removeListener.bind(process);
  const removeSpy = spyOn(process, "removeListener").mockImplementation(((
    event: string,
    fn: (...args: unknown[]) => void
  ) => {
    if (event === "SIGINT" && fn === handler) {
      handler = null;
      return process;
    }
    return originalRemoveListener(event, fn);
  }) as typeof process.removeListener);

  return {
    /** Invoke the captured SIGINT handler (simulates Ctrl+C) */
    trigger() {
      if (handler) {
        const h = handler;
        handler = null;
        h();
      }
    },
    /** Restore original process.once and process.removeListener */
    restore() {
      spy.mockRestore();
      removeSpy.mockRestore();
      handler = null;
    },
  };
}

function createMockContext() {
  const stdoutWrite = mock(() => true);
  const stderrWrite = mock(() => true);
  return {
    context: {
      stdout: { write: stdoutWrite },
      stderr: { write: stderrWrite },
      cwd: "/tmp",
      setContext: mock(() => {
        // no-op for test
      }),
    },
    stdoutWrite,
    stderrWrite,
  };
}

/** Sample project-scoped logs (SentryLog) */
const sampleLogs: SentryLog[] = [
  {
    "sentry.item_id": "item001",
    timestamp: "2025-01-30T14:32:15+00:00",
    timestamp_precise: 1_738_247_535_123_456_000,
    severity: "info",
    message: "Request received",
    trace: "aaaa1111bbbb2222cccc3333dddd4444",
  },
  {
    "sentry.item_id": "item002",
    timestamp: "2025-01-30T14:32:16+00:00",
    timestamp_precise: 1_738_247_536_456_789_000,
    severity: "warn",
    message: "Slow query detected",
    trace: "aaaa1111bbbb2222cccc3333dddd4444",
  },
  {
    "sentry.item_id": "item003",
    timestamp: "2025-01-30T14:32:17+00:00",
    timestamp_precise: 1_738_247_537_789_012_000,
    severity: "error",
    message: "Database connection failed",
    trace: "aaaa1111bbbb2222cccc3333dddd4444",
  },
];

/** Sample trace-scoped logs (TraceLog) */
const sampleTraceLogs: TraceLog[] = [
  {
    id: "log001",
    "project.id": 1,
    trace: TRACE_ID,
    severity_number: 9,
    severity: "info",
    timestamp: "2025-01-30T14:32:15+00:00",
    timestamp_precise: 1_738_247_535_123_456_000,
    message: "Request received",
  },
  {
    id: "log002",
    "project.id": 1,
    trace: TRACE_ID,
    severity_number: 13,
    severity: "warn",
    timestamp: "2025-01-30T14:32:16+00:00",
    timestamp_precise: 1_738_247_536_456_789_000,
    message: "Slow query detected",
  },
  {
    id: "log003",
    "project.id": 1,
    trace: TRACE_ID,
    severity_number: 17,
    severity: "error",
    timestamp: "2025-01-30T14:32:17+00:00",
    timestamp_precise: 1_738_247_537_789_012_000,
    message: "Database connection failed",
  },
];

/** Newer trace logs for polling tests — uses far-future timestamp to always be "newer" */
const newerTraceLogs: TraceLog[] = [
  {
    id: "log004",
    "project.id": 1,
    trace: TRACE_ID,
    severity_number: 9,
    severity: "info",
    timestamp: "2099-01-30T14:32:20+00:00",
    timestamp_precise: 4_073_000_000_000_000_000,
    message: "New poll result",
  },
];

/** Newer project logs for polling tests — uses far-future timestamp */
const newerLogs: SentryLog[] = [
  {
    "sentry.item_id": "item004",
    timestamp: "2099-01-30T14:32:20+00:00",
    timestamp_precise: 4_073_000_000_000_000_000,
    severity: "info",
    message: "New poll result",
    trace: "aaaa1111bbbb2222cccc3333dddd4444",
  },
];

// ============================================================================
// Standard mode (no --trace)
// ============================================================================

describe("listCommand.func — standard mode", () => {
  let listLogsSpy: ReturnType<typeof spyOn>;
  let resolveOrgProjectSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    listLogsSpy = spyOn(apiClient, "listLogs");
    resolveOrgProjectSpy = spyOn(resolveTarget, "resolveOrgProjectFromArg");
  });

  afterEach(() => {
    listLogsSpy.mockRestore();
    resolveOrgProjectSpy.mockRestore();
  });

  test("outputs JSON array for --json", async () => {
    listLogsSpy.mockResolvedValue(sampleLogs);
    resolveOrgProjectSpy.mockResolvedValue({ org: ORG, project: PROJECT });

    const { context, stdoutWrite } = createMockContext();
    const func = await listCommand.loader();
    await func.call(context, { json: true, limit: 100 }, `${ORG}/${PROJECT}`);

    const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
    const parsed = JSON.parse(output);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(3);
  });

  test("outputs JSON in chronological order (oldest first)", async () => {
    // API returns newest first: item003, item002, item001
    const newestFirst = [...sampleLogs].reverse();
    listLogsSpy.mockResolvedValue(newestFirst);
    resolveOrgProjectSpy.mockResolvedValue({ org: ORG, project: PROJECT });

    const { context, stdoutWrite } = createMockContext();
    const func = await listCommand.loader();
    await func.call(context, { json: true, limit: 100 }, `${ORG}/${PROJECT}`);

    const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
    const parsed = JSON.parse(output);
    // After reversal, oldest should be first
    expect(parsed[0]["sentry.item_id"]).toBe("item001");
    expect(parsed[2]["sentry.item_id"]).toBe("item003");
  });

  test("shows 'No logs found' for empty result (human mode)", async () => {
    listLogsSpy.mockResolvedValue([]);
    resolveOrgProjectSpy.mockResolvedValue({ org: ORG, project: PROJECT });

    const { context, stdoutWrite } = createMockContext();
    const func = await listCommand.loader();
    await func.call(context, { json: false, limit: 100 }, `${ORG}/${PROJECT}`);

    const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("No logs found");
  });

  test("renders log messages in human output", async () => {
    listLogsSpy.mockResolvedValue(sampleLogs);
    resolveOrgProjectSpy.mockResolvedValue({ org: ORG, project: PROJECT });

    const { context, stdoutWrite } = createMockContext();
    const func = await listCommand.loader();
    await func.call(context, { json: false, limit: 100 }, `${ORG}/${PROJECT}`);

    const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("Request received");
    expect(output).toContain("Slow query detected");
    expect(output).toContain("Database connection failed");
  });

  test("shows count footer", async () => {
    listLogsSpy.mockResolvedValue(sampleLogs);
    resolveOrgProjectSpy.mockResolvedValue({ org: ORG, project: PROJECT });

    const { context, stdoutWrite } = createMockContext();
    const func = await listCommand.loader();
    await func.call(context, { json: false, limit: 100 }, `${ORG}/${PROJECT}`);

    const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("Showing 3 log");
  });

  test("shows --limit tip when results match limit", async () => {
    listLogsSpy.mockResolvedValue(sampleLogs);
    resolveOrgProjectSpy.mockResolvedValue({ org: ORG, project: PROJECT });

    const { context, stdoutWrite } = createMockContext();
    const func = await listCommand.loader();
    // limit equals number of returned logs → hasMore = true
    await func.call(context, { json: false, limit: 3 }, `${ORG}/${PROJECT}`);

    const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("Use --limit to show more");
  });

  test("does not show tip when fewer results than limit", async () => {
    listLogsSpy.mockResolvedValue(sampleLogs);
    resolveOrgProjectSpy.mockResolvedValue({ org: ORG, project: PROJECT });

    const { context, stdoutWrite } = createMockContext();
    const func = await listCommand.loader();
    await func.call(context, { json: false, limit: 100 }, `${ORG}/${PROJECT}`);

    const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
    expect(output).not.toContain("Use --limit to show more");
  });

  test("passes query and limit to listLogs", async () => {
    listLogsSpy.mockResolvedValue([]);
    resolveOrgProjectSpy.mockResolvedValue({ org: ORG, project: PROJECT });

    const { context } = createMockContext();
    const func = await listCommand.loader();
    await func.call(
      context,
      { json: false, limit: 50, query: "level:error" },
      `${ORG}/${PROJECT}`
    );

    expect(listLogsSpy).toHaveBeenCalledWith(ORG, PROJECT, {
      query: "level:error",
      limit: 50,
      statsPeriod: "90d",
    });
  });

  test("calls setContext with resolved org and project", async () => {
    listLogsSpy.mockResolvedValue([]);
    resolveOrgProjectSpy.mockResolvedValue({ org: ORG, project: PROJECT });

    const { context } = createMockContext();
    const func = await listCommand.loader();
    await func.call(context, { json: true, limit: 100 }, `${ORG}/${PROJECT}`);

    expect(context.setContext).toHaveBeenCalledWith([ORG], [PROJECT]);
  });
});

// ============================================================================
// Trace mode (--trace)
// ============================================================================

describe("listCommand.func — trace mode", () => {
  let listTraceLogsSpy: ReturnType<typeof spyOn>;
  let resolveOrgSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    listTraceLogsSpy = spyOn(apiClient, "listTraceLogs");
    resolveOrgSpy = spyOn(resolveTarget, "resolveOrg");
  });

  afterEach(() => {
    listTraceLogsSpy.mockRestore();
    resolveOrgSpy.mockRestore();
  });

  test("outputs JSON array for --json --trace", async () => {
    listTraceLogsSpy.mockResolvedValue(sampleTraceLogs);
    resolveOrgSpy.mockResolvedValue({ org: ORG });

    const { context, stdoutWrite } = createMockContext();
    const func = await listCommand.loader();
    await func.call(context, { json: true, limit: 100, trace: TRACE_ID });

    const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
    const parsed = JSON.parse(output);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(3);
  });

  test("outputs JSON in chronological order (oldest first)", async () => {
    const newestFirst = [...sampleTraceLogs].reverse();
    listTraceLogsSpy.mockResolvedValue(newestFirst);
    resolveOrgSpy.mockResolvedValue({ org: ORG });

    const { context, stdoutWrite } = createMockContext();
    const func = await listCommand.loader();
    await func.call(context, { json: true, limit: 100, trace: TRACE_ID });

    const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
    const parsed = JSON.parse(output);
    expect(parsed[0].id).toBe("log001");
    expect(parsed[2].id).toBe("log003");
  });

  test("shows empty-trace message in human mode", async () => {
    listTraceLogsSpy.mockResolvedValue([]);
    resolveOrgSpy.mockResolvedValue({ org: ORG });

    const { context, stdoutWrite } = createMockContext();
    const func = await listCommand.loader();
    await func.call(context, { json: false, limit: 100, trace: TRACE_ID });

    const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("No logs found");
    expect(output).toContain(TRACE_ID);
  });

  test("renders trace log messages in human output", async () => {
    listTraceLogsSpy.mockResolvedValue(sampleTraceLogs);
    resolveOrgSpy.mockResolvedValue({ org: ORG });

    const { context, stdoutWrite } = createMockContext();
    const func = await listCommand.loader();
    await func.call(context, { json: false, limit: 100, trace: TRACE_ID });

    const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("Request received");
    expect(output).toContain("Slow query detected");
    expect(output).toContain("Database connection failed");
  });

  test("shows count footer with trace ID", async () => {
    listTraceLogsSpy.mockResolvedValue(sampleTraceLogs);
    resolveOrgSpy.mockResolvedValue({ org: ORG });

    const { context, stdoutWrite } = createMockContext();
    const func = await listCommand.loader();
    await func.call(context, { json: false, limit: 100, trace: TRACE_ID });

    const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("Showing 3 log");
    expect(output).toContain(TRACE_ID);
  });

  test("shows --limit tip when trace results match limit", async () => {
    listTraceLogsSpy.mockResolvedValue(sampleTraceLogs);
    resolveOrgSpy.mockResolvedValue({ org: ORG });

    const { context, stdoutWrite } = createMockContext();
    const func = await listCommand.loader();
    await func.call(context, { json: false, limit: 3, trace: TRACE_ID });

    const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("Use --limit to show more.");
  });

  test("passes traceId, limit, and query to listTraceLogs", async () => {
    listTraceLogsSpy.mockResolvedValue([]);
    resolveOrgSpy.mockResolvedValue({ org: ORG });

    const { context } = createMockContext();
    const func = await listCommand.loader();
    await func.call(context, {
      json: false,
      limit: 50,
      trace: TRACE_ID,
      query: "level:error",
    });

    expect(listTraceLogsSpy).toHaveBeenCalledWith(ORG, TRACE_ID, {
      query: "level:error",
      limit: 50,
      statsPeriod: "14d",
    });
  });

  test("calls setContext with org and empty project array", async () => {
    listTraceLogsSpy.mockResolvedValue([]);
    resolveOrgSpy.mockResolvedValue({ org: ORG });

    const { context } = createMockContext();
    const func = await listCommand.loader();
    await func.call(context, { json: true, limit: 100, trace: TRACE_ID });

    expect(context.setContext).toHaveBeenCalledWith([ORG], []);
  });

  test("uses positional target as org slug in trace mode", async () => {
    listTraceLogsSpy.mockResolvedValue([]);
    resolveOrgSpy.mockResolvedValue({ org: "my-org" });

    const { context } = createMockContext();
    const func = await listCommand.loader();
    await func.call(
      context,
      { json: true, limit: 100, trace: TRACE_ID },
      "my-org"
    );

    expect(resolveOrgSpy).toHaveBeenCalledWith({
      org: "my-org",
      cwd: "/tmp",
    });
  });
});

// ============================================================================
// Org resolution failure in trace mode
// ============================================================================

describe("listCommand.func — trace mode org resolution failure", () => {
  let resolveOrgSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    resolveOrgSpy = spyOn(resolveTarget, "resolveOrg");
  });

  afterEach(() => {
    resolveOrgSpy.mockRestore();
  });

  test("throws ContextError when org cannot be resolved", async () => {
    resolveOrgSpy.mockResolvedValue(null);

    const { context } = createMockContext();
    const func = await listCommand.loader();

    await expect(
      func.call(context, { json: false, limit: 100, trace: TRACE_ID })
    ).rejects.toThrow(ContextError);
  });

  test("ContextError mentions Organization", async () => {
    resolveOrgSpy.mockResolvedValue(null);

    const { context } = createMockContext();
    const func = await listCommand.loader();

    try {
      await func.call(context, {
        json: false,
        limit: 100,
        trace: TRACE_ID,
      });
      expect.unreachable("Should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ContextError);
      expect((error as ContextError).message).toContain("Organization");
    }
  });
});

// ============================================================================
// Follow mode — standard (--follow, no --trace)
//
// Strategy: SIGINT resolves the promise (normal termination). AuthError
// from fetch rejects the promise. Tests use interceptSigint() to capture
// the SIGINT handler and invoke it directly (process.emit("SIGINT")
// kills the Bun test runner).
// ============================================================================

describe("listCommand.func — follow mode (standard)", () => {
  let listLogsSpy: ReturnType<typeof spyOn>;
  let resolveOrgProjectSpy: ReturnType<typeof spyOn>;
  let isPlainSpy: ReturnType<typeof spyOn>;
  let updateNotifSpy: ReturnType<typeof spyOn>;
  let sigint: ReturnType<typeof interceptSigint>;

  beforeEach(() => {
    sigint = interceptSigint();
    listLogsSpy = spyOn(apiClient, "listLogs");
    resolveOrgProjectSpy = spyOn(resolveTarget, "resolveOrgProjectFromArg");
    isPlainSpy = spyOn(formatters, "isPlainOutput").mockReturnValue(true);
    updateNotifSpy = spyOn(
      versionCheck,
      "getUpdateNotification"
    ).mockReturnValue(null);
  });

  afterEach(() => {
    listLogsSpy.mockRestore();
    resolveOrgProjectSpy.mockRestore();
    isPlainSpy.mockRestore();
    updateNotifSpy.mockRestore();
    sigint.restore();
  });

  /** Follow flags with 1-second interval (minimum real-world value) */
  const followFlags = {
    json: false,
    limit: 100,
    follow: 1,
  } as const;

  test("writes initial logs then resolves on SIGINT", async () => {
    listLogsSpy.mockResolvedValueOnce(sampleLogs);
    resolveOrgProjectSpy.mockResolvedValue({ org: ORG, project: PROJECT });

    const { context, stdoutWrite } = createMockContext();
    const func = await listCommand.loader();

    const promise = func.call(context, followFlags, `${ORG}/${PROJECT}`);
    await Bun.sleep(50);
    sigint.trigger();
    await promise;

    const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("Request received");
  });

  test("SIGINT during initial fetch does not start poll loop", async () => {
    // fetchInitial will hang until we resolve it manually
    let resolveFetch!: (logs: typeof sampleLogs) => void;
    listLogsSpy.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveFetch = resolve;
      })
    );
    resolveOrgProjectSpy.mockResolvedValue({ org: ORG, project: PROJECT });

    const { context } = createMockContext();
    const func = await listCommand.loader();

    const promise = func.call(context, followFlags, `${ORG}/${PROJECT}`);
    await Bun.sleep(10);

    // SIGINT fires while fetchInitial is still pending
    sigint.trigger();
    await Bun.sleep(10);

    // Now resolve the fetch — the .then() should NOT schedule a poll
    resolveFetch(sampleLogs);
    await promise;

    // If the bug existed, a timer would be scheduled. Wait to confirm none fires.
    await Bun.sleep(50);

    // Only 1 call to listLogs (the initial fetch). No poll calls.
    expect(listLogsSpy).toHaveBeenCalledTimes(1);
  });

  test("writes stderr banner in human follow mode", async () => {
    listLogsSpy.mockResolvedValueOnce([]);
    resolveOrgProjectSpy.mockResolvedValue({ org: ORG, project: PROJECT });

    const { context, stderrWrite } = createMockContext();
    const func = await listCommand.loader();

    const promise = func.call(context, followFlags, `${ORG}/${PROJECT}`);
    await Bun.sleep(50);
    sigint.trigger();
    await promise;

    const stderr = stderrWrite.mock.calls.map((c) => c[0]).join("");
    expect(stderr).toContain("Streaming logs");
    expect(stderr).toContain("Ctrl+C");
  });

  test("skips stderr banner in JSON follow mode", async () => {
    listLogsSpy.mockResolvedValueOnce([]);
    resolveOrgProjectSpy.mockResolvedValue({ org: ORG, project: PROJECT });

    const { context, stderrWrite } = createMockContext();
    const func = await listCommand.loader();

    const promise = func.call(
      context,
      { ...followFlags, json: true },
      `${ORG}/${PROJECT}`
    );
    await Bun.sleep(50);
    sigint.trigger();
    await promise;

    const stderr = stderrWrite.mock.calls.map((c) => c[0]).join("");
    expect(stderr).not.toContain("Streaming logs");
  });

  test("writes new logs from poll iteration", async () => {
    // Initial: sampleLogs, first poll: newerLogs
    listLogsSpy
      .mockResolvedValueOnce(sampleLogs)
      .mockResolvedValueOnce(newerLogs);
    resolveOrgProjectSpy.mockResolvedValue({ org: ORG, project: PROJECT });

    const { context, stdoutWrite } = createMockContext();
    const func = await listCommand.loader();

    const promise = func.call(context, followFlags, `${ORG}/${PROJECT}`);
    // Wait for initial fetch + poll timer (1s) + poll execution
    await Bun.sleep(1200);
    sigint.trigger();
    await promise;

    const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
    // Both initial and polled logs should appear
    expect(output).toContain("Request received");
    expect(output).toContain("New poll result");
  });

  test("streams JSON objects per-line in follow mode", async () => {
    listLogsSpy.mockResolvedValueOnce(sampleLogs);
    resolveOrgProjectSpy.mockResolvedValue({ org: ORG, project: PROJECT });

    const { context, stdoutWrite } = createMockContext();
    const func = await listCommand.loader();

    const promise = func.call(
      context,
      { ...followFlags, json: true },
      `${ORG}/${PROJECT}`
    );
    await Bun.sleep(50);
    sigint.trigger();
    await promise;

    // Each log should be written as a separate JSON object (streaming NDJSON)
    const calls = stdoutWrite.mock.calls.map((c) => c[0]);
    const jsonObjects = calls.filter((s: string) => {
      try {
        JSON.parse(s);
        return true;
      } catch {
        return false;
      }
    });
    expect(jsonObjects.length).toBe(3);
  });

  test("rejects with AuthError from initial fetch", async () => {
    listLogsSpy.mockRejectedValueOnce(new AuthError("expired"));
    resolveOrgProjectSpy.mockResolvedValue({ org: ORG, project: PROJECT });

    const { context } = createMockContext();
    const func = await listCommand.loader();

    await expect(
      func.call(context, followFlags, `${ORG}/${PROJECT}`)
    ).rejects.toThrow(AuthError);
  });

  test("rejects with AuthError from poll", async () => {
    listLogsSpy
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new AuthError("expired"));
    resolveOrgProjectSpy.mockResolvedValue({ org: ORG, project: PROJECT });

    const { context } = createMockContext();
    const func = await listCommand.loader();

    await expect(
      func.call(context, followFlags, `${ORG}/${PROJECT}`)
    ).rejects.toThrow(AuthError);
  });

  test("continues polling after transient error (non-auth)", async () => {
    // Initial: empty, poll 1: transient error, then SIGINT
    listLogsSpy
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error("network timeout"));
    resolveOrgProjectSpy.mockResolvedValue({ org: ORG, project: PROJECT });

    const { context, stderrWrite } = createMockContext();
    const func = await listCommand.loader();

    const promise = func.call(context, followFlags, `${ORG}/${PROJECT}`);
    // Wait for initial fetch + poll timer (1s) + poll execution
    await Bun.sleep(1200);
    sigint.trigger();
    await promise;

    // Transient error should be reported to stderr
    const stderr = stderrWrite.mock.calls.map((c) => c[0]).join("");
    expect(stderr).toContain("Error fetching logs");
    expect(stderr).toContain("network timeout");
  });

  test("uses 1m statsPeriod for initial follow fetch", async () => {
    listLogsSpy.mockResolvedValueOnce([]);
    resolveOrgProjectSpy.mockResolvedValue({ org: ORG, project: PROJECT });

    const { context } = createMockContext();
    const func = await listCommand.loader();

    const promise = func.call(context, followFlags, `${ORG}/${PROJECT}`);
    await Bun.sleep(50);
    sigint.trigger();
    await promise;

    // Initial fetch should use "1m" (short window for follow mode)
    expect(listLogsSpy.mock.calls[0]).toEqual([
      ORG,
      PROJECT,
      { query: undefined, limit: 100, statsPeriod: "1m" },
    ]);
  });

  test("passes afterTimestamp to poll calls", async () => {
    // maxTimestamp scans the entire batch for the highest timestamp_precise
    const maxTs = Math.max(...sampleLogs.map((l) => l.timestamp_precise));
    listLogsSpy.mockResolvedValueOnce(sampleLogs).mockResolvedValueOnce([]);
    resolveOrgProjectSpy.mockResolvedValue({ org: ORG, project: PROJECT });

    const { context } = createMockContext();
    const func = await listCommand.loader();

    const promise = func.call(context, followFlags, `${ORG}/${PROJECT}`);
    // Wait for initial fetch + poll timer (1s) + poll execution
    await Bun.sleep(1200);
    sigint.trigger();
    await promise;

    // Poll call (index 1) should include afterTimestamp from max in batch
    const pollCall = listLogsSpy.mock.calls[1];
    expect(pollCall).toBeDefined();
    expect(pollCall[2].afterTimestamp).toBe(maxTs);
    expect(pollCall[2].statsPeriod).toBe("10m");
  });

  test("shows update notification when available", async () => {
    updateNotifSpy.mockReturnValue("Update available: v2.0.0\n");
    listLogsSpy.mockResolvedValueOnce([]);
    resolveOrgProjectSpy.mockResolvedValue({ org: ORG, project: PROJECT });

    const { context, stderrWrite } = createMockContext();
    const func = await listCommand.loader();

    const promise = func.call(context, followFlags, `${ORG}/${PROJECT}`);
    await Bun.sleep(50);
    sigint.trigger();
    await promise;

    const stderr = stderrWrite.mock.calls.map((c) => c[0]).join("");
    expect(stderr).toContain("Update available: v2.0.0");
  });
});

// ============================================================================
// Follow mode — trace (--follow + --trace)
// ============================================================================

describe("listCommand.func — follow mode (trace)", () => {
  let listTraceLogsSpy: ReturnType<typeof spyOn>;
  let resolveOrgSpy: ReturnType<typeof spyOn>;
  let isPlainSpy: ReturnType<typeof spyOn>;
  let updateNotifSpy: ReturnType<typeof spyOn>;
  let sigint: ReturnType<typeof interceptSigint>;

  beforeEach(() => {
    sigint = interceptSigint();
    listTraceLogsSpy = spyOn(apiClient, "listTraceLogs");
    resolveOrgSpy = spyOn(resolveTarget, "resolveOrg");
    isPlainSpy = spyOn(formatters, "isPlainOutput").mockReturnValue(true);
    updateNotifSpy = spyOn(
      versionCheck,
      "getUpdateNotification"
    ).mockReturnValue(null);
  });

  afterEach(() => {
    listTraceLogsSpy.mockRestore();
    resolveOrgSpy.mockRestore();
    isPlainSpy.mockRestore();
    updateNotifSpy.mockRestore();
    sigint.restore();
  });

  const traceFollowFlags = {
    json: false,
    limit: 100,
    follow: 1,
    trace: TRACE_ID,
  } as const;

  test("writes initial trace logs then resolves on SIGINT", async () => {
    listTraceLogsSpy.mockResolvedValueOnce(sampleTraceLogs);
    resolveOrgSpy.mockResolvedValue({ org: ORG });

    const { context, stdoutWrite } = createMockContext();
    const func = await listCommand.loader();

    const promise = func.call(context, traceFollowFlags);
    await Bun.sleep(50);
    sigint.trigger();
    await promise;

    const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("Request received");
  });

  test("writes stderr banner with trace ID in follow mode", async () => {
    listTraceLogsSpy.mockResolvedValueOnce([]);
    resolveOrgSpy.mockResolvedValue({ org: ORG });

    const { context, stderrWrite } = createMockContext();
    const func = await listCommand.loader();

    const promise = func.call(context, traceFollowFlags);
    await Bun.sleep(50);
    sigint.trigger();
    await promise;

    const stderr = stderrWrite.mock.calls.map((c) => c[0]).join("");
    expect(stderr).toContain("Streaming logs");
    expect(stderr).toContain(TRACE_ID);
    expect(stderr).toContain("Ctrl+C");
  });

  test("filters new logs by timestamp_precise (dedup)", async () => {
    // Initial fetch returns logs, poll returns mix of old+new
    const mixedLogs: TraceLog[] = [
      ...sampleTraceLogs, // old — should be filtered out
      ...newerTraceLogs, // new — should pass filter
    ];
    listTraceLogsSpy
      .mockResolvedValueOnce(sampleTraceLogs)
      .mockResolvedValueOnce(mixedLogs);
    resolveOrgSpy.mockResolvedValue({ org: ORG });

    const { context, stdoutWrite } = createMockContext();
    const func = await listCommand.loader();

    const promise = func.call(context, traceFollowFlags);
    // Wait for initial fetch + poll timer (1s) + poll execution
    await Bun.sleep(1200);
    sigint.trigger();
    await promise;

    const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
    // New log should appear
    expect(output).toContain("New poll result");
    // Count total log writes — initial 3 + 1 new from poll
    // (old logs from poll are filtered by timestamp_precise)
  });

  test("streams JSON objects per-line in trace follow mode", async () => {
    listTraceLogsSpy.mockResolvedValueOnce(sampleTraceLogs);
    resolveOrgSpy.mockResolvedValue({ org: ORG });

    const { context, stdoutWrite } = createMockContext();
    const func = await listCommand.loader();

    const promise = func.call(context, { ...traceFollowFlags, json: true });
    await Bun.sleep(50);
    sigint.trigger();
    await promise;

    const calls = stdoutWrite.mock.calls.map((c) => c[0]);
    const jsonObjects = calls.filter((s: string) => {
      try {
        JSON.parse(s);
        return true;
      } catch {
        return false;
      }
    });
    expect(jsonObjects.length).toBe(3);
  });

  test("rejects with AuthError from poll", async () => {
    listTraceLogsSpy
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new AuthError("expired"));
    resolveOrgSpy.mockResolvedValue({ org: ORG });

    const { context } = createMockContext();
    const func = await listCommand.loader();

    await expect(func.call(context, traceFollowFlags)).rejects.toThrow(
      AuthError
    );
  });

  test("continues polling after transient error (trace mode)", async () => {
    listTraceLogsSpy
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error("server error"));
    resolveOrgSpy.mockResolvedValue({ org: ORG });

    const { context, stderrWrite } = createMockContext();
    const func = await listCommand.loader();

    const promise = func.call(context, traceFollowFlags);
    // Wait for initial fetch + poll timer (1s) + poll execution
    await Bun.sleep(1200);
    sigint.trigger();
    await promise;

    const stderr = stderrWrite.mock.calls.map((c) => c[0]).join("");
    expect(stderr).toContain("Error fetching logs");
    expect(stderr).toContain("server error");
  });

  test("uses 1m statsPeriod for initial trace follow fetch", async () => {
    listTraceLogsSpy.mockResolvedValueOnce([]);
    resolveOrgSpy.mockResolvedValue({ org: ORG });

    const { context } = createMockContext();
    const func = await listCommand.loader();

    const promise = func.call(context, traceFollowFlags);
    await Bun.sleep(50);
    sigint.trigger();
    await promise;

    expect(listTraceLogsSpy.mock.calls[0]).toEqual([
      ORG,
      TRACE_ID,
      { query: undefined, limit: 100, statsPeriod: "1m" },
    ]);
  });

  test("does not pass afterTimestamp to trace poll calls (dedup via filter)", async () => {
    listTraceLogsSpy
      .mockResolvedValueOnce(sampleTraceLogs)
      .mockResolvedValueOnce([]);
    resolveOrgSpy.mockResolvedValue({ org: ORG });

    const { context } = createMockContext();
    const func = await listCommand.loader();

    const promise = func.call(context, traceFollowFlags);
    // Wait for initial fetch + poll timer (1s) + poll execution
    await Bun.sleep(1200);
    sigint.trigger();
    await promise;

    // Poll call (index 1) should NOT have afterTimestamp
    // (trace-logs endpoint doesn't support it)
    const pollCall = listTraceLogsSpy.mock.calls[1];
    expect(pollCall).toBeDefined();
    expect(pollCall[2].afterTimestamp).toBeUndefined();
    expect(pollCall[2].statsPeriod).toBe("10m");
  });

  test("handles empty initial fetch then new logs in poll", async () => {
    // Initial: empty, poll: new logs
    listTraceLogsSpy
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(newerTraceLogs);
    resolveOrgSpy.mockResolvedValue({ org: ORG });

    const { context, stdoutWrite } = createMockContext();
    const func = await listCommand.loader();

    const promise = func.call(context, traceFollowFlags);
    // Wait for initial fetch + poll timer (1s) + poll execution
    await Bun.sleep(1200);
    sigint.trigger();
    await promise;

    const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("New poll result");
  });
});
