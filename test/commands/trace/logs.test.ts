/**
 * Trace Logs Command Tests
 *
 * Tests for positional argument parsing and the command func() body
 * in src/commands/trace/logs.ts.
 *
 * Uses spyOn mocking to avoid real HTTP calls or database access.
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
  logsCommand,
  parsePositionalArgs,
} from "../../../src/commands/trace/logs.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as apiClient from "../../../src/lib/api-client.js";
import { ContextError, ValidationError } from "../../../src/lib/errors.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as resolveTarget from "../../../src/lib/resolve-target.js";
import type { TraceLog } from "../../../src/types/sentry.js";

// ============================================================================
// parsePositionalArgs
// ============================================================================

const VALID_TRACE_ID = "aaaa1111bbbb2222cccc3333dddd4444";

describe("parsePositionalArgs", () => {
  describe("no arguments", () => {
    test("throws ContextError when called with empty args", () => {
      expect(() => parsePositionalArgs([])).toThrow(ContextError);
    });

    test("error mentions 'Trace ID'", () => {
      try {
        parsePositionalArgs([]);
        expect.unreachable("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(ContextError);
        expect((error as ContextError).message).toContain("Trace ID");
      }
    });
  });

  describe("single argument — plain trace ID", () => {
    test("parses 32-char hex trace ID with no org", () => {
      const result = parsePositionalArgs([VALID_TRACE_ID]);
      expect(result.traceId).toBe(VALID_TRACE_ID);
      expect(result.orgArg).toBeUndefined();
    });

    test("accepts mixed-case hex trace ID", () => {
      const mixedCase = "AAAA1111bbbb2222CCCC3333dddd4444";
      const result = parsePositionalArgs([mixedCase]);
      expect(result.traceId).toBe(mixedCase);
      expect(result.orgArg).toBeUndefined();
    });
  });

  describe("single argument — slash-separated org/traceId", () => {
    test("parses 'org/traceId' as org + trace ID", () => {
      const result = parsePositionalArgs([`my-org/${VALID_TRACE_ID}`]);
      expect(result.orgArg).toBe("my-org");
      expect(result.traceId).toBe(VALID_TRACE_ID);
    });

    test("throws ContextError when trace ID is missing after slash", () => {
      expect(() => parsePositionalArgs(["my-org/"])).toThrow(ContextError);
    });

    test("throws ContextError when org is missing before slash", () => {
      expect(() => parsePositionalArgs([`/${VALID_TRACE_ID}`])).toThrow(
        ContextError
      );
    });
  });

  describe("two arguments — space-separated org and trace ID", () => {
    test("parses org and trace ID from two args", () => {
      const result = parsePositionalArgs(["my-org", VALID_TRACE_ID]);
      expect(result.orgArg).toBe("my-org");
      expect(result.traceId).toBe(VALID_TRACE_ID);
    });

    test("uses first arg as org and second as trace ID", () => {
      const result = parsePositionalArgs(["acme-corp", VALID_TRACE_ID]);
      expect(result.orgArg).toBe("acme-corp");
      expect(result.traceId).toBe(VALID_TRACE_ID);
    });
  });

  describe("trace ID validation", () => {
    test("throws ValidationError for non-hex trace ID", () => {
      expect(() => parsePositionalArgs(["not-a-valid-trace-id"])).toThrow(
        ValidationError
      );
    });

    test("throws ValidationError for trace ID shorter than 32 chars", () => {
      expect(() => parsePositionalArgs(["abc123"])).toThrow(ValidationError);
    });

    test("throws ValidationError for trace ID longer than 32 chars", () => {
      expect(() => parsePositionalArgs([`${VALID_TRACE_ID}extra`])).toThrow(
        ValidationError
      );
    });

    test("throws ValidationError for trace ID with non-hex chars", () => {
      expect(() =>
        parsePositionalArgs(["aaaa1111bbbb2222cccc3333ddddgggg"])
      ).toThrow(ValidationError);
    });

    test("ValidationError mentions the invalid trace ID", () => {
      try {
        parsePositionalArgs(["short-id"]);
        expect.unreachable("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationError);
        expect((error as ValidationError).message).toContain("short-id");
      }
    });

    test("validates trace ID in two-arg form as well", () => {
      expect(() => parsePositionalArgs(["my-org", "not-valid-trace"])).toThrow(
        ValidationError
      );
    });

    test("validates trace ID in slash-separated form", () => {
      expect(() => parsePositionalArgs(["my-org/short-id"])).toThrow(
        ValidationError
      );
    });
  });
});

// ============================================================================
// logsCommand.func()
// ============================================================================

const TRACE_ID = "aaaa1111bbbb2222cccc3333dddd4444";
const ORG = "test-org";

const sampleLogs: TraceLog[] = [
  {
    id: "log001",
    "project.id": 1,
    trace: TRACE_ID,
    severity_number: 9,
    severity: "info",
    timestamp: "2025-01-30T14:32:15+00:00",
    timestamp_precise: "2025-01-30T14:32:15.123456+00:00",
    message: "Request received",
  },
  {
    id: "log002",
    "project.id": 1,
    trace: TRACE_ID,
    severity_number: 13,
    severity: "warn",
    timestamp: "2025-01-30T14:32:16+00:00",
    timestamp_precise: "2025-01-30T14:32:16.456789+00:00",
    message: "Slow query detected",
  },
  {
    id: "log003",
    "project.id": 1,
    trace: TRACE_ID,
    severity_number: 17,
    severity: "error",
    timestamp: "2025-01-30T14:32:17+00:00",
    timestamp_precise: "2025-01-30T14:32:17.789012+00:00",
    message: "Database connection failed",
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

describe("logsCommand.func", () => {
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

  describe("JSON output mode", () => {
    test("outputs JSON array when --json flag is set", async () => {
      listTraceLogsSpy.mockResolvedValue(sampleLogs);
      resolveOrgSpy.mockResolvedValue({ org: ORG });

      const { context, stdoutWrite } = createMockContext();
      const func = await logsCommand.loader();
      await func.call(
        context,
        { json: true, web: false, period: "14d", limit: 100 },
        TRACE_ID
      );

      const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
      const parsed = JSON.parse(output);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed).toHaveLength(3);
      expect(parsed[0].id).toBe("log001");
    });

    test("outputs empty JSON array when no logs found with --json", async () => {
      listTraceLogsSpy.mockResolvedValue([]);
      resolveOrgSpy.mockResolvedValue({ org: ORG });

      const { context, stdoutWrite } = createMockContext();
      const func = await logsCommand.loader();
      await func.call(
        context,
        { json: true, web: false, period: "14d", limit: 100 },
        TRACE_ID
      );

      const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
      expect(JSON.parse(output)).toEqual([]);
    });
  });

  describe("human-readable output mode", () => {
    test("shows message about no logs when empty", async () => {
      listTraceLogsSpy.mockResolvedValue([]);
      resolveOrgSpy.mockResolvedValue({ org: ORG });

      const { context, stdoutWrite } = createMockContext();
      const func = await logsCommand.loader();
      await func.call(
        context,
        { json: false, web: false, period: "14d", limit: 100 },
        TRACE_ID
      );

      const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
      expect(output).toContain("No logs found");
      expect(output).toContain(TRACE_ID);
    });

    test("includes period in empty result message", async () => {
      listTraceLogsSpy.mockResolvedValue([]);
      resolveOrgSpy.mockResolvedValue({ org: ORG });

      const { context, stdoutWrite } = createMockContext();
      const func = await logsCommand.loader();
      await func.call(
        context,
        { json: false, web: false, period: "30d", limit: 100 },
        TRACE_ID
      );

      const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
      expect(output).toContain("30d");
    });

    test("renders log messages in output", async () => {
      listTraceLogsSpy.mockResolvedValue(sampleLogs);
      resolveOrgSpy.mockResolvedValue({ org: ORG });

      const { context, stdoutWrite } = createMockContext();
      const func = await logsCommand.loader();
      await func.call(
        context,
        { json: false, web: false, period: "14d", limit: 100 },
        TRACE_ID
      );

      const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
      expect(output).toContain("Request received");
      expect(output).toContain("Slow query detected");
      expect(output).toContain("Database connection failed");
    });

    test("shows count footer", async () => {
      listTraceLogsSpy.mockResolvedValue(sampleLogs);
      resolveOrgSpy.mockResolvedValue({ org: ORG });

      const { context, stdoutWrite } = createMockContext();
      const func = await logsCommand.loader();
      await func.call(
        context,
        { json: false, web: false, period: "14d", limit: 100 },
        TRACE_ID
      );

      const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
      expect(output).toContain("Showing 3 logs");
      expect(output).toContain(TRACE_ID);
    });

    test("uses singular 'log' for exactly one result", async () => {
      listTraceLogsSpy.mockResolvedValue([sampleLogs[0]]);
      resolveOrgSpy.mockResolvedValue({ org: ORG });

      const { context, stdoutWrite } = createMockContext();
      const func = await logsCommand.loader();
      await func.call(
        context,
        { json: false, web: false, period: "14d", limit: 100 },
        TRACE_ID
      );

      const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
      expect(output).toContain("Showing 1 log for trace");
      expect(output).not.toContain("Showing 1 logs");
    });

    test("shows --limit tip when results match limit", async () => {
      listTraceLogsSpy.mockResolvedValue(sampleLogs);
      resolveOrgSpy.mockResolvedValue({ org: ORG });

      const { context, stdoutWrite } = createMockContext();
      const func = await logsCommand.loader();
      await func.call(
        context,
        // limit equals number of returned logs → hasMore = true
        { json: false, web: false, period: "14d", limit: 3 },
        TRACE_ID
      );

      const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
      expect(output).toContain("Use --limit to show more.");
    });

    test("does not show --limit tip when fewer results than limit", async () => {
      listTraceLogsSpy.mockResolvedValue(sampleLogs);
      resolveOrgSpy.mockResolvedValue({ org: ORG });

      const { context, stdoutWrite } = createMockContext();
      const func = await logsCommand.loader();
      await func.call(
        context,
        { json: false, web: false, period: "14d", limit: 100 },
        TRACE_ID
      );

      const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
      expect(output).not.toContain("Use --limit to show more.");
    });
  });

  describe("org resolution", () => {
    test("uses explicit org from first positional arg", async () => {
      listTraceLogsSpy.mockResolvedValue([]);
      resolveOrgSpy.mockResolvedValue({ org: ORG });

      const { context } = createMockContext();
      const func = await logsCommand.loader();
      await func.call(
        context,
        { json: true, web: false, period: "14d", limit: 100 },
        ORG,
        TRACE_ID
      );

      expect(resolveOrgSpy).toHaveBeenCalledWith({
        org: ORG,
        cwd: "/tmp",
      });
    });

    test("passes undefined org when only trace ID given", async () => {
      listTraceLogsSpy.mockResolvedValue([]);
      resolveOrgSpy.mockResolvedValue({ org: ORG });

      const { context } = createMockContext();
      const func = await logsCommand.loader();
      await func.call(
        context,
        { json: true, web: false, period: "14d", limit: 100 },
        TRACE_ID
      );

      expect(resolveOrgSpy).toHaveBeenCalledWith({
        org: undefined,
        cwd: "/tmp",
      });
    });

    test("throws ContextError when org cannot be resolved", async () => {
      resolveOrgSpy.mockResolvedValue(null);

      const { context } = createMockContext();
      const func = await logsCommand.loader();

      await expect(
        func.call(
          context,
          { json: false, web: false, period: "14d", limit: 100 },
          TRACE_ID
        )
      ).rejects.toThrow(ContextError);
    });

    test("calls setContext with resolved org and empty project array", async () => {
      listTraceLogsSpy.mockResolvedValue([]);
      resolveOrgSpy.mockResolvedValue({ org: ORG });

      const { context } = createMockContext();
      const func = await logsCommand.loader();
      await func.call(
        context,
        { json: true, web: false, period: "14d", limit: 100 },
        TRACE_ID
      );

      expect(context.setContext).toHaveBeenCalledWith([ORG], []);
    });
  });

  describe("flag forwarding to API", () => {
    test("passes traceId, period, limit, and query to listTraceLogs", async () => {
      listTraceLogsSpy.mockResolvedValue([]);
      resolveOrgSpy.mockResolvedValue({ org: ORG });

      const { context } = createMockContext();
      const func = await logsCommand.loader();
      await func.call(
        context,
        {
          json: false,
          web: false,
          period: "7d",
          limit: 50,
          query: "level:error",
        },
        TRACE_ID
      );

      expect(listTraceLogsSpy).toHaveBeenCalledWith(ORG, TRACE_ID, {
        statsPeriod: "7d",
        limit: 50,
        query: "level:error",
      });
    });

    test("passes undefined query when --query not provided", async () => {
      listTraceLogsSpy.mockResolvedValue([]);
      resolveOrgSpy.mockResolvedValue({ org: ORG });

      const { context } = createMockContext();
      const func = await logsCommand.loader();
      await func.call(
        context,
        { json: false, web: false, period: "14d", limit: 100 },
        TRACE_ID
      );

      expect(listTraceLogsSpy).toHaveBeenCalledWith(ORG, TRACE_ID, {
        statsPeriod: "14d",
        limit: 100,
        query: undefined,
      });
    });
  });

  describe("--web flag", () => {
    test("does not call listTraceLogs when --web is set", async () => {
      resolveOrgSpy.mockResolvedValue({ org: ORG });

      const { context } = createMockContext();
      const func = await logsCommand.loader();
      // --web would call openInBrowser which needs a real browser; catch any error
      try {
        await func.call(
          context,
          { json: false, web: true, period: "14d", limit: 100 },
          TRACE_ID
        );
      } catch {
        // openInBrowser may throw in test environment — that's OK
      }

      expect(listTraceLogsSpy).not.toHaveBeenCalled();
    });
  });

  describe("chronological ordering", () => {
    test("reverses API order (API returns newest-first, display is oldest-first)", async () => {
      // API returns newest first: log003, log002, log001
      const newestFirst = [...sampleLogs].reverse();
      listTraceLogsSpy.mockResolvedValue(newestFirst);
      resolveOrgSpy.mockResolvedValue({ org: ORG });

      const { context, stdoutWrite } = createMockContext();
      const func = await logsCommand.loader();
      await func.call(
        context,
        { json: false, web: false, period: "14d", limit: 100 },
        TRACE_ID
      );

      const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
      // All three messages should appear in the output
      const reqIdx = output.indexOf("Request received");
      const slowIdx = output.indexOf("Slow query detected");
      const dbIdx = output.indexOf("Database connection failed");

      // After reversal, oldest (Request received) should appear before newest
      expect(reqIdx).toBeLessThan(dbIdx);
      expect(slowIdx).toBeLessThan(dbIdx);
    });
  });
});
