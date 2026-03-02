/**
 * Formatters Tests
 *
 * Tests for the init wizard output formatters. Since formatResult and
 * formatError write to clack's output, we capture calls via spyOn on
 * the imported @clack/prompts module.
 */

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
// biome-ignore lint/performance/noNamespaceImport: spyOn requires object reference
import * as clack from "@clack/prompts";
import { formatError, formatResult } from "../../../src/lib/init/formatters.js";

// Spy on clack functions to capture arguments without replacing them
let noteSpy: ReturnType<typeof spyOn>;
let outroSpy: ReturnType<typeof spyOn>;
let cancelSpy: ReturnType<typeof spyOn>;
let logInfoSpy: ReturnType<typeof spyOn>;
let logWarnSpy: ReturnType<typeof spyOn>;
let logErrorSpy: ReturnType<typeof spyOn>;

const noop = () => {
  /* suppress clack output */
};

beforeEach(() => {
  noteSpy = spyOn(clack, "note").mockImplementation(noop);
  outroSpy = spyOn(clack, "outro").mockImplementation(noop);
  cancelSpy = spyOn(clack, "cancel").mockImplementation(noop);
  logInfoSpy = spyOn(clack.log, "info").mockImplementation(noop);
  logWarnSpy = spyOn(clack.log, "warn").mockImplementation(noop);
  logErrorSpy = spyOn(clack.log, "error").mockImplementation(noop);
});

afterEach(() => {
  noteSpy.mockRestore();
  outroSpy.mockRestore();
  cancelSpy.mockRestore();
  logInfoSpy.mockRestore();
  logWarnSpy.mockRestore();
  logErrorSpy.mockRestore();
});

describe("formatResult", () => {
  test("displays summary with all fields and action icons", () => {
    formatResult({
      result: {
        platform: "Next.js",
        projectDir: "/app",
        features: ["errorMonitoring", "performanceMonitoring"],
        commands: ["npm install @sentry/nextjs"],
        sentryProjectUrl: "https://sentry.io/project",
        docsUrl: "https://docs.sentry.io",
        changedFiles: [
          { action: "create", path: "sentry.client.config.ts" },
          { action: "modify", path: "next.config.js" },
          { action: "delete", path: "old-sentry.js" },
        ],
      },
    });

    expect(noteSpy).toHaveBeenCalledTimes(1);
    const noteContent: string = noteSpy.mock.calls[0][0];

    expect(noteContent).toContain("Next.js");
    expect(noteContent).toContain("/app");
    expect(noteContent).toContain("Error Monitoring");
    expect(noteContent).toContain("Performance Monitoring");
    expect(noteContent).toContain("npm install @sentry/nextjs");
    expect(noteContent).toContain("+ sentry.client.config.ts");
    expect(noteContent).toContain("~ next.config.js");
    expect(noteContent).toContain("- old-sentry.js");

    expect(noteSpy.mock.calls[0][1]).toBe("Setup complete");
  });

  test("skips note when result has no summary fields", () => {
    formatResult({});

    expect(noteSpy).not.toHaveBeenCalled();
    expect(outroSpy).toHaveBeenCalled();
  });

  test("displays warnings when present", () => {
    formatResult({
      result: {
        warnings: ["Source maps not configured", "Missing DSN"],
      },
    });

    expect(logWarnSpy).toHaveBeenCalledTimes(2);
    expect(logWarnSpy.mock.calls[0][0]).toBe("Source maps not configured");
    expect(logWarnSpy.mock.calls[1][0]).toBe("Missing DSN");
  });

  test("unwraps nested result property", () => {
    formatResult({ result: { platform: "React" } });

    const noteContent: string = noteSpy.mock.calls[0][0];
    expect(noteContent).toContain("React");
  });
});

describe("formatError", () => {
  test("logs the error message", () => {
    formatError({ error: "Connection timed out" });

    expect(logErrorSpy).toHaveBeenCalledWith("Connection timed out");
    expect(cancelSpy).toHaveBeenCalledWith("Setup failed");
  });

  test("extracts message from nested result.message", () => {
    formatError({ result: { message: "Inner failure" } });

    expect(logErrorSpy).toHaveBeenCalledWith("Inner failure");
  });

  test("falls back to unknown error when no message available", () => {
    formatError({});

    expect(logErrorSpy).toHaveBeenCalledWith(
      "Wizard failed with an unknown error"
    );
  });

  test("shows --force hint for already-installed exit code (10)", () => {
    formatError({ result: { exitCode: 10 } });

    const warnMsg: string = logWarnSpy.mock.calls[0][0];
    expect(warnMsg).toContain("--force");
  });

  test("shows platform hint for detection failure exit code (20)", () => {
    formatError({ result: { exitCode: 20 } });

    const warnMsg: string = logWarnSpy.mock.calls[0][0];
    expect(warnMsg).toContain("platform");
  });

  test("shows manual install commands for dependency failure (30)", () => {
    formatError({
      result: {
        exitCode: 30,
        commands: ["npm install @sentry/node"],
      },
    });

    const warnMsg: string = logWarnSpy.mock.calls[0][0];
    expect(warnMsg).toContain("$ npm install @sentry/node");
  });

  test("shows verification hint for exit code 50", () => {
    formatError({ result: { exitCode: 50 } });

    const warnMsg: string = logWarnSpy.mock.calls[0][0];
    expect(warnMsg).toContain("verification");
  });

  test("shows docs URL when present", () => {
    formatError({
      result: { docsUrl: "https://docs.sentry.io/platforms/react/" },
    });

    const infoCalls = logInfoSpy.mock.calls.map((c) => String(c[0]));
    expect(
      infoCalls.some((s) =>
        s.includes("https://docs.sentry.io/platforms/react/")
      )
    ).toBe(true);
  });
});
