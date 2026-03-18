/**
 * Span List Command Tests
 *
 * Tests for positional argument parsing, sort flag parsing,
 * and the command func body in src/commands/span/list.ts.
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
import { listCommand, parseSort } from "../../../src/commands/span/list.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as apiClient from "../../../src/lib/api-client.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as resolveTarget from "../../../src/lib/resolve-target.js";

const VALID_TRACE_ID = "aaaa1111bbbb2222cccc3333dddd4444";

// Note: parseTraceTarget parsing tests are in test/lib/trace-target.test.ts

describe("parseSort", () => {
  test("accepts 'date'", () => {
    expect(parseSort("date")).toBe("date");
  });

  test("accepts 'duration'", () => {
    expect(parseSort("duration")).toBe("duration");
  });

  test("rejects 'time' (use 'date' instead)", () => {
    expect(() => parseSort("time")).toThrow("Invalid sort value");
  });

  test("throws for invalid value", () => {
    expect(() => parseSort("name")).toThrow("Invalid sort value");
  });

  test("throws for empty string", () => {
    expect(() => parseSort("")).toThrow("Invalid sort value");
  });
});

// ---------------------------------------------------------------------------
// listCommand.func — tests the command body with mocked APIs
// ---------------------------------------------------------------------------

type ListFunc = (
  this: unknown,
  flags: Record<string, unknown>,
  ...args: string[]
) => Promise<void>;

describe("listCommand.func", () => {
  let func: ListFunc;
  let listSpansSpy: ReturnType<typeof spyOn>;
  let resolveOrgAndProjectSpy: ReturnType<typeof spyOn>;

  function createContext() {
    const stdoutChunks: string[] = [];
    return {
      context: {
        stdout: {
          write: mock((s: string) => {
            stdoutChunks.push(s);
          }),
        },
        stderr: {
          write: mock((_s: string) => {
            /* no-op */
          }),
        },
        cwd: "/tmp/test-project",
        setContext: mock((_orgs: string[], _projects: string[]) => {
          /* no-op */
        }),
      },
      getStdout: () => stdoutChunks.join(""),
    };
  }

  beforeEach(async () => {
    func = (await listCommand.loader()) as unknown as ListFunc;
    listSpansSpy = spyOn(apiClient, "listSpans");
    resolveOrgAndProjectSpy = spyOn(resolveTarget, "resolveOrgAndProject");
    resolveOrgAndProjectSpy.mockResolvedValue({
      org: "test-org",
      project: "test-project",
    });
  });

  afterEach(() => {
    listSpansSpy.mockRestore();
    resolveOrgAndProjectSpy.mockRestore();
  });

  test("calls listSpans with trace ID in query", async () => {
    listSpansSpy.mockResolvedValue({
      data: [
        {
          id: "a1b2c3d4e5f67890",
          "span.op": "http.client",
          description: "GET /api",
          "span.duration": 123,
          timestamp: "2024-01-15T10:30:00+00:00",
          project: "test-project",
          trace: VALID_TRACE_ID,
        },
      ],
      nextCursor: undefined,
    });

    const { context, getStdout } = createContext();

    await func.call(
      context,
      {
        limit: 25,
        sort: "date",
        fresh: false,
      },
      VALID_TRACE_ID
    );

    expect(listSpansSpy).toHaveBeenCalledWith(
      "test-org",
      "test-project",
      expect.objectContaining({
        query: `trace:${VALID_TRACE_ID}`,
      })
    );

    // Output should contain the span data (rendered by wrapper)
    const output = getStdout();
    expect(output).toContain("a1b2c3d4e5f67890");
  });

  test("translates query shorthand when --query is set", async () => {
    listSpansSpy.mockResolvedValue({ data: [], nextCursor: undefined });

    const { context } = createContext();

    await func.call(
      context,
      {
        limit: 25,
        query: "op:db",
        sort: "date",
        fresh: false,
      },
      VALID_TRACE_ID
    );

    expect(listSpansSpy).toHaveBeenCalledWith(
      "test-org",
      "test-project",
      expect.objectContaining({
        query: `trace:${VALID_TRACE_ID} span.op:db`,
      })
    );
  });

  test("uses explicit org/project when target is provided", async () => {
    listSpansSpy.mockResolvedValue({ data: [], nextCursor: undefined });

    const { context } = createContext();

    await func.call(
      context,
      {
        limit: 25,
        sort: "date",
        fresh: false,
      },
      `my-org/my-project/${VALID_TRACE_ID}`
    );

    expect(listSpansSpy).toHaveBeenCalledWith(
      "my-org",
      "my-project",
      expect.anything()
    );
    // Should NOT have called resolveOrgAndProject
    expect(resolveOrgAndProjectSpy).not.toHaveBeenCalled();
  });

  test("passes cursor to API when --cursor is set", async () => {
    listSpansSpy.mockResolvedValue({
      data: [
        {
          id: "a1b2c3d4e5f67890",
          timestamp: "2024-01-15T10:30:00+00:00",
          project: "test-project",
          trace: VALID_TRACE_ID,
        },
      ],
      nextCursor: undefined,
    });

    const { context } = createContext();

    await func.call(
      context,
      {
        limit: 25,
        sort: "date",
        cursor: "1735689600:0:0",
        fresh: false,
      },
      VALID_TRACE_ID
    );

    expect(listSpansSpy).toHaveBeenCalledWith(
      "test-org",
      "test-project",
      expect.objectContaining({
        cursor: "1735689600:0:0",
      })
    );
  });

  test("includes nextCursor in JSON output when hasMore", async () => {
    listSpansSpy.mockResolvedValue({
      data: [
        {
          id: "a1b2c3d4e5f67890",
          timestamp: "2024-01-15T10:30:00+00:00",
          project: "test-project",
          trace: VALID_TRACE_ID,
        },
      ],
      nextCursor: "1735689600:0:1",
    });

    const { context, getStdout } = createContext();

    await func.call(
      context,
      {
        limit: 1,
        sort: "date",
        json: true,
        fresh: false,
      },
      VALID_TRACE_ID
    );

    const output = getStdout();
    const parsed = JSON.parse(output);
    expect(parsed.hasMore).toBe(true);
    expect(parsed.nextCursor).toBe("1735689600:0:1");
  });

  test("hint shows -c last when more pages available", async () => {
    listSpansSpy.mockResolvedValue({
      data: [
        {
          id: "a1b2c3d4e5f67890",
          timestamp: "2024-01-15T10:30:00+00:00",
          project: "test-project",
          trace: VALID_TRACE_ID,
        },
      ],
      nextCursor: "1735689600:0:1",
    });

    const { context, getStdout } = createContext();

    await func.call(
      context,
      {
        limit: 1,
        sort: "date",
        fresh: false,
      },
      VALID_TRACE_ID
    );

    const output = getStdout();
    expect(output).toContain("-c last");
  });
});
