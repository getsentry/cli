/**
 * Formatters Tests
 *
 * Tests for the init wizard output formatters. Uses `MockUI` to capture
 * every UI call.
 *
 * The previous implementation pushed pre-rendered markdown through
 * `ui.log.message`; these tests asserted on raw markdown strings. The
 * new implementation hands a structured `WizardSummary` to
 * `ui.summary()`, so the assertions look at fields and changedFiles
 * instead of rendered markup.
 */

import { describe, expect, test } from "bun:test";
import { formatError, formatResult } from "../../../src/lib/init/formatters.js";
import type { WizardSummary } from "../../../src/lib/init/ui/types.js";
import { createMockUI, type MockCall } from "./ui/mock-ui.js";

function summaryCall(calls: MockCall[]): WizardSummary | undefined {
  const call = calls.find((c) => c.kind === "summary");
  return call?.kind === "summary" ? call.summary : undefined;
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
  test("emits a structured summary with all fields and the changed-files list", () => {
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

    const summary = summaryCall(calls);
    expect(summary).toBeDefined();
    if (!summary) {
      throw new Error("expected summary call");
    }

    // Field order matches the source iteration in `buildSummary`.
    expect(summary.fields).toEqual([
      { label: "Platform", value: "Next.js" },
      { label: "Directory", value: "/app" },
      {
        label: "Features",
        value: "Error Monitoring, Performance Monitoring (Tracing)",
      },
      { label: "Commands", value: "npm install @sentry/nextjs" },
      { label: "Project", value: "https://sentry.io/project" },
      { label: "Docs", value: "https://docs.sentry.io" },
    ]);
    expect(summary.changedFiles).toEqual([
      { action: "modify", path: "next.config.js" },
      { action: "create", path: "src/app/instrumentation-client.ts" },
      { action: "modify", path: "src/app/layout.tsx" },
      { action: "delete", path: "src/old-sentry.js" },
    ]);
  });

  test("skips the summary call when result has no summary-worthy fields", () => {
    const { ui, calls } = createMockUI();
    formatResult({ status: "success" }, ui);

    expect(summaryCall(calls)).toBeUndefined();
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

    const summary = summaryCall(calls);
    expect(summary?.fields).toContainEqual({
      label: "Platform",
      value: "React",
    });
  });

  test("omits changedFiles when empty", () => {
    const { ui, calls } = createMockUI();
    formatResult(
      {
        status: "success",
        result: {
          platform: "React",
          changedFiles: [],
        },
      },
      ui
    );

    const summary = summaryCall(calls);
    expect(summary).toBeDefined();
    expect(summary?.changedFiles).toBeUndefined();
  });

  test("emits a summary with only changedFiles when no fields are populated", () => {
    const { ui, calls } = createMockUI();
    formatResult(
      {
        status: "success",
        result: {
          changedFiles: [{ action: "create", path: "instrument.ts" }],
        },
      },
      ui
    );

    const summary = summaryCall(calls);
    expect(summary).toEqual({
      fields: [],
      changedFiles: [{ action: "create", path: "instrument.ts" }],
    });
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
    const docsUrl = "https://docs.sentry.io/platforms/react/";
    formatError(
      {
        status: "failed",
        result: { docsUrl },
      },
      ui
    );

    // Pull every URL out of the info messages and check the docs URL
    // is among them. The previous `String.prototype.includes` form
    // tripped CodeQL's "incomplete URL substring sanitization" rule —
    // this regex-based extraction makes the URL-matching intent
    // explicit (and silences the false positive).
    const urlRe = /https?:\/\/[^\s)]+/g;
    const seenUrls = infoMessages(calls).flatMap(
      (msg) => msg.match(urlRe) ?? []
    );
    expect(seenUrls).toContain(docsUrl);
  });
});
