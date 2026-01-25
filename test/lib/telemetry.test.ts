/**
 * Telemetry Module Tests
 *
 * Tests for telemetry helper functions and opt-out behavior.
 */

import { afterEach, describe, expect, test } from "bun:test";
import {
  extractCommand,
  isTelemetryEnabled,
  TELEMETRY_ENV_VAR,
  TELEMETRY_FLAG,
  withTelemetry,
} from "../../src/lib/telemetry.js";

describe("extractCommand", () => {
  test("extracts single command", () => {
    expect(extractCommand(["org"])).toBe("org");
  });

  test("extracts subcommand", () => {
    expect(extractCommand(["auth", "login"])).toBe("auth.login");
  });

  test("extracts subcommand with flags", () => {
    expect(extractCommand(["auth", "login", "--timeout", "60"])).toBe(
      "auth.login"
    );
  });

  test("extracts command ignoring leading flags", () => {
    expect(extractCommand(["--verbose", "issue", "list"])).toBe("issue.list");
  });

  test("extracts only first two positional args", () => {
    expect(extractCommand(["issue", "list", "PROJECT-123"])).toBe("issue.list");
  });

  test("returns unknown for empty args", () => {
    expect(extractCommand([])).toBe("unknown");
  });

  test("returns unknown for only flags", () => {
    expect(extractCommand(["--help"])).toBe("unknown");
    expect(extractCommand(["--version"])).toBe("unknown");
  });

  test("handles flags without values mixed with positional args", () => {
    // Note: extractCommand can't distinguish flag values from positional args
    // so --org myorg will treat "myorg" as a positional arg
    // This is acceptable as it still captures the primary command
    expect(extractCommand(["--json", "project", "list"])).toBe("project.list");
  });
});

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
});

describe("withTelemetry", () => {
  test("executes callback when telemetry is disabled", async () => {
    let executed = false;
    await withTelemetry({ enabled: false, command: "test" }, () => {
      executed = true;
    });
    expect(executed).toBe(true);
  });

  test("returns callback result when telemetry is disabled", async () => {
    const result = await withTelemetry(
      { enabled: false, command: "test" },
      () => 42
    );
    expect(result).toBe(42);
  });

  test("handles async callbacks when telemetry is disabled", async () => {
    const result = await withTelemetry(
      { enabled: false, command: "test" },
      async () => {
        await Bun.sleep(1);
        return "async result";
      }
    );
    expect(result).toBe("async result");
  });

  test("propagates errors from callback when telemetry is disabled", async () => {
    const testError = new Error("test error");
    await expect(
      withTelemetry({ enabled: false, command: "test" }, () => {
        throw testError;
      })
    ).rejects.toThrow("test error");
  });

  // Note: We don't test with telemetry enabled since there's no DSN configured
  // in tests. The Sentry SDK won't initialize without a valid DSN.
  test("executes callback when telemetry is enabled but no DSN", async () => {
    // With no SENTRY_DSN_BUILD, telemetry init returns undefined
    // and callback should still execute
    let executed = false;
    await withTelemetry({ enabled: true, command: "test" }, () => {
      executed = true;
    });
    expect(executed).toBe(true);
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
