/**
 * Command Builder Tests
 *
 * Tests for the buildCommand wrapper that adds automatic flag telemetry.
 * Uses Stricli's run() to invoke commands end-to-end, verifying the wrapper
 * captures flags/args and calls the original function.
 */

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as Sentry from "@sentry/bun";
import {
  buildApplication,
  buildRouteMap,
  type CommandContext,
  run,
} from "@stricli/core";
import {
  applyLoggingFlags,
  buildCommand,
  LOG_LEVEL_FLAG,
  numberParser,
  VERBOSE_FLAG,
} from "../../src/lib/command.js";
import { LOG_LEVEL_NAMES, logger, setLogLevel } from "../../src/lib/logger.js";

/** Minimal context for test commands */
type TestContext = CommandContext & {
  process: { stdout: { write: (s: string) => boolean } };
};

/** Creates a minimal writable stream for testing */
function createTestProcess() {
  const output: string[] = [];
  return {
    process: {
      stdout: {
        write: (s: string) => {
          output.push(s);
          return true;
        },
      },
      stderr: {
        write: (s: string) => {
          output.push(s);
          return true;
        },
      },
    },
    output,
  };
}

describe("buildCommand", () => {
  test("builds a valid command object", () => {
    const command = buildCommand({
      docs: { brief: "Test command" },
      parameters: {
        flags: {
          verbose: { kind: "boolean", brief: "Verbose", default: false },
        },
      },
      func(_flags: { verbose: boolean }) {
        // no-op
      },
    });
    expect(command).toBeDefined();
  });

  test("handles commands with empty parameters", () => {
    const command = buildCommand({
      docs: { brief: "Simple command" },
      parameters: {},
      func() {
        // no-op
      },
    });
    expect(command).toBeDefined();
  });

  test("re-exports numberParser from Stricli", () => {
    expect(numberParser).toBeDefined();
    expect(typeof numberParser).toBe("function");
  });
});

describe("buildCommand telemetry integration", () => {
  let setTagSpy: ReturnType<typeof spyOn>;
  let setContextSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    setTagSpy = spyOn(Sentry, "setTag");
    setContextSpy = spyOn(Sentry, "setContext");
  });

  afterEach(() => {
    setTagSpy.mockRestore();
    setContextSpy.mockRestore();
  });

  test("captures flags as Sentry tags when command runs", async () => {
    let calledWith: unknown = null;

    const command = buildCommand<
      { verbose: boolean; limit: number },
      [],
      TestContext
    >({
      docs: { brief: "Test" },
      parameters: {
        flags: {
          verbose: { kind: "boolean", brief: "Verbose", default: false },
          limit: {
            kind: "parsed",
            parse: numberParser,
            brief: "Limit",
            default: "10",
          },
        },
      },
      func(this: TestContext, flags: { verbose: boolean; limit: number }) {
        calledWith = flags;
      },
    });

    const routeMap = buildRouteMap({
      routes: { test: command },
      docs: { brief: "Test app" },
    });
    const app = buildApplication(routeMap, { name: "test" });
    const { process } = createTestProcess();

    await run(app, ["test", "--verbose", "--limit", "50"], {
      process,
    } as TestContext);

    // Original func was called with parsed flags
    expect(calledWith).toEqual({ verbose: true, limit: 50 });

    // Sentry.setTag was called for meaningful flag values
    expect(setTagSpy).toHaveBeenCalledWith("flag.verbose", "true");
    expect(setTagSpy).toHaveBeenCalledWith("flag.limit", "50");
  });

  test("skips false boolean flags in telemetry", async () => {
    const command = buildCommand<{ json: boolean }, [], TestContext>({
      docs: { brief: "Test" },
      parameters: {
        flags: {
          json: { kind: "boolean", brief: "JSON output", default: false },
        },
      },
      func(_flags: { json: boolean }) {
        // no-op
      },
    });

    const routeMap = buildRouteMap({
      routes: { test: command },
      docs: { brief: "Test app" },
    });
    const app = buildApplication(routeMap, { name: "test" });
    const { process } = createTestProcess();

    await run(app, ["test"], { process } as TestContext);

    // Should not set tag for default false boolean
    const flagCalls = setTagSpy.mock.calls.filter(
      (call) => typeof call[0] === "string" && call[0].startsWith("flag.")
    );
    expect(flagCalls).toHaveLength(0);
  });

  test("captures positional args as Sentry context", async () => {
    let calledArgs: unknown = null;

    const command = buildCommand<Record<string, never>, [string], TestContext>({
      docs: { brief: "Test" },
      parameters: {
        positional: {
          kind: "tuple",
          parameters: [{ brief: "Issue ID", parse: String }],
        },
      },
      func(this: TestContext, _flags: Record<string, never>, issueId: string) {
        calledArgs = issueId;
      },
    });

    const routeMap = buildRouteMap({
      routes: { test: command },
      docs: { brief: "Test app" },
    });
    const app = buildApplication(routeMap, { name: "test" });
    const { process } = createTestProcess();

    await run(app, ["test", "PROJECT-123"], { process } as TestContext);

    expect(calledArgs).toBe("PROJECT-123");
    expect(setContextSpy).toHaveBeenCalledWith("args", {
      values: ["PROJECT-123"],
      count: 1,
    });
  });

  test("preserves this context for command functions", async () => {
    let capturedStdout = false;

    const command = buildCommand<Record<string, never>, [], TestContext>({
      docs: { brief: "Test" },
      parameters: {},
      func(this: TestContext) {
        // Verify 'this' is correctly bound to context
        capturedStdout = typeof this.process.stdout.write === "function";
      },
    });

    const routeMap = buildRouteMap({
      routes: { test: command },
      docs: { brief: "Test app" },
    });
    const app = buildApplication(routeMap, { name: "test" });
    const { process } = createTestProcess();

    await run(app, ["test"], { process } as TestContext);

    expect(capturedStdout).toBe(true);
  });

  test("handles async command functions", async () => {
    let executed = false;

    const command = buildCommand<{ delay: number }, [], TestContext>({
      docs: { brief: "Test" },
      parameters: {
        flags: {
          delay: {
            kind: "parsed",
            parse: numberParser,
            brief: "Delay ms",
            default: "1",
          },
        },
      },
      async func(_flags: { delay: number }) {
        await Bun.sleep(1);
        executed = true;
      },
    });

    const routeMap = buildRouteMap({
      routes: { test: command },
      docs: { brief: "Test app" },
    });
    const app = buildApplication(routeMap, { name: "test" });
    const { process } = createTestProcess();

    await run(app, ["test", "--delay", "1"], { process } as TestContext);

    expect(executed).toBe(true);
    expect(setTagSpy).toHaveBeenCalledWith("flag.delay", "1");
  });
});

// ---------------------------------------------------------------------------
// Global logging flag definitions
// ---------------------------------------------------------------------------

describe("LOG_LEVEL_FLAG", () => {
  test("is an enum flag with all log level names", () => {
    expect(LOG_LEVEL_FLAG.kind).toBe("enum");
    expect(LOG_LEVEL_FLAG.values).toEqual([...LOG_LEVEL_NAMES]);
  });

  test("is optional and hidden", () => {
    expect(LOG_LEVEL_FLAG.optional).toBe(true);
    expect(LOG_LEVEL_FLAG.hidden).toBe(true);
  });
});

describe("VERBOSE_FLAG", () => {
  test("is a boolean flag defaulting to false", () => {
    expect(VERBOSE_FLAG.kind).toBe("boolean");
    expect(VERBOSE_FLAG.default).toBe(false);
  });

  test("is hidden", () => {
    expect(VERBOSE_FLAG.hidden).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// applyLoggingFlags
// ---------------------------------------------------------------------------

describe("applyLoggingFlags", () => {
  let originalLevel: number;

  beforeEach(() => {
    originalLevel = logger.level;
  });

  afterEach(() => {
    setLogLevel(originalLevel);
  });

  test("sets level from logLevel flag", () => {
    applyLoggingFlags("debug", false);
    expect(logger.level).toBe(4);
  });

  test("sets level from verbose flag", () => {
    applyLoggingFlags(undefined, true);
    expect(logger.level).toBe(4); // debug
  });

  test("logLevel takes priority over verbose", () => {
    applyLoggingFlags("error", true);
    expect(logger.level).toBe(0); // error, not debug
  });

  test("does nothing when both are unset/false", () => {
    const before = logger.level;
    applyLoggingFlags(undefined, false);
    expect(logger.level).toBe(before);
  });

  test("accepts all valid level names", () => {
    for (const name of LOG_LEVEL_NAMES) {
      applyLoggingFlags(name, false);
      expect(logger.level).toBe(LOG_LEVEL_NAMES.indexOf(name));
    }
  });
});

// ---------------------------------------------------------------------------
// buildCommand
// ---------------------------------------------------------------------------

describe("buildCommand", () => {
  test("builds a valid command object", () => {
    const command = buildCommand({
      docs: { brief: "Test command" },
      parameters: {
        flags: {
          json: { kind: "boolean", brief: "JSON output", default: false },
        },
      },
      func(_flags: { json: boolean }) {
        // no-op
      },
    });
    expect(command).toBeDefined();
  });

  test("accepts --verbose and --log-level flags without error", async () => {
    let calledFlags: Record<string, unknown> | null = null;

    const command = buildCommand<{ json: boolean }, [], TestContext>({
      docs: { brief: "Test" },
      parameters: {
        flags: {
          json: { kind: "boolean", brief: "JSON output", default: false },
        },
      },
      func(this: TestContext, flags: { json: boolean }) {
        calledFlags = flags as unknown as Record<string, unknown>;
      },
    });

    const routeMap = buildRouteMap({
      routes: { test: command },
      docs: { brief: "Test app" },
    });
    const app = buildApplication(routeMap, { name: "test" });
    const { process } = createTestProcess();

    // Should NOT throw "No flag registered for --verbose"
    await run(app, ["test", "--verbose", "--json"], {
      process,
    } as TestContext);

    // Original func receives json flag but NOT verbose/log-level
    expect(calledFlags).toBeDefined();
    expect(calledFlags!.json).toBe(true);
    expect(calledFlags!.verbose).toBeUndefined();
    expect(calledFlags!["log-level"]).toBeUndefined();
  });

  test("--verbose sets logger to debug level", async () => {
    const originalLevel = logger.level;
    try {
      const command = buildCommand<Record<string, never>, [], TestContext>({
        docs: { brief: "Test" },
        parameters: {},
        func() {
          // no-op
        },
      });

      const routeMap = buildRouteMap({
        routes: { test: command },
        docs: { brief: "Test app" },
      });
      const app = buildApplication(routeMap, { name: "test" });
      const { process } = createTestProcess();

      await run(app, ["test", "--verbose"], { process } as TestContext);

      expect(logger.level).toBe(4); // debug
    } finally {
      setLogLevel(originalLevel);
    }
  });

  test("--log-level sets logger to specified level", async () => {
    const originalLevel = logger.level;
    try {
      const command = buildCommand<Record<string, never>, [], TestContext>({
        docs: { brief: "Test" },
        parameters: {},
        func() {
          // no-op
        },
      });

      const routeMap = buildRouteMap({
        routes: { test: command },
        docs: { brief: "Test app" },
      });
      const app = buildApplication(routeMap, { name: "test" });
      const { process } = createTestProcess();

      await run(app, ["test", "--log-level", "trace"], {
        process,
      } as TestContext);

      expect(logger.level).toBe(5); // trace
    } finally {
      setLogLevel(originalLevel);
    }
  });

  test("--log-level=value (equals form) works", async () => {
    const originalLevel = logger.level;
    try {
      const command = buildCommand<Record<string, never>, [], TestContext>({
        docs: { brief: "Test" },
        parameters: {},
        func() {
          // no-op
        },
      });

      const routeMap = buildRouteMap({
        routes: { test: command },
        docs: { brief: "Test app" },
      });
      const app = buildApplication(routeMap, { name: "test" });
      const { process } = createTestProcess();

      await run(app, ["test", "--log-level=error"], {
        process,
      } as TestContext);

      expect(logger.level).toBe(0); // error
    } finally {
      setLogLevel(originalLevel);
    }
  });

  test("strips logging flags from func's flags parameter", async () => {
    let receivedFlags: Record<string, unknown> | null = null;

    const command = buildCommand<{ limit: number }, [], TestContext>({
      docs: { brief: "Test" },
      parameters: {
        flags: {
          limit: {
            kind: "parsed",
            parse: numberParser,
            brief: "Limit",
            default: "10",
          },
        },
      },
      func(this: TestContext, flags: { limit: number }) {
        receivedFlags = flags as unknown as Record<string, unknown>;
      },
    });

    const routeMap = buildRouteMap({
      routes: { test: command },
      docs: { brief: "Test app" },
    });
    const app = buildApplication(routeMap, { name: "test" });
    const { process } = createTestProcess();

    await run(
      app,
      ["test", "--verbose", "--log-level", "debug", "--limit", "50"],
      { process } as TestContext
    );

    expect(receivedFlags).toBeDefined();
    expect(receivedFlags!.limit).toBe(50);
    // Logging flags must be stripped
    expect(receivedFlags!.verbose).toBeUndefined();
    expect(receivedFlags!["log-level"]).toBeUndefined();
  });

  test("preserves command's own --verbose flag when already defined", async () => {
    const originalLevel = logger.level;
    let receivedFlags: Record<string, unknown> | null = null;

    try {
      // Simulates the api command: defines its own --verbose with HTTP semantics
      const command = buildCommand<
        { verbose: boolean; silent: boolean },
        [],
        TestContext
      >({
        docs: { brief: "Test" },
        parameters: {
          flags: {
            verbose: {
              kind: "boolean",
              brief: "Show HTTP details",
              default: false,
            },
            silent: {
              kind: "boolean",
              brief: "Suppress output",
              default: false,
            },
          },
        },
        func(this: TestContext, flags: { verbose: boolean; silent: boolean }) {
          receivedFlags = flags as unknown as Record<string, unknown>;
        },
      });

      const routeMap = buildRouteMap({
        routes: { test: command },
        docs: { brief: "Test app" },
      });
      const app = buildApplication(routeMap, { name: "test" });
      const { process } = createTestProcess();

      await run(app, ["test", "--verbose", "--log-level", "trace"], {
        process,
      } as TestContext);

      // Command's own --verbose is passed through (not stripped)
      expect(receivedFlags).toBeDefined();
      expect(receivedFlags!.verbose).toBe(true);
      expect(receivedFlags!.silent).toBe(false);
      // --log-level is always stripped (it's ours)
      expect(receivedFlags!["log-level"]).toBeUndefined();
      // --verbose also sets debug-level logging as a side-effect
      // but --log-level=trace takes priority
      expect(logger.level).toBe(5); // trace
    } finally {
      setLogLevel(originalLevel);
    }
  });

  test("command's own --verbose sets debug log level as side-effect", async () => {
    const originalLevel = logger.level;

    try {
      const command = buildCommand<{ verbose: boolean }, [], TestContext>({
        docs: { brief: "Test" },
        parameters: {
          flags: {
            verbose: {
              kind: "boolean",
              brief: "Show HTTP details",
              default: false,
            },
          },
        },
        func() {
          // no-op
        },
      });

      const routeMap = buildRouteMap({
        routes: { test: command },
        docs: { brief: "Test app" },
      });
      const app = buildApplication(routeMap, { name: "test" });
      const { process } = createTestProcess();

      await run(app, ["test", "--verbose"], {
        process,
      } as TestContext);

      // Even though verbose is command-owned, it triggers debug-level logging
      expect(logger.level).toBe(4); // debug
    } finally {
      setLogLevel(originalLevel);
    }
  });
});
