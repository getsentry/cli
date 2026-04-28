/**
 * Formatters Tests
 *
 * Tests for the init wizard output formatters. Uses `MockUI` to capture
 * every UI call without going through clack.
 */

import { describe, expect, test } from "bun:test";
import { formatError, formatResult } from "../../../src/lib/init/formatters.js";
import { createMockUI, type MockCall } from "./ui/mock-ui.js";

function logMessage(calls: MockCall[]): string | undefined {
  const call = calls.find((c) => c.kind === "log.message");
  return call?.kind === "log.message" ? call.message : undefined;
}

function warnMessages(calls: MockCall[]): string[] {
  return calls
    .filter(
      (c): c is Extract<MockCall, { kind: "log.warn" }> => c.kind === "log.warn"
    )
    .map((c) => c.message);
}

function errorMessages(calls: MockCall[]): string[] {
  return calls
    .filter(
      (c): c is Extract<MockCall, { kind: "log.error" }> =>
        c.kind === "log.error"
    )
    .map((c) => c.message);
}

function infoMessages(calls: MockCall[]): string[] {
  return calls
    .filter(
      (c): c is Extract<MockCall, { kind: "log.info" }> => c.kind === "log.info"
    )
    .map((c) => c.message);
}

describe("formatResult", () => {
  test("displays summary with all fields and a nested changed-files tree", () => {
    const { ui, calls } = createMockUI();
    formatResult(
      {
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
      },
      ui
    );

    const content = logMessage(calls);
    expect(content).toBeDefined();
    if (!content) {
      throw new Error("expected log.message call");
    }

    // `formatResult` passes raw markdown to `ui.log.message` — color tags
    // (`<green>+</green>`, `<red>-</red>`, `<yellow>\~</yellow>`) survive
    // verbatim because the WizardUI implementation owns rendering. The
    // assertions match the unrendered markdown source.
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
    expect(content).toContain(
      "│  │  ├─ <green>+</green> instrumentation-client.ts"
    );
    expect(content).toContain("│  │  └─ <yellow>\\~</yellow> layout.tsx");
    expect(content).toContain("└─ <yellow>\\~</yellow> next.config.js");
    const changedFilesSection = content.slice(content.indexOf("Changed files"));
    expect(changedFilesSection).toContain("│");
  });

  test("skips summary when result has no summary fields", () => {
    const { ui, calls } = createMockUI();
    formatResult({ status: "success" }, ui);

    expect(logMessage(calls)).toBeUndefined();
    expect(calls.some((c) => c.kind === "outro")).toBe(true);
  });

  test("displays warnings when present", () => {
    const { ui, calls } = createMockUI();
    formatResult(
      {
        status: "success",
        result: {
          warnings: ["Source maps not configured", "Missing DSN"],
        },
      },
      ui
    );

    const warns = warnMessages(calls);
    expect(warns).toContain("Source maps not configured");
    expect(warns).toContain("Missing DSN");
  });

  test("unwraps nested result property", () => {
    const { ui, calls } = createMockUI();
    formatResult({ status: "success", result: { platform: "React" } }, ui);

    expect(logMessage(calls)).toContain("React");
  });
});

describe("formatError", () => {
  test("logs the error message", () => {
    const { ui, calls } = createMockUI();
    formatError({ status: "failed", error: "Connection timed out" }, ui);

    expect(errorMessages(calls)).toContain("Connection timed out");
    const cancel = calls.find((c) => c.kind === "cancel");
    expect(cancel?.kind === "cancel" && cancel.message).toBe("Setup failed");
  });

  test("extracts message from nested result.message", () => {
    const { ui, calls } = createMockUI();
    formatError({ status: "failed", result: { message: "Inner failure" } }, ui);

    expect(errorMessages(calls)).toContain("Inner failure");
  });

  test("falls back to unknown error when no message available", () => {
    const { ui, calls } = createMockUI();
    formatError({ status: "failed" }, ui);

    expect(errorMessages(calls)).toContain(
      "Wizard failed with an unknown error"
    );
  });

  test("shows platform hint for detection failure exit code (20)", () => {
    const { ui, calls } = createMockUI();
    formatError({ status: "failed", result: { exitCode: 20 } }, ui);

    expect(warnMessages(calls).some((m) => m.includes("platform"))).toBe(true);
  });

  test("shows manual install commands for dependency failure (30)", () => {
    const { ui, calls } = createMockUI();
    formatError(
      {
        status: "failed",
        result: {
          exitCode: 30,
          commands: ["npm install @sentry/node"],
        },
      },
      ui
    );

    expect(
      warnMessages(calls).some((m) => m.includes("$ npm install @sentry/node"))
    ).toBe(true);
  });

  test("shows verification hint for exit code 50", () => {
    const { ui, calls } = createMockUI();
    formatError({ status: "failed", result: { exitCode: 50 } }, ui);

    expect(warnMessages(calls).some((m) => m.includes("verification"))).toBe(
      true
    );
  });

  test("shows docs URL when present", () => {
    const { ui, calls } = createMockUI();
    formatError(
      {
        status: "failed",
        result: { docsUrl: "https://docs.sentry.io/platforms/react/" },
      },
      ui
    );

    const infos = infoMessages(calls);
    expect(
      infos.some((s) => s.includes("https://docs.sentry.io/platforms/react/"))
    ).toBe(true);
  });
});
