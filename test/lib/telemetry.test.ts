/**
 * Telemetry Module Tests
 *
 * Tests for withTelemetry wrapper and opt-out behavior.
 */

import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  createTracedDatabase,
  initSentry,
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
  test("handles empty flags object", () => {
    expect(() => setFlagContext({})).not.toThrow();
  });

  test("handles boolean flags (true sets tag)", () => {
    expect(() => setFlagContext({ verbose: true, debug: true })).not.toThrow();
  });

  test("handles boolean flags (false is skipped)", () => {
    expect(() =>
      setFlagContext({ verbose: false, debug: false })
    ).not.toThrow();
  });

  test("handles string flags", () => {
    expect(() =>
      setFlagContext({ output: "json", format: "table" })
    ).not.toThrow();
  });

  test("handles number flags", () => {
    expect(() => setFlagContext({ limit: 10, offset: 0 })).not.toThrow();
  });

  test("handles undefined and null values (skipped)", () => {
    expect(() =>
      setFlagContext({ value: undefined, other: null })
    ).not.toThrow();
  });

  test("handles empty string values (skipped)", () => {
    expect(() => setFlagContext({ name: "" })).not.toThrow();
  });

  test("handles empty array values (skipped)", () => {
    expect(() => setFlagContext({ items: [] })).not.toThrow();
  });

  test("handles non-empty array values", () => {
    expect(() =>
      setFlagContext({ projects: ["proj1", "proj2"] })
    ).not.toThrow();
  });

  test("handles mixed flag types", () => {
    expect(() =>
      setFlagContext({
        verbose: true,
        quiet: false,
        limit: 50,
        output: "json",
        projects: ["a", "b"],
        empty: "",
        missing: undefined,
      })
    ).not.toThrow();
  });

  test("converts camelCase to kebab-case", () => {
    // This test verifies the function doesn't throw with camelCase keys
    // The actual conversion is tested implicitly - the tag would be flag.no-modify-path
    expect(() =>
      setFlagContext({
        noModifyPath: true,
        someVeryLongFlagName: "value",
      })
    ).not.toThrow();
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
