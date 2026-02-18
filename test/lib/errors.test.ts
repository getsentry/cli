import { describe, expect, test } from "bun:test";
import {
  ApiError,
  AuthError,
  CliError,
  ConfigError,
  ContextError,
  DeviceFlowError,
  formatError,
  getExitCode,
  SeerError,
  stringifyUnknown,
  UpgradeError,
  ValidationError,
} from "../../src/lib/errors.js";

describe("CliError", () => {
  test("has default exit code of 1", () => {
    const err = new CliError("Something went wrong");
    expect(err.exitCode).toBe(1);
    expect(err.message).toBe("Something went wrong");
  });

  test("accepts custom exit code", () => {
    const err = new CliError("Custom exit", 42);
    expect(err.exitCode).toBe(42);
  });

  test("format() returns message", () => {
    const err = new CliError("Test message");
    expect(err.format()).toBe("Test message");
  });
});

describe("AuthError", () => {
  test("not_authenticated has default message", () => {
    const err = new AuthError("not_authenticated");
    expect(err.message).toBe(
      "Not authenticated. Run 'sentry auth login' first."
    );
    expect(err.reason).toBe("not_authenticated");
  });

  test("expired has default message", () => {
    const err = new AuthError("expired");
    expect(err.message).toBe(
      "Authentication expired. Run 'sentry auth login' to re-authenticate."
    );
    expect(err.reason).toBe("expired");
  });

  test("invalid has default message", () => {
    const err = new AuthError("invalid");
    expect(err.message).toBe("Invalid authentication token.");
  });

  test("accepts custom message", () => {
    const err = new AuthError("not_authenticated", "Custom auth error");
    expect(err.message).toBe("Custom auth error");
    expect(err.reason).toBe("not_authenticated");
  });
});

describe("ApiError", () => {
  test("stores status and detail", () => {
    const err = new ApiError("Request failed", 404, "Not found", "/api/issues");
    expect(err.status).toBe(404);
    expect(err.detail).toBe("Not found");
    expect(err.endpoint).toBe("/api/issues");
  });

  test("format() includes detail on separate line", () => {
    const err = new ApiError("Request failed", 500, "Internal server error");
    expect(err.format()).toBe("Request failed\n  Internal server error");
  });

  test("format() excludes detail if same as message", () => {
    const err = new ApiError("Same message", 500, "Same message");
    expect(err.format()).toBe("Same message");
  });

  test("format() works without detail", () => {
    const err = new ApiError("Request failed", 503);
    expect(err.format()).toBe("Request failed");
  });
});

describe("ConfigError", () => {
  test("format() includes suggestion", () => {
    const err = new ConfigError("Invalid config", "Check the config file");
    expect(err.format()).toBe(
      "Invalid config\n\nSuggestion: Check the config file"
    );
  });

  test("format() works without suggestion", () => {
    const err = new ConfigError("Invalid config");
    expect(err.format()).toBe("Invalid config");
  });
});

describe("ContextError", () => {
  test("format() includes usage hints with default alternatives", () => {
    const err = new ContextError("Organization", "sentry org list");
    const formatted = err.format();
    expect(formatted).toContain("Organization is required.");
    expect(formatted).toContain("sentry org list");
    expect(formatted).toContain(
      "Run from a directory with a Sentry-configured project"
    );
    expect(formatted).toContain("Set SENTRY_DSN environment variable");
  });

  test("format() includes custom alternatives", () => {
    const err = new ContextError("Project", "sentry project list", [
      "Specify project in <org>/<project> format",
    ]);
    const formatted = err.format();
    expect(formatted).toContain("Project is required.");
    expect(formatted).toContain("Specify project in <org>/<project> format");
    expect(formatted).not.toContain("SENTRY_DSN");
  });

  test("format() works with empty alternatives", () => {
    const err = new ContextError("Resource", "sentry resource get", []);
    const formatted = err.format();
    expect(formatted).toContain("Resource is required.");
    expect(formatted).not.toContain("Or:");
  });
});

describe("ValidationError", () => {
  test("stores field name", () => {
    const err = new ValidationError("Invalid format", "email");
    expect(err.field).toBe("email");
    expect(err.message).toBe("Invalid format");
  });

  test("field is optional", () => {
    const err = new ValidationError("Invalid input");
    expect(err.field).toBeUndefined();
  });
});

describe("DeviceFlowError", () => {
  test("stores error code", () => {
    const err = new DeviceFlowError("slow_down", "Polling too fast");
    expect(err.code).toBe("slow_down");
    expect(err.message).toBe("Polling too fast");
  });

  test("uses code as message if no description", () => {
    const err = new DeviceFlowError("authorization_pending");
    expect(err.message).toBe("authorization_pending");
  });
});

describe("UpgradeError", () => {
  test("unknown_method has default message", () => {
    const err = new UpgradeError("unknown_method");
    expect(err.message).toBe(
      "Could not detect installation method. Use --method to specify."
    );
    expect(err.reason).toBe("unknown_method");
  });

  test("network_error has default message", () => {
    const err = new UpgradeError("network_error");
    expect(err.message).toBe("Failed to fetch version information.");
    expect(err.reason).toBe("network_error");
  });

  test("execution_failed has default message", () => {
    const err = new UpgradeError("execution_failed");
    expect(err.message).toBe("Upgrade command failed.");
    expect(err.reason).toBe("execution_failed");
  });

  test("version_not_found has default message", () => {
    const err = new UpgradeError("version_not_found");
    expect(err.message).toBe("The specified version was not found.");
    expect(err.reason).toBe("version_not_found");
  });

  test("accepts custom message", () => {
    const err = new UpgradeError("network_error", "Custom upgrade error");
    expect(err.message).toBe("Custom upgrade error");
    expect(err.reason).toBe("network_error");
  });
});

describe("SeerError", () => {
  test("not_enabled has default message", () => {
    const err = new SeerError("not_enabled");
    expect(err.message).toBe("Seer is not enabled for this organization.");
    expect(err.reason).toBe("not_enabled");
  });

  test("no_budget has default message", () => {
    const err = new SeerError("no_budget");
    expect(err.message).toBe("Seer requires a paid plan.");
    expect(err.reason).toBe("no_budget");
  });

  test("ai_disabled has default message", () => {
    const err = new SeerError("ai_disabled");
    expect(err.message).toBe("AI features are disabled for this organization.");
    expect(err.reason).toBe("ai_disabled");
  });

  test("format() includes settings URL when orgSlug provided", () => {
    const err = new SeerError("not_enabled", "my-org");
    const formatted = err.format();
    expect(formatted).toContain("Seer is not enabled for this organization.");
    expect(formatted).toContain("To enable Seer:");
    expect(formatted).toContain("my-org");
  });

  test("format() includes billing URL for no_budget with orgSlug", () => {
    const err = new SeerError("no_budget", "my-org");
    const formatted = err.format();
    expect(formatted).toContain("Seer requires a paid plan.");
    expect(formatted).toContain("upgrade your plan");
    expect(formatted).toContain("my-org");
  });

  test("format() includes org settings URL for ai_disabled with orgSlug", () => {
    const err = new SeerError("ai_disabled", "my-org");
    const formatted = err.format();
    expect(formatted).toContain("AI features are disabled");
    expect(formatted).toContain("To enable AI features:");
    expect(formatted).toContain("my-org");
  });

  test("format() shows fallback message without orgSlug", () => {
    const err = new SeerError("not_enabled");
    const formatted = err.format();
    expect(formatted).toContain("Seer is not enabled for this organization.");
    expect(formatted).toContain("visit your organization's Seer settings");
  });

  test("format() shows fallback for no_budget without orgSlug", () => {
    const err = new SeerError("no_budget");
    const formatted = err.format();
    expect(formatted).toContain(
      "upgrade your plan in your organization's billing settings"
    );
  });

  test("format() shows fallback for ai_disabled without orgSlug", () => {
    const err = new SeerError("ai_disabled");
    const formatted = err.format();
    expect(formatted).toContain("Hide AI Features");
  });
});

describe("stringifyUnknown", () => {
  test("returns strings as-is", () => {
    expect(stringifyUnknown("hello")).toBe("hello");
    expect(stringifyUnknown("")).toBe("");
  });

  test("extracts message from Error instances", () => {
    expect(stringifyUnknown(new Error("something broke"))).toBe(
      "something broke"
    );
    expect(stringifyUnknown(new TypeError("bad type"))).toBe("bad type");
  });

  test("serializes plain objects to JSON", () => {
    expect(stringifyUnknown({ code: "not_found" })).toBe(
      '{"code":"not_found"}'
    );
    expect(stringifyUnknown({ detail: { message: "Forbidden" } })).toBe(
      '{"detail":{"message":"Forbidden"}}'
    );
  });

  test("serializes empty objects", () => {
    expect(stringifyUnknown({})).toBe("{}");
  });

  test("serializes arrays to JSON", () => {
    expect(stringifyUnknown(["error1", "error2"])).toBe('["error1","error2"]');
  });

  test("converts primitives via String()", () => {
    expect(stringifyUnknown(42)).toBe("42");
    expect(stringifyUnknown(null)).toBe("null");
    expect(stringifyUnknown(undefined)).toBe("undefined");
    expect(stringifyUnknown(true)).toBe("true");
    expect(stringifyUnknown(0)).toBe("0");
  });

  test("falls back to String() for circular references", () => {
    const circular: Record<string, unknown> = { name: "loop" };
    circular.self = circular;
    // Should not throw — falls back to String() which returns [object Object]
    expect(() => stringifyUnknown(circular)).not.toThrow();
    expect(stringifyUnknown(circular)).toBe("[object Object]");
  });

  test("falls back to String() for BigInt values", () => {
    const obj = { count: BigInt(42) };
    // JSON.stringify throws on BigInt — should fall back gracefully
    expect(() => stringifyUnknown(obj)).not.toThrow();
    expect(stringifyUnknown(obj)).toBe("[object Object]");
  });
});

describe("formatError", () => {
  test("uses format() for CliError subclasses", () => {
    const err = new ApiError("API failed", 500, "Server error");
    expect(formatError(err)).toBe("API failed\n  Server error");
  });

  test("uses message for standard Error", () => {
    const err = new Error("Standard error");
    expect(formatError(err)).toBe("Standard error");
  });

  test("converts non-errors to string", () => {
    expect(formatError("string error")).toBe("string error");
    expect(formatError(42)).toBe("42");
    expect(formatError(null)).toBe("null");
    expect(formatError(undefined)).toBe("undefined");
  });

  test("serializes plain objects instead of [object Object]", () => {
    expect(formatError({ code: "not_found" })).toBe('{"code":"not_found"}');
    expect(formatError({})).toBe("{}");
  });
});

describe("getExitCode", () => {
  test("returns exitCode for CliError", () => {
    const err = new CliError("Error", 5);
    expect(getExitCode(err)).toBe(5);
  });

  test("returns 1 for standard Error", () => {
    expect(getExitCode(new Error("test"))).toBe(1);
  });

  test("returns 1 for non-errors", () => {
    expect(getExitCode("string")).toBe(1);
    expect(getExitCode(null)).toBe(1);
  });
});
