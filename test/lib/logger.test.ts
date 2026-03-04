/**
 * Unit tests for the logger module.
 *
 * Tests parseLogLevel, extractLogLevelFromArgs, setLogLevel,
 * attachSentryReporter, and the logger instance configuration.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  attachSentryReporter,
  extractLogLevelFromArgs,
  LOG_LEVEL_ENV_VAR,
  LOG_LEVEL_NAMES,
  logger,
  parseLogLevel,
  setLogLevel,
} from "../../src/lib/logger.js";

describe("parseLogLevel", () => {
  test("maps known level names to correct numeric values", () => {
    expect(parseLogLevel("error")).toBe(0);
    expect(parseLogLevel("warn")).toBe(1);
    expect(parseLogLevel("info")).toBe(3);
    expect(parseLogLevel("debug")).toBe(4);
    expect(parseLogLevel("trace")).toBe(5);
  });

  test("is case-insensitive", () => {
    expect(parseLogLevel("ERROR")).toBe(0);
    expect(parseLogLevel("Debug")).toBe(4);
    expect(parseLogLevel("TRACE")).toBe(5);
    expect(parseLogLevel("Warn")).toBe(1);
  });

  test("trims whitespace", () => {
    expect(parseLogLevel("  debug  ")).toBe(4);
    expect(parseLogLevel("\ttrace\n")).toBe(5);
  });

  test("returns default (info=3) for unrecognized values", () => {
    expect(parseLogLevel("verbose")).toBe(3);
    expect(parseLogLevel("")).toBe(3);
    expect(parseLogLevel("unknown")).toBe(3);
    expect(parseLogLevel("42")).toBe(3);
  });
});

describe("LOG_LEVEL_NAMES", () => {
  test("contains all expected level names", () => {
    expect(LOG_LEVEL_NAMES).toEqual([
      "error",
      "warn",
      "info",
      "debug",
      "trace",
    ]);
  });

  test("all names are valid for parseLogLevel", () => {
    for (const name of LOG_LEVEL_NAMES) {
      const level = parseLogLevel(name);
      expect(level).toBeGreaterThanOrEqual(0);
      expect(level).toBeLessThanOrEqual(5);
    }
  });
});

describe("LOG_LEVEL_ENV_VAR", () => {
  test("is SENTRY_LOG_LEVEL", () => {
    expect(LOG_LEVEL_ENV_VAR).toBe("SENTRY_LOG_LEVEL");
  });
});

describe("setLogLevel", () => {
  let originalLevel: number;

  beforeEach(() => {
    originalLevel = logger.level;
  });

  afterEach(() => {
    logger.level = originalLevel;
  });

  test("changes the logger level", () => {
    setLogLevel(4);
    expect(logger.level).toBe(4);
  });

  test("can set to error level", () => {
    setLogLevel(0);
    expect(logger.level).toBe(0);
  });

  test("can set to trace level", () => {
    setLogLevel(5);
    expect(logger.level).toBe(5);
  });
});

describe("extractLogLevelFromArgs", () => {
  test("returns null when no flags are present", () => {
    const args = ["issue", "list", "--json"];
    const result = extractLogLevelFromArgs(args);
    expect(result).toBeNull();
    expect(args).toEqual(["issue", "list", "--json"]);
  });

  test("extracts --verbose and removes it from args", () => {
    const args = ["--verbose", "issue", "list"];
    const result = extractLogLevelFromArgs(args);
    expect(result).toBe(4); // debug
    expect(args).toEqual(["issue", "list"]);
  });

  test("extracts --verbose from middle of args", () => {
    const args = ["issue", "--verbose", "list"];
    const result = extractLogLevelFromArgs(args);
    expect(result).toBe(4);
    expect(args).toEqual(["issue", "list"]);
  });

  test("extracts --verbose from end of args", () => {
    const args = ["issue", "list", "--verbose"];
    const result = extractLogLevelFromArgs(args);
    expect(result).toBe(4);
    expect(args).toEqual(["issue", "list"]);
  });

  test("extracts --log-level with value", () => {
    const args = ["--log-level", "trace", "issue", "list"];
    const result = extractLogLevelFromArgs(args);
    expect(result).toBe(5); // trace
    expect(args).toEqual(["issue", "list"]);
  });

  test("extracts --log-level from middle of args", () => {
    const args = ["issue", "--log-level", "error", "list"];
    const result = extractLogLevelFromArgs(args);
    expect(result).toBe(0); // error
    expect(args).toEqual(["issue", "list"]);
  });

  test("--log-level overrides --verbose when both present", () => {
    const args = ["--verbose", "--log-level", "warn", "issue", "list"];
    const result = extractLogLevelFromArgs(args);
    expect(result).toBe(1); // warn wins over debug
    expect(args).toEqual(["issue", "list"]);
  });

  test("--log-level without value defaults to debug", () => {
    const args = ["issue", "--log-level"];
    const result = extractLogLevelFromArgs(args);
    expect(result).toBe(4); // debug
    expect(args).toEqual(["issue"]);
  });

  test("--log-level followed by another flag defaults to debug", () => {
    const args = ["--log-level", "--json", "issue", "list"];
    const result = extractLogLevelFromArgs(args);
    expect(result).toBe(4); // debug (--json starts with -)
    expect(args).toEqual(["--json", "issue", "list"]);
  });

  test("handles all valid level names via --log-level", () => {
    for (const name of LOG_LEVEL_NAMES) {
      const args = ["--log-level", name, "cmd"];
      const result = extractLogLevelFromArgs(args);
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThanOrEqual(5);
      expect(args).toEqual(["cmd"]);
    }
  });

  test("does not consume -v (only --verbose)", () => {
    const args = ["-v", "issue", "list"];
    const result = extractLogLevelFromArgs(args);
    expect(result).toBeNull();
    expect(args).toEqual(["-v", "issue", "list"]);
  });

  test("handles empty args array", () => {
    const args: string[] = [];
    const result = extractLogLevelFromArgs(args);
    expect(result).toBeNull();
    expect(args).toEqual([]);
  });
});

describe("logger instance", () => {
  test("is a consola instance with expected methods", () => {
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.debug).toBe("function");
    expect(typeof logger.warn).toBe("function");
    expect(typeof logger.error).toBe("function");
    expect(typeof logger.trace).toBe("function");
    expect(typeof logger.success).toBe("function");
    expect(typeof logger.withTag).toBe("function");
  });

  test("withTag returns a scoped logger", () => {
    const scoped = logger.withTag("test-scope");
    expect(typeof scoped.info).toBe("function");
    expect(typeof scoped.debug).toBe("function");
  });

  test("default level is info (3)", () => {
    // Unless SENTRY_LOG_LEVEL was set in the environment
    if (!process.env.SENTRY_LOG_LEVEL) {
      expect(logger.level).toBe(3);
    }
  });
});

describe("attachSentryReporter", () => {
  test("can be called without error", () => {
    // attachSentryReporter is idempotent and safe to call even when
    // Sentry is not initialized (it catches errors internally)
    expect(() => attachSentryReporter()).not.toThrow();
  });

  test("is idempotent (second call is a no-op)", () => {
    // First call may or may not succeed depending on Sentry state
    attachSentryReporter();
    // Second call should be a no-op due to internal guard
    expect(() => attachSentryReporter()).not.toThrow();
  });
});
