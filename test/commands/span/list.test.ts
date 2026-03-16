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
import {
  listCommand,
  parsePositionalArgs,
  parseSort,
} from "../../../src/commands/span/list.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as apiClient from "../../../src/lib/api-client.js";
import { ContextError, ValidationError } from "../../../src/lib/errors.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as resolveTarget from "../../../src/lib/resolve-target.js";

const VALID_TRACE_ID = "aaaa1111bbbb2222cccc3333dddd4444";

describe("parsePositionalArgs", () => {
  describe("single argument (trace ID only)", () => {
    test("parses plain trace ID", () => {
      const result = parsePositionalArgs([VALID_TRACE_ID]);
      expect(result.traceId).toBe(VALID_TRACE_ID);
      expect(result.targetArg).toBeUndefined();
    });

    test("normalizes uppercase trace ID", () => {
      const result = parsePositionalArgs(["AAAA1111BBBB2222CCCC3333DDDD4444"]);
      expect(result.traceId).toBe(VALID_TRACE_ID);
    });

    test("strips dashes from UUID-format input", () => {
      const result = parsePositionalArgs([
        "aaaa1111-bbbb-2222-cccc-3333dddd4444",
      ]);
      expect(result.traceId).toBe(VALID_TRACE_ID);
    });
  });

  describe("slash-separated argument (org/project/trace-id)", () => {
    test("parses org/project/trace-id format", () => {
      const result = parsePositionalArgs([
        `my-org/my-project/${VALID_TRACE_ID}`,
      ]);
      expect(result.traceId).toBe(VALID_TRACE_ID);
      expect(result.targetArg).toBe("my-org/my-project");
    });

    test("single slash (org/project without ID) throws ContextError", () => {
      // "my-project/trace-id" has exactly one slash → parseSlashSeparatedArg
      // treats it as "org/project" without an ID, which throws
      expect(() =>
        parsePositionalArgs([`my-project/${VALID_TRACE_ID}`])
      ).toThrow(ContextError);
    });
  });

  describe("two arguments (target + trace-id)", () => {
    test("parses target and trace ID", () => {
      const result = parsePositionalArgs(["my-org/frontend", VALID_TRACE_ID]);
      expect(result.targetArg).toBe("my-org/frontend");
      expect(result.traceId).toBe(VALID_TRACE_ID);
    });

    test("parses project-only target", () => {
      const result = parsePositionalArgs(["frontend", VALID_TRACE_ID]);
      expect(result.targetArg).toBe("frontend");
      expect(result.traceId).toBe(VALID_TRACE_ID);
    });
  });

  describe("error cases", () => {
    test("throws ContextError for empty args", () => {
      expect(() => parsePositionalArgs([])).toThrow(ContextError);
    });

    test("throws ValidationError for invalid trace ID", () => {
      expect(() => parsePositionalArgs(["not-a-trace-id"])).toThrow(
        ValidationError
      );
    });

    test("throws ValidationError for short hex", () => {
      expect(() => parsePositionalArgs(["aabbccdd"])).toThrow(ValidationError);
    });
  });
});

describe("parseSort", () => {
  test("accepts 'time'", () => {
    expect(parseSort("time")).toBe("time");
  });

  test("accepts 'duration'", () => {
    expect(parseSort("duration")).toBe("duration");
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
        sort: "time",
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
        sort: "time",
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
        sort: "time",
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
});
