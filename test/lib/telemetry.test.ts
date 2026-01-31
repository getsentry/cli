/**
 * Telemetry Module Tests
 *
 * Tests for withTelemetry wrapper and opt-out behavior.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  initSentry,
  setCommandSpanName,
  setOrgProjectContext,
  withDbSpan,
  withHttpSpan,
  withSerializeSpan,
  withTelemetry,
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
