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
let logMessageSpy: ReturnType<typeof spyOn>;
let outroSpy: ReturnType<typeof spyOn>;
let cancelSpy: ReturnType<typeof spyOn>;
let logInfoSpy: ReturnType<typeof spyOn>;
let logWarnSpy: ReturnType<typeof spyOn>;
let logErrorSpy: ReturnType<typeof spyOn>;

const noop = () => {
  /* suppress clack output */
};

beforeEach(() => {
  logMessageSpy = spyOn(clack.log, "message").mockImplementation(noop);
  outroSpy = spyOn(clack, "outro").mockImplementation(noop);
  cancelSpy = spyOn(clack, "cancel").mockImplementation(noop);
  logInfoSpy = spyOn(clack.log, "info").mockImplementation(noop);
  logWarnSpy = spyOn(clack.log, "warn").mockImplementation(noop);
  logErrorSpy = spyOn(clack.log, "error").mockImplementation(noop);
});

afterEach(() => {
  logMessageSpy.mockRestore();
  outroSpy.mockRestore();
  cancelSpy.mockRestore();
  logInfoSpy.mockRestore();
  logWarnSpy.mockRestore();
  logErrorSpy.mockRestore();
});

describe("formatResult", () => {
  test("displays summary with all fields and a nested changed-files tree", () => {
    formatResult({
      status: "success",
      result: {
        platform: "Next.js",
        projectDir: "/app",
        features: ["errorMonitoring", "performanceMonitoring"],
        commands: ["npm install @sentry/nextjs"],
        sentryProjectUrl: "https://sentry.io/project",
        docsUrl: "https://docs.sentry.io",
        changedFiles: [
          { action: "modify", path: "next.config.js" },
          { action: "create", path: "src/app/instrumentation-client.ts" },
          { action: "modify", path: "src/app/layout.tsx" },
          { action: "delete", path: "src/old-sentry.js" },
        ],
      },
    });

    expect(logMessageSpy).toHaveBeenCalledTimes(1);
    const content: string = logMessageSpy.mock.calls[0][0];

    expect(content).toContain("Next.js");
    expect(content).toContain("/app");
    expect(content).toContain("Error Monitoring");
    expect(content).toContain("Performance Monitoring");
    expect(content).toContain("npm install @sentry/nextjs");
    expect(content).toContain("Changed files");
    expect(content).toContain("src/");
    expect(content).toContain("app/");
    expect(content).toContain("instrumentation-client.ts");
    expect(content).toContain("layout.tsx");
    expect(content).toContain("old-sentry.js");
    expect(content).toContain("next.config.js");
    expect(content).toContain("Changed files\n├─ src/");
    expect(content).toContain("├─ src/");
    expect(content).toContain("│  ├─ app/");
    expect(content).toContain("│  │  ├─ + instrumentation-client.ts");
    expect(content).toContain("│  │  └─ ~ layout.tsx");
    expect(content).toContain("└─ ~ next.config.js");
    const changedFilesSection = content.slice(content.indexOf("Changed files"));
    expect(changedFilesSection).toContain("│");
    expect(content).not.toContain("`");
  });

  test("skips summary when result has no summary fields", () => {
    formatResult({ status: "success" });

    expect(logMessageSpy).not.toHaveBeenCalled();
    expect(outroSpy).toHaveBeenCalled();
  });

  test("displays warnings when present", () => {
    formatResult({
      status: "success",
      result: {
        warnings: ["Source maps not configured", "Missing DSN"],
      },
    });

    expect(logWarnSpy).toHaveBeenCalledTimes(2);
    expect(logWarnSpy.mock.calls[0][0]).toBe("Source maps not configured");
    expect(logWarnSpy.mock.calls[1][0]).toBe("Missing DSN");
  });

  test("unwraps nested result property", () => {
    formatResult({ status: "success", result: { platform: "React" } });

    const content: string = logMessageSpy.mock.calls[0][0];
    expect(content).toContain("React");
  });
});

describe("formatError", () => {
  test("logs the error message", () => {
    formatError({ status: "failed", error: "Connection timed out" });

    expect(logErrorSpy).toHaveBeenCalledWith("Connection timed out");
    expect(cancelSpy).toHaveBeenCalledWith("Setup failed");
  });

  test("extracts message from nested result.message", () => {
    formatError({ status: "failed", result: { message: "Inner failure" } });

    expect(logErrorSpy).toHaveBeenCalledWith("Inner failure");
  });

  test("falls back to unknown error when no message available", () => {
    formatError({ status: "failed" });

    expect(logErrorSpy).toHaveBeenCalledWith(
      "Wizard failed with an unknown error"
    );
  });

  test("shows platform hint for detection failure exit code (20)", () => {
    formatError({ status: "failed", result: { exitCode: 20 } });

    const warnMsg: string = logWarnSpy.mock.calls[0][0];
    expect(warnMsg).toContain("platform");
  });

  test("shows manual install commands for dependency failure (30)", () => {
    formatError({
      status: "failed",
      result: {
        exitCode: 30,
        commands: ["npm install @sentry/node"],
      },
    });

    const warnMsg: string = logWarnSpy.mock.calls[0][0];
    expect(warnMsg).toContain("$ npm install @sentry/node");
  });

  test("shows verification hint for exit code 50", () => {
    formatError({ status: "failed", result: { exitCode: 50 } });

    const warnMsg: string = logWarnSpy.mock.calls[0][0];
    expect(warnMsg).toContain("verification");
  });

  test("shows docs URL when present", () => {
    formatError({
      status: "failed",
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
