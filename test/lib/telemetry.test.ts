/**
 * Telemetry Module Tests
 *
 * Tests for telemetry helper functions and opt-out behavior.
 */

import { afterEach, describe, expect, test } from "bun:test";
import {
  initSentry,
  isTelemetryEnabled,
  TELEMETRY_ENV_VAR,
  TELEMETRY_FLAG,
  withTelemetry,
} from "../../src/lib/telemetry.js";

describe("isTelemetryEnabled", () => {
  const originalEnv = process.env[TELEMETRY_ENV_VAR];

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env[TELEMETRY_ENV_VAR];
    } else {
      process.env[TELEMETRY_ENV_VAR] = originalEnv;
    }
  });

  test("returns true when env var is not set", () => {
    delete process.env[TELEMETRY_ENV_VAR];
    expect(isTelemetryEnabled()).toBe(true);
  });

  test("returns false when env var is set to '1'", () => {
    process.env[TELEMETRY_ENV_VAR] = "1";
    expect(isTelemetryEnabled()).toBe(false);
  });

  test("returns true when env var is set to other values", () => {
    process.env[TELEMETRY_ENV_VAR] = "0";
    expect(isTelemetryEnabled()).toBe(true);

    process.env[TELEMETRY_ENV_VAR] = "false";
    expect(isTelemetryEnabled()).toBe(true);

    process.env[TELEMETRY_ENV_VAR] = "";
    expect(isTelemetryEnabled()).toBe(true);
  });

  test("returns true when env var is set to 'true'", () => {
    process.env[TELEMETRY_ENV_VAR] = "true";
    expect(isTelemetryEnabled()).toBe(true);
  });

  test("returns true when env var is set to 'yes'", () => {
    process.env[TELEMETRY_ENV_VAR] = "yes";
    expect(isTelemetryEnabled()).toBe(true);
  });
});

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

  // Note: We don't test with telemetry enabled since there's no DSN configured
  // in tests. The Sentry SDK won't send events without a valid DSN.
  test("executes callback when telemetry is enabled but no DSN", async () => {
    // With no SENTRY_DSN_BUILD, SDK is not enabled and callback still executes
    let executed = false;
    await withTelemetry(true, () => {
      executed = true;
    });
    expect(executed).toBe(true);
  });

  test("returns result when telemetry is enabled but no DSN", async () => {
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
