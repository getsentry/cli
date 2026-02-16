/**
 * Telemetry Module Tests
 *
 * Tests for withTelemetry wrapper and opt-out behavior.
 */

import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as Sentry from "@sentry/bun";
import { ApiError, AuthError } from "../../src/lib/errors.js";
import {
  createTracedDatabase,
  initSentry,
  isClientApiError,
  recordApiErrorOnSpan,
  setArgsContext,
  setCommandSpanName,
  setFlagContext,
  setOrgProjectContext,
  withDbSpan,
  withFsSpan,
  withHttpSpan,
  withSerializeSpan,
  withTelemetry,
  withTracing,
  withTracingSpan,
} from "../../src/lib/telemetry.js";

describe("initSentry", () => {
  test("returns client with enabled=false when disabled", () => {
    const client = initSentry(false);
    expect(client?.getOptions().enabled).toBe(false);
  });

  test("returns client with DSN when enabled", () => {
    const client = initSentry(true);
    expect(client?.getOptions().dsn).toBeDefined();
    expect(client?.getOptions().enabled).toBe(true);
  });

  test("uses process.env.NODE_ENV for environment", () => {
    const client = initSentry(true);
    expect(client?.getOptions().environment).toBe(
      process.env.NODE_ENV ?? "development"
    );
  });

  test("uses 0.0.0-dev version when SENTRY_CLI_VERSION is not defined", () => {
    const client = initSentry(true);
    expect(client?.getOptions().release).toBe("0.0.0-dev");
  });
});

describe("withTelemetry", () => {
  const ENV_VAR = "SENTRY_CLI_NO_TELEMETRY";
  let originalEnvValue: string | undefined;

  beforeEach(() => {
    originalEnvValue = process.env[ENV_VAR];
  });

  afterEach(() => {
    if (originalEnvValue === undefined) {
      delete process.env[ENV_VAR];
    } else {
      process.env[ENV_VAR] = originalEnvValue;
    }
  });

  test("executes callback and returns result", async () => {
    const result = await withTelemetry(() => 42);
    expect(result).toBe(42);
  });

  test("handles async callbacks", async () => {
    const result = await withTelemetry(async () => {
      await Bun.sleep(1);
      return "async result";
    });
    expect(result).toBe("async result");
  });

  test("propagates errors from callback", async () => {
    await expect(
      withTelemetry(() => {
        throw new Error("test error");
      })
    ).rejects.toThrow("test error");
  });

  test("propagates async errors", async () => {
    await expect(
      withTelemetry(async () => {
        await Bun.sleep(1);
        throw new Error("async error");
      })
    ).rejects.toThrow("async error");
  });

  test("handles complex return types", async () => {
    const result = await withTelemetry(() => ({
      status: "ok",
      count: 42,
      items: [1, 2, 3],
    }));
    expect(result).toEqual({ status: "ok", count: 42, items: [1, 2, 3] });
  });

  test("handles void return value", async () => {
    let sideEffect = false;
    const result = await withTelemetry(() => {
      sideEffect = true;
    });
    expect(result).toBeUndefined();
    expect(sideEffect).toBe(true);
  });

  test("handles null return value", async () => {
    const result = await withTelemetry(() => null);
    expect(result).toBeNull();
  });

  test("respects SENTRY_CLI_NO_TELEMETRY=1 env var", async () => {
    process.env[ENV_VAR] = "1";
    let executed = false;
    await withTelemetry(() => {
      executed = true;
    });
    expect(executed).toBe(true);
  });

  test("propagates 4xx ApiError to caller", async () => {
    const error = new ApiError("Not found", 404, "Issue not found");
    await expect(
      withTelemetry(() => {
        throw error;
      })
    ).rejects.toThrow(error);
  });

  describe("with telemetry enabled", () => {
    beforeEach(() => {
      delete process.env[ENV_VAR];
    });

    afterEach(() => {
      // Re-init with enabled=false to reset global SDK state.
      // Without this, Sentry.isEnabled() returns true for all
      // subsequent test files (e.g. feedbackCommand checks it).
      initSentry(false);
    });

    test("propagates 4xx ApiError through enabled SDK path", async () => {
      const error = new ApiError("Not found", 404, "Issue not found");
      await expect(
        withTelemetry(() => {
          throw error;
        })
      ).rejects.toThrow(error);
    });

    test("propagates 5xx ApiError through enabled SDK path", async () => {
      const error = new ApiError("Server error", 500, "Internal error");
      await expect(
        withTelemetry(() => {
          throw error;
        })
      ).rejects.toThrow(error);
    });

    test("propagates generic Error through enabled SDK path", async () => {
      await expect(
        withTelemetry(() => {
          throw new Error("unexpected bug");
        })
      ).rejects.toThrow("unexpected bug");
    });

    test("returns result through enabled SDK path", async () => {
      const result = await withTelemetry(() => 42);
      expect(result).toBe(42);
    });
  });
});

describe("isClientApiError", () => {
  test("returns true for 400 Bad Request", () => {
    expect(isClientApiError(new ApiError("Bad request", 400))).toBe(true);
  });

  test("returns true for 403 Forbidden", () => {
    expect(isClientApiError(new ApiError("Forbidden", 403, "No access"))).toBe(
      true
    );
  });

  test("returns true for 404 Not Found", () => {
    expect(
      isClientApiError(new ApiError("Not found", 404, "Issue not found"))
    ).toBe(true);
  });

  test("returns true for 429 Too Many Requests", () => {
    expect(isClientApiError(new ApiError("Rate limited", 429))).toBe(true);
  });

  test("returns false for 500 Internal Server Error", () => {
    expect(isClientApiError(new ApiError("Server error", 500))).toBe(false);
  });

  test("returns false for 502 Bad Gateway", () => {
    expect(isClientApiError(new ApiError("Bad gateway", 502))).toBe(false);
  });

  test("returns false for non-ApiError", () => {
    expect(isClientApiError(new Error("generic error"))).toBe(false);
  });

  test("returns false for AuthError", () => {
    expect(isClientApiError(new AuthError("not_authenticated"))).toBe(false);
  });

  test("returns false for null/undefined", () => {
    expect(isClientApiError(null)).toBe(false);
    expect(isClientApiError(undefined)).toBe(false);
  });

  test("returns false for non-Error objects", () => {
    expect(isClientApiError({ status: 404 })).toBe(false);
    expect(isClientApiError("404")).toBe(false);
  });
});

describe("recordApiErrorOnSpan", () => {
  function createMockSpan() {
    const attributes: Record<string, string | number> = {};
    return {
      attributes,
      setAttribute(key: string, value: string | number) {
        attributes[key] = value;
      },
    };
  }

  test("sets status and message attributes", () => {
    const span = createMockSpan();
    const error = new ApiError("Not found", 404);
    recordApiErrorOnSpan(span as never, error);

    expect(span.attributes["api_error.status"]).toBe(404);
    expect(span.attributes["api_error.message"]).toBe("Not found");
    expect(span.attributes["api_error.detail"]).toBeUndefined();
  });

  test("sets detail attribute when present", () => {
    const span = createMockSpan();
    const error = new ApiError("Not found", 404, "Issue not found");
    recordApiErrorOnSpan(span as never, error);

    expect(span.attributes["api_error.status"]).toBe(404);
    expect(span.attributes["api_error.message"]).toBe("Not found");
    expect(span.attributes["api_error.detail"]).toBe("Issue not found");
  });

  test("omits detail attribute when empty string", () => {
    const span = createMockSpan();
    const error = new ApiError("Bad request", 400, "");
    recordApiErrorOnSpan(span as never, error);

    expect(span.attributes["api_error.status"]).toBe(400);
    expect(span.attributes["api_error.detail"]).toBeUndefined();
  });

  test("handles different 4xx status codes", () => {
    const span = createMockSpan();
    const error = new ApiError("Forbidden", 403, "No access");
    recordApiErrorOnSpan(span as never, error);

    expect(span.attributes["api_error.status"]).toBe(403);
    expect(span.attributes["api_error.message"]).toBe("Forbidden");
    expect(span.attributes["api_error.detail"]).toBe("No access");
  });
});

describe("setCommandSpanName", () => {
  test("handles undefined span gracefully", () => {
    // Should not throw when span is undefined
    expect(() => setCommandSpanName(undefined, "test.command")).not.toThrow();
  });
});

describe("setOrgProjectContext", () => {
  test("handles empty arrays", () => {
    expect(() => setOrgProjectContext([], [])).not.toThrow();
  });

  test("handles single org/project", () => {
    expect(() =>
      setOrgProjectContext(["my-org"], ["my-project"])
    ).not.toThrow();
  });

  test("handles multiple orgs/projects", () => {
    expect(() =>
      setOrgProjectContext(["org1", "org2"], ["proj1", "proj2"])
    ).not.toThrow();
  });
});

describe("setFlagContext", () => {
  let setTagSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    setTagSpy = spyOn(Sentry, "setTag");
  });

  afterEach(() => {
    setTagSpy.mockRestore();
  });

  test("does not set tags for empty flags object", () => {
    setFlagContext({});
    expect(setTagSpy).not.toHaveBeenCalled();
  });

  test("sets tags for boolean flags when true", () => {
    setFlagContext({ verbose: true, debug: true });
    expect(setTagSpy).toHaveBeenCalledTimes(2);
    expect(setTagSpy).toHaveBeenCalledWith("flag.verbose", "true");
    expect(setTagSpy).toHaveBeenCalledWith("flag.debug", "true");
  });

  test("does not set tags for boolean flags when false", () => {
    setFlagContext({ verbose: false, debug: false });
    expect(setTagSpy).not.toHaveBeenCalled();
  });

  test("sets tags for string flags with values", () => {
    setFlagContext({ output: "json", format: "table" });
    expect(setTagSpy).toHaveBeenCalledTimes(2);
    expect(setTagSpy).toHaveBeenCalledWith("flag.output", "json");
    expect(setTagSpy).toHaveBeenCalledWith("flag.format", "table");
  });

  test("sets tags for number flags", () => {
    setFlagContext({ limit: 10, offset: 5 });
    expect(setTagSpy).toHaveBeenCalledTimes(2);
    expect(setTagSpy).toHaveBeenCalledWith("flag.limit", "10");
    expect(setTagSpy).toHaveBeenCalledWith("flag.offset", "5");
  });

  test("does not set tags for undefined or null values", () => {
    setFlagContext({ value: undefined, other: null });
    expect(setTagSpy).not.toHaveBeenCalled();
  });

  test("does not set tags for empty string values", () => {
    setFlagContext({ name: "" });
    expect(setTagSpy).not.toHaveBeenCalled();
  });

  test("does not set tags for empty array values", () => {
    setFlagContext({ items: [] });
    expect(setTagSpy).not.toHaveBeenCalled();
  });

  test("sets tags for non-empty array values", () => {
    setFlagContext({ projects: ["proj1", "proj2"] });
    expect(setTagSpy).toHaveBeenCalledTimes(1);
    expect(setTagSpy).toHaveBeenCalledWith("flag.projects", "proj1,proj2");
  });

  test("only sets tags for meaningful values in mixed flags", () => {
    setFlagContext({
      verbose: true,
      quiet: false,
      limit: 50,
      output: "json",
      projects: ["a", "b"],
      empty: "",
      missing: undefined,
    });
    // Should set: verbose, limit, output, projects (4 tags)
    // Should skip: quiet (false), empty (""), missing (undefined)
    expect(setTagSpy).toHaveBeenCalledTimes(4);
    expect(setTagSpy).toHaveBeenCalledWith("flag.verbose", "true");
    expect(setTagSpy).toHaveBeenCalledWith("flag.limit", "50");
    expect(setTagSpy).toHaveBeenCalledWith("flag.output", "json");
    expect(setTagSpy).toHaveBeenCalledWith("flag.projects", "a,b");
  });

  test("converts camelCase to kebab-case", () => {
    setFlagContext({
      noModifyPath: true,
      someVeryLongFlagName: "value",
    });
    expect(setTagSpy).toHaveBeenCalledTimes(2);
    expect(setTagSpy).toHaveBeenCalledWith("flag.no-modify-path", "true");
    expect(setTagSpy).toHaveBeenCalledWith(
      "flag.some-very-long-flag-name",
      "value"
    );
  });

  test("truncates long string values to 200 characters", () => {
    const longValue = "x".repeat(250);
    setFlagContext({ longFlag: longValue });
    expect(setTagSpy).toHaveBeenCalledTimes(1);
    expect(setTagSpy).toHaveBeenCalledWith("flag.long-flag", "x".repeat(200));
  });
});

describe("setArgsContext", () => {
  let setContextSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    setContextSpy = spyOn(Sentry, "setContext");
  });

  afterEach(() => {
    setContextSpy.mockRestore();
  });

  test("does not set context for empty args", () => {
    setArgsContext([]);
    expect(setContextSpy).not.toHaveBeenCalled();
  });

  test("sets context for string args", () => {
    setArgsContext(["PROJECT-123", "my-org"]);
    expect(setContextSpy).toHaveBeenCalledTimes(1);
    expect(setContextSpy).toHaveBeenCalledWith("args", {
      values: ["PROJECT-123", "my-org"],
      count: 2,
    });
  });

  test("converts non-string args to JSON", () => {
    setArgsContext([123, { key: "value" }]);
    expect(setContextSpy).toHaveBeenCalledWith("args", {
      values: ["123", '{"key":"value"}'],
      count: 2,
    });
  });
});

describe("withHttpSpan", () => {
  test("executes function and returns result", async () => {
    const result = await withHttpSpan("GET", "/test", async () => "success");
    expect(result).toBe("success");
  });

  test("propagates errors", async () => {
    await expect(
      withHttpSpan("POST", "/test", async () => {
        throw new Error("http error");
      })
    ).rejects.toThrow("http error");
  });
});

describe("withDbSpan", () => {
  test("executes function and returns result", () => {
    const result = withDbSpan("testOp", () => 42);
    expect(result).toBe(42);
  });

  test("propagates errors", () => {
    expect(() =>
      withDbSpan("testOp", () => {
        throw new Error("db error");
      })
    ).toThrow("db error");
  });
});

describe("withSerializeSpan", () => {
  test("executes function and returns result", () => {
    const result = withSerializeSpan("format", () => ({ formatted: true }));
    expect(result).toEqual({ formatted: true });
  });

  test("propagates errors", () => {
    expect(() =>
      withSerializeSpan("format", () => {
        throw new Error("serialize error");
      })
    ).toThrow("serialize error");
  });
});

describe("withTracing", () => {
  test("executes sync function and returns result", async () => {
    const result = await withTracing("test", "test.op", () => 42);
    expect(result).toBe(42);
  });

  test("executes async function and returns result", async () => {
    const result = await withTracing("test", "test.op", async () => {
      await Bun.sleep(1);
      return "async result";
    });
    expect(result).toBe("async result");
  });

  test("propagates sync errors", async () => {
    await expect(
      withTracing("test", "test.op", () => {
        throw new Error("sync error");
      })
    ).rejects.toThrow("sync error");
  });

  test("propagates async errors", async () => {
    await expect(
      withTracing("test", "test.op", async () => {
        await Bun.sleep(1);
        throw new Error("async error");
      })
    ).rejects.toThrow("async error");
  });

  test("handles complex return types", async () => {
    const result = await withTracing("test", "test.op", () => ({
      status: "ok",
      items: [1, 2, 3],
    }));
    expect(result).toEqual({ status: "ok", items: [1, 2, 3] });
  });

  test("accepts attributes", async () => {
    // This test mainly verifies the call doesn't throw
    const result = await withTracing("test", "test.op", () => "success", {
      "test.attr": "value",
      "test.count": 42,
    });
    expect(result).toBe("success");
  });
});

describe("withFsSpan", () => {
  test("executes sync function and returns result", async () => {
    const result = await withFsSpan("readFile", () => "file content");
    expect(result).toBe("file content");
  });

  test("executes async function and returns result", async () => {
    const result = await withFsSpan("readFile", async () => {
      await Bun.sleep(1);
      return "async content";
    });
    expect(result).toBe("async content");
  });

  test("propagates errors", async () => {
    await expect(
      withFsSpan("readFile", () => {
        throw new Error("fs error");
      })
    ).rejects.toThrow("fs error");
  });
});

describe("withTracingSpan", () => {
  test("passes span to callback", async () => {
    let receivedSpan: unknown = null;
    await withTracingSpan("test", "test.op", (span) => {
      receivedSpan = span;
      return "done";
    });
    expect(receivedSpan).not.toBeNull();
  });

  test("executes async function and returns result", async () => {
    const result = await withTracingSpan("test", "test.op", async () => {
      await Bun.sleep(1);
      return "async result";
    });
    expect(result).toBe("async result");
  });

  test("propagates errors", async () => {
    await expect(
      withTracingSpan("test", "test.op", () => {
        throw new Error("test error");
      })
    ).rejects.toThrow("test error");
  });

  test("allows callback to set attributes", async () => {
    // This test verifies the span is usable for setting attributes
    const result = await withTracingSpan("test", "test.op", (span) => {
      span.setAttribute("custom.attr", "value");
      span.setAttributes({ "batch.attr1": 1, "batch.attr2": "two" });
      return "success";
    });
    expect(result).toBe("success");
  });

  test("allows callback to set status without being overridden", async () => {
    // Callback sets error status but returns successfully
    // withTracingSpan should not override the manually-set status
    const result = await withTracingSpan("test", "test.op", (span) => {
      span.setStatus({ code: 2, message: "Manual error" });
      return "returned despite error status";
    });
    expect(result).toBe("returned despite error status");
  });

  test("accepts initial attributes", async () => {
    const result = await withTracingSpan("test", "test.op", () => "success", {
      "init.attr": "initial",
    });
    expect(result).toBe("success");
  });
});

describe("createTracedDatabase", () => {
  test("wraps database and traces query().get()", () => {
    const db = new Database(":memory:");
    db.exec("CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)");
    db.exec("INSERT INTO test (id, name) VALUES (1, 'Alice')");

    const tracedDb = createTracedDatabase(db);
    const row = tracedDb.query("SELECT * FROM test WHERE id = ?").get(1) as {
      id: number;
      name: string;
    };

    expect(row).toEqual({ id: 1, name: "Alice" });
    db.close();
  });

  test("wraps database and traces query().all()", () => {
    const db = new Database(":memory:");
    db.exec("CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)");
    db.exec("INSERT INTO test (id, name) VALUES (1, 'Alice'), (2, 'Bob')");

    const tracedDb = createTracedDatabase(db);
    const rows = tracedDb.query("SELECT * FROM test ORDER BY id").all() as {
      id: number;
      name: string;
    }[];

    expect(rows).toEqual([
      { id: 1, name: "Alice" },
      { id: 2, name: "Bob" },
    ]);
    db.close();
  });

  test("wraps database and traces query().run()", () => {
    const db = new Database(":memory:");
    db.exec("CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)");

    const tracedDb = createTracedDatabase(db);
    tracedDb.query("INSERT INTO test (id, name) VALUES (?, ?)").run(1, "Alice");

    const row = db.query("SELECT * FROM test WHERE id = 1").get() as {
      id: number;
      name: string;
    };
    expect(row).toEqual({ id: 1, name: "Alice" });
    db.close();
  });

  test("passes through non-query methods like exec", () => {
    const db = new Database(":memory:");
    const tracedDb = createTracedDatabase(db);

    // exec should work without tracing (passes through proxy)
    tracedDb.exec("CREATE TABLE test (id INTEGER)");
    tracedDb.exec("INSERT INTO test VALUES (1)");

    const row = tracedDb.query("SELECT * FROM test").get() as { id: number };
    expect(row).toEqual({ id: 1 });
    db.close();
  });

  test("passes through close method", () => {
    const db = new Database(":memory:");
    const tracedDb = createTracedDatabase(db);

    // Should not throw
    expect(() => tracedDb.close()).not.toThrow();
  });

  test("propagates errors from queries", () => {
    const db = new Database(":memory:");
    const tracedDb = createTracedDatabase(db);

    expect(() => {
      tracedDb.query("SELECT * FROM nonexistent_table").get();
    }).toThrow();

    db.close();
  });

  test("statement non-execution methods pass through", () => {
    const db = new Database(":memory:");
    db.exec("CREATE TABLE test (id INTEGER, name TEXT)");
    const tracedDb = createTracedDatabase(db);

    const stmt = tracedDb.query("SELECT * FROM test WHERE id = ?");

    // These should pass through without tracing
    expect(stmt.columnNames).toEqual(["id", "name"]);
    expect(typeof stmt.toString).toBe("function");

    db.close();
  });

  test("statement methods are properly bound for native calls", () => {
    const db = new Database(":memory:");
    db.exec("CREATE TABLE test (id INTEGER, name TEXT)");
    const tracedDb = createTracedDatabase(db);

    const stmt = tracedDb.query("SELECT * FROM test WHERE id = ?");

    // toString() requires proper 'this' binding to access native private fields
    const sqlString = stmt.toString();
    expect(sqlString).toContain("SELECT * FROM test");

    // finalize() should work without errors
    expect(() => stmt.finalize()).not.toThrow();

    db.close();
  });
});
