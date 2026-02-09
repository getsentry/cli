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
import { buildCommand, numberParser } from "../../src/lib/command.js";

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
