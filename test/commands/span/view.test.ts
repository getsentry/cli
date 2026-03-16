/**
 * Span View Command Tests
 *
 * Tests for positional argument parsing, span ID validation,
 * and output formatting in src/commands/span/view.ts.
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
  parsePositionalArgs,
  validateSpanId,
  viewCommand,
} from "../../../src/commands/span/view.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as apiClient from "../../../src/lib/api-client.js";
import { ContextError, ValidationError } from "../../../src/lib/errors.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as resolveTarget from "../../../src/lib/resolve-target.js";

const VALID_TRACE_ID = "aaaa1111bbbb2222cccc3333dddd4444";
const VALID_SPAN_ID = "a1b2c3d4e5f67890";
const VALID_SPAN_ID_2 = "1234567890abcdef";

describe("validateSpanId", () => {
  test("accepts valid 16-char lowercase hex", () => {
    expect(validateSpanId("a1b2c3d4e5f67890")).toBe("a1b2c3d4e5f67890");
  });

  test("normalizes uppercase to lowercase", () => {
    expect(validateSpanId("A1B2C3D4E5F67890")).toBe("a1b2c3d4e5f67890");
  });

  test("trims whitespace", () => {
    expect(validateSpanId("  a1b2c3d4e5f67890  ")).toBe("a1b2c3d4e5f67890");
  });

  test("throws for non-hex characters", () => {
    expect(() => validateSpanId("g1b2c3d4e5f67890")).toThrow(ValidationError);
  });

  test("throws for too short", () => {
    expect(() => validateSpanId("a1b2c3d4")).toThrow(ValidationError);
  });

  test("throws for too long", () => {
    expect(() => validateSpanId("a1b2c3d4e5f678901234")).toThrow(
      ValidationError
    );
  });

  test("throws for empty string", () => {
    expect(() => validateSpanId("")).toThrow(ValidationError);
  });

  test("error message includes the invalid value", () => {
    try {
      validateSpanId("bad");
      expect.unreachable("Should have thrown");
    } catch (error) {
      expect((error as ValidationError).message).toContain("bad");
    }
  });
});

describe("parsePositionalArgs", () => {
  describe("trace-id + single span-id", () => {
    test("parses trace ID and span ID as two positional args", () => {
      const result = parsePositionalArgs([VALID_TRACE_ID, VALID_SPAN_ID]);
      expect(result.traceId).toBe(VALID_TRACE_ID);
      expect(result.spanIds).toEqual([VALID_SPAN_ID]);
      expect(result.targetArg).toBeUndefined();
    });
  });

  describe("trace-id + multiple span-ids", () => {
    test("parses trace ID and multiple span IDs", () => {
      const result = parsePositionalArgs([
        VALID_TRACE_ID,
        VALID_SPAN_ID,
        VALID_SPAN_ID_2,
      ]);
      expect(result.traceId).toBe(VALID_TRACE_ID);
      expect(result.spanIds).toEqual([VALID_SPAN_ID, VALID_SPAN_ID_2]);
      expect(result.targetArg).toBeUndefined();
    });
  });

  describe("org/project/trace-id + span-id", () => {
    test("parses slash-separated target with trace ID", () => {
      const result = parsePositionalArgs([
        `my-org/my-project/${VALID_TRACE_ID}`,
        VALID_SPAN_ID,
      ]);
      expect(result.traceId).toBe(VALID_TRACE_ID);
      expect(result.spanIds).toEqual([VALID_SPAN_ID]);
      expect(result.targetArg).toBe("my-org/my-project");
    });

    test("parses slash-separated target with multiple span IDs", () => {
      const result = parsePositionalArgs([
        `my-org/my-project/${VALID_TRACE_ID}`,
        VALID_SPAN_ID,
        VALID_SPAN_ID_2,
      ]);
      expect(result.traceId).toBe(VALID_TRACE_ID);
      expect(result.spanIds).toEqual([VALID_SPAN_ID, VALID_SPAN_ID_2]);
      expect(result.targetArg).toBe("my-org/my-project");
    });
  });

  describe("error cases", () => {
    test("throws ContextError for empty args", () => {
      expect(() => parsePositionalArgs([])).toThrow(ContextError);
    });

    test("error message mentions trace ID and span ID", () => {
      try {
        parsePositionalArgs([]);
        expect.unreachable("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(ContextError);
        expect((error as ContextError).message).toContain("Trace ID");
      }
    });

    test("throws ContextError when only trace ID provided (no span IDs)", () => {
      expect(() => parsePositionalArgs([VALID_TRACE_ID])).toThrow(ContextError);
    });

    test("missing span IDs error suggests span list", () => {
      try {
        parsePositionalArgs([VALID_TRACE_ID]);
        expect.unreachable("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(ContextError);
        expect((error as ContextError).message).toContain("span list");
      }
    });

    test("throws ValidationError for invalid trace ID", () => {
      expect(() => parsePositionalArgs(["not-valid", VALID_SPAN_ID])).toThrow(
        ValidationError
      );
    });

    test("throws ValidationError for invalid span ID", () => {
      expect(() =>
        parsePositionalArgs([VALID_TRACE_ID, "not-a-span-id"])
      ).toThrow(ValidationError);
    });

    test("throws ValidationError for span ID that is too short", () => {
      expect(() => parsePositionalArgs([VALID_TRACE_ID, "abcd1234"])).toThrow(
        ValidationError
      );
    });
  });
});

// ---------------------------------------------------------------------------
// viewCommand.func — tests the command body with mocked APIs
// ---------------------------------------------------------------------------

type ViewFunc = (
  this: unknown,
  flags: Record<string, unknown>,
  ...args: string[]
) => Promise<void>;

/** Minimal trace span tree for testing */
function makeTraceSpan(spanId: string, children: unknown[] = []): unknown {
  return {
    span_id: spanId,
    parent_span_id: null,
    op: "http.server",
    description: "GET /api",
    start_timestamp: 1_700_000_000,
    timestamp: 1_700_000_001,
    duration: 1000,
    project_slug: "test-project",
    transaction: "GET /api",
    children,
  };
}

describe("viewCommand.func", () => {
  let func: ViewFunc;
  let getDetailedTraceSpy: ReturnType<typeof spyOn>;
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
    func = (await viewCommand.loader()) as unknown as ViewFunc;
    getDetailedTraceSpy = spyOn(apiClient, "getDetailedTrace");
    resolveOrgAndProjectSpy = spyOn(resolveTarget, "resolveOrgAndProject");
    resolveOrgAndProjectSpy.mockResolvedValue({
      org: "test-org",
      project: "test-project",
    });
  });

  afterEach(() => {
    getDetailedTraceSpy.mockRestore();
    resolveOrgAndProjectSpy.mockRestore();
  });

  test("renders span details for a found span", async () => {
    getDetailedTraceSpy.mockResolvedValue([makeTraceSpan(VALID_SPAN_ID)]);

    const { context, getStdout } = createContext();

    await func.call(
      context,
      {
        spans: 3,
        fresh: false,
      },
      VALID_TRACE_ID,
      VALID_SPAN_ID
    );

    const output = getStdout();
    expect(output).toContain(VALID_SPAN_ID);
    expect(output).toContain("http.server");
  });

  test("throws ValidationError when trace has no spans", async () => {
    getDetailedTraceSpy.mockResolvedValue([]);

    const { context } = createContext();

    await expect(
      func.call(
        context,
        {
          spans: 3,
          fresh: false,
        },
        VALID_TRACE_ID,
        VALID_SPAN_ID
      )
    ).rejects.toThrow(ValidationError);
  });

  test("throws ValidationError when span ID not found in trace", async () => {
    getDetailedTraceSpy.mockResolvedValue([makeTraceSpan("0000000000000000")]);

    const { context } = createContext();

    await expect(
      func.call(
        context,
        {
          spans: 3,
          fresh: false,
        },
        VALID_TRACE_ID,
        VALID_SPAN_ID
      )
    ).rejects.toThrow(ValidationError);
  });

  test("uses explicit org/project from slash-separated arg", async () => {
    getDetailedTraceSpy.mockResolvedValue([makeTraceSpan(VALID_SPAN_ID)]);

    const { context } = createContext();

    await func.call(
      context,
      {
        spans: 0,
        fresh: false,
      },
      `my-org/my-project/${VALID_TRACE_ID}`,
      VALID_SPAN_ID
    );

    expect(getDetailedTraceSpy).toHaveBeenCalledWith(
      "my-org",
      VALID_TRACE_ID,
      expect.any(Number)
    );
    expect(resolveOrgAndProjectSpy).not.toHaveBeenCalled();
  });

  test("renders multiple spans with partial matches", async () => {
    const FOUND_SPAN = "aaaa111122223333";
    const MISSING_SPAN = "bbbb444455556666";
    getDetailedTraceSpy.mockResolvedValue([makeTraceSpan(FOUND_SPAN)]);

    const { context, getStdout } = createContext();

    // One span found, one missing — should render the found one and warn about the missing one
    await func.call(
      context,
      { spans: 0, fresh: false },
      VALID_TRACE_ID,
      FOUND_SPAN,
      MISSING_SPAN
    );

    const output = getStdout();
    expect(output).toContain(FOUND_SPAN);
  });

  test("renders span with child tree when --spans > 0", async () => {
    const childSpan = makeTraceSpan("childspan1234567");
    getDetailedTraceSpy.mockResolvedValue([
      makeTraceSpan(VALID_SPAN_ID, [childSpan]),
    ]);

    const { context, getStdout } = createContext();

    await func.call(
      context,
      { spans: 3, fresh: false },
      VALID_TRACE_ID,
      VALID_SPAN_ID
    );

    const output = getStdout();
    expect(output).toContain(VALID_SPAN_ID);
    // Span tree should include child info
    expect(output).toContain("Span Tree");
  });

  test("outputs JSON when --json flag is set", async () => {
    getDetailedTraceSpy.mockResolvedValue([makeTraceSpan(VALID_SPAN_ID)]);

    const { context, getStdout } = createContext();

    await func.call(
      context,
      { spans: 0, fresh: false, json: true },
      VALID_TRACE_ID,
      VALID_SPAN_ID
    );

    const output = getStdout();
    const parsed = JSON.parse(output);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0].span_id).toBe(VALID_SPAN_ID);
    expect(parsed[0].trace_id).toBe(VALID_TRACE_ID);
    expect(parsed[0].duration).toBeDefined();
    expect(parsed[0].ancestors).toEqual([]);
  });

  test("throws ContextError for org-all target (org/ without project)", async () => {
    const { context } = createContext();

    // "my-org/" is parsed as org-all mode which is not supported for span view
    await expect(
      func.call(
        context,
        { spans: 0, fresh: false },
        `my-org/my-project/${VALID_TRACE_ID}`
        // No span IDs — but we need at least one
      )
    ).rejects.toThrow(ContextError);
  });

  test("throws ValidationError for multiple missing span IDs", async () => {
    getDetailedTraceSpy.mockResolvedValue([makeTraceSpan("0000000000000000")]);

    const { context } = createContext();

    await expect(
      func.call(
        context,
        { spans: 0, fresh: false },
        VALID_TRACE_ID,
        VALID_SPAN_ID,
        VALID_SPAN_ID_2
      )
    ).rejects.toThrow(ValidationError);
  });
});
