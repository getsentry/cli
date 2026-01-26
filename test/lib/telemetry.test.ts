/**
 * Telemetry Module Tests
 *
 * Tests for telemetry helper functions and opt-out behavior.
 */

import { describe, expect, test } from "bun:test";
import {
  initSentry,
  TELEMETRY_ENV_VAR,
  TELEMETRY_FLAG,
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

  test("uses development environment when NODE_ENV_BUILD is not defined", () => {
    const client = initSentry(true);
    expect(client?.getOptions().environment).toBe("development");
  });

  test("uses 0.0.0-dev version when SENTRY_CLI_VERSION is not defined", () => {
    const client = initSentry(true);
    expect(client?.getOptions().release).toBe("0.0.0-dev");
  });
});

describe("withTelemetry", () => {
  test("executes callback when telemetry is disabled", async () => {
    let executed = false;
    await withTelemetry(false, () => {
      executed = true;
    });
    expect(executed).toBe(true);
  });

  test("returns callback result when telemetry is disabled", async () => {
    const result = await withTelemetry(false, () => 42);
    expect(result).toBe(42);
  });

  test("handles async callbacks when telemetry is disabled", async () => {
    const result = await withTelemetry(false, async () => {
      await Bun.sleep(1);
      return "async result";
    });
    expect(result).toBe("async result");
  });

  test("propagates errors from callback when telemetry is disabled", async () => {
    const testError = new Error("test error");
    await expect(
      withTelemetry(false, () => {
        throw testError;
      })
    ).rejects.toThrow("test error");
  });

  test("propagates async errors when telemetry is disabled", async () => {
    await expect(
      withTelemetry(false, async () => {
        await Bun.sleep(1);
        throw new Error("async error");
      })
    ).rejects.toThrow("async error");
  });

  test("executes callback when telemetry is enabled", async () => {
    let executed = false;
    await withTelemetry(true, () => {
      executed = true;
    });
    expect(executed).toBe(true);
  });

  test("returns result when telemetry is enabled", async () => {
    const result = await withTelemetry(true, () => "success");
    expect(result).toBe("success");
  });

  test("handles complex return types", async () => {
    const result = await withTelemetry(false, () => ({
      status: "ok",
      count: 42,
      items: [1, 2, 3],
    }));
    expect(result).toEqual({ status: "ok", count: 42, items: [1, 2, 3] });
  });

  test("handles void return value", async () => {
    let sideEffect = false;
    const result = await withTelemetry(false, () => {
      sideEffect = true;
    });
    expect(result).toBeUndefined();
    expect(sideEffect).toBe(true);
  });

  test("handles null return value", async () => {
    const result = await withTelemetry(false, () => null);
    expect(result).toBeNull();
  });
});

describe("constants", () => {
  test("TELEMETRY_ENV_VAR is correct", () => {
    expect(TELEMETRY_ENV_VAR).toBe("SENTRY_CLI_NO_TELEMETRY");
  });

  test("TELEMETRY_FLAG is correct", () => {
    expect(TELEMETRY_FLAG).toBe("--no-telemetry");
  });
});
