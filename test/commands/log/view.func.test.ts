/**
 * Log View Command Func Tests
 *
 * Tests for the viewCommand func() body in src/commands/log/view.ts.
 * Uses spyOn to mock api-client, resolve-target, and browser to test
 * the func() body without real HTTP calls or database access.
 */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from "bun:test";
import { viewCommand } from "../../../src/commands/log/view.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as apiClient from "../../../src/lib/api-client.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as browser from "../../../src/lib/browser.js";
import { ContextError, ValidationError } from "../../../src/lib/errors.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as resolveTarget from "../../../src/lib/resolve-target.js";
import type { DetailedSentryLog } from "../../../src/types/sentry.js";

const ID1 = "aaaa1111bbbb2222cccc3333dddd4444";
const ID2 = "1111222233334444555566667777aaaa";
const ID3 = "deadbeefdeadbeefdeadbeefdeadbeef";

function makeSampleLog(id: string, message = "Test log"): DetailedSentryLog {
  return {
    "sentry.item_id": id,
    timestamp: "2026-01-30T14:32:15+00:00",
    timestamp_precise: 1_770_060_419_044_800_300,
    message,
    severity: "info",
    trace: "abc123def456abc123def456abc12345",
    project: "test-project",
    environment: "production",
    release: "1.0.0",
    "sdk.name": "sentry.javascript.node",
    "sdk.version": "8.0.0",
    span_id: "span123abc",
    "code.function": "handleRequest",
    "code.file.path": "src/handlers/api.ts",
    "code.line.number": "42",
    "sentry.otel.kind": null,
    "sentry.otel.status_code": null,
    "sentry.otel.instrumentation_scope.name": null,
  };
}

function createMockContext() {
  const stdoutWrite = mock(() => true);
  return {
    context: {
      stdout: { write: stdoutWrite },
      stderr: { write: mock(() => true) },
      cwd: "/tmp",
      setContext: mock(() => {
        // no-op for test
      }),
    },
    stdoutWrite,
  };
}

describe("viewCommand.func", () => {
  let getLogsSpy: ReturnType<typeof spyOn>;
  let resolveOrgAndProjectSpy: ReturnType<typeof spyOn>;
  let resolveProjectBySlugSpy: ReturnType<typeof spyOn>;
  let openInBrowserSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    getLogsSpy = spyOn(apiClient, "getLogs");
    resolveOrgAndProjectSpy = spyOn(resolveTarget, "resolveOrgAndProject");
    resolveProjectBySlugSpy = spyOn(resolveTarget, "resolveProjectBySlug");
    openInBrowserSpy = spyOn(browser, "openInBrowser");
  });

  afterEach(() => {
    getLogsSpy.mockRestore();
    resolveOrgAndProjectSpy.mockRestore();
    resolveProjectBySlugSpy.mockRestore();
    openInBrowserSpy.mockRestore();
  });

  describe("single log ID", () => {
    test("explicit org/project outputs JSON for a single log", async () => {
      const log = makeSampleLog(ID1);
      getLogsSpy.mockResolvedValue([log]);

      const { context, stdoutWrite } = createMockContext();
      const func = await viewCommand.loader();
      await func.call(context, { json: true, web: false }, "my-org/proj", ID1);

      const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
      const parsed = JSON.parse(output);
      // Always emits array for consistent JSON shape
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed[0]["sentry.item_id"]).toBe(ID1);
    });

    test("explicit org/project outputs human-readable details", async () => {
      const log = makeSampleLog(ID1, "User login event");
      getLogsSpy.mockResolvedValue([log]);

      const { context, stdoutWrite } = createMockContext();
      const func = await viewCommand.loader();
      await func.call(context, { json: false, web: false }, "my-org/proj", ID1);

      const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
      expect(output).toContain(ID1);
    });

    test("throws ValidationError when log not found", async () => {
      getLogsSpy.mockResolvedValue([]);

      const { context } = createMockContext();
      const func = await viewCommand.loader();

      try {
        await func.call(
          context,
          { json: false, web: false },
          "my-org/proj",
          ID1
        );
        expect.unreachable("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationError);
        expect((error as ValidationError).message).toContain(ID1);
        expect((error as ValidationError).message).toContain("No log found");
      }
    });
  });

  describe("multiple log IDs", () => {
    test("fetches and outputs multiple logs as JSON array", async () => {
      const logs = [makeSampleLog(ID1, "Log 1"), makeSampleLog(ID2, "Log 2")];
      getLogsSpy.mockResolvedValue(logs);

      const { context, stdoutWrite } = createMockContext();
      const func = await viewCommand.loader();
      await func.call(
        context,
        { json: true, web: false },
        "my-org/proj",
        ID1,
        ID2
      );

      const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
      const parsed = JSON.parse(output);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed).toHaveLength(2);
      expect(parsed[0]["sentry.item_id"]).toBe(ID1);
      expect(parsed[1]["sentry.item_id"]).toBe(ID2);
    });

    test("outputs human-readable details with separators", async () => {
      const logs = [makeSampleLog(ID1, "Log 1"), makeSampleLog(ID2, "Log 2")];
      getLogsSpy.mockResolvedValue(logs);

      const { context, stdoutWrite } = createMockContext();
      const func = await viewCommand.loader();
      await func.call(
        context,
        { json: false, web: false },
        "my-org/proj",
        ID1,
        ID2
      );

      const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
      expect(output).toContain(ID1);
      expect(output).toContain(ID2);
      expect(output).toContain("---");
    });

    test("splits newline-separated IDs in a single argument", async () => {
      const logs = [makeSampleLog(ID1), makeSampleLog(ID2)];
      getLogsSpy.mockResolvedValue(logs);

      const combined = `${ID1}\n${ID2}`;
      const { context, stdoutWrite } = createMockContext();
      const func = await viewCommand.loader();
      await func.call(
        context,
        { json: true, web: false },
        "my-org/proj",
        combined
      );

      // getLogs should have been called with both IDs
      expect(getLogsSpy).toHaveBeenCalledWith("my-org", "proj", [ID1, ID2]);

      const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
      const parsed = JSON.parse(output);
      expect(parsed).toHaveLength(2);
    });

    test("still outputs found logs when some IDs are missing", async () => {
      // Only ID1 found, ID2 and ID3 missing — warning goes through consola
      getLogsSpy.mockResolvedValue([makeSampleLog(ID1)]);

      const { context, stdoutWrite } = createMockContext();
      const func = await viewCommand.loader();
      await func.call(
        context,
        { json: true, web: false },
        "my-org/proj",
        ID1,
        ID2,
        ID3
      );

      // Should still output the found log as JSON
      const stdoutOutput = stdoutWrite.mock.calls.map((c) => c[0]).join("");
      const parsed = JSON.parse(stdoutOutput);
      // Multiple IDs requested → array output even if only one found
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed).toHaveLength(1);
      expect(parsed[0]["sentry.item_id"]).toBe(ID1);
    });

    test("throws ValidationError when no logs found for multiple IDs", async () => {
      getLogsSpy.mockResolvedValue([]);

      const { context } = createMockContext();
      const func = await viewCommand.loader();

      try {
        await func.call(
          context,
          { json: false, web: false },
          "my-org/proj",
          ID1,
          ID2
        );
        expect.unreachable("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationError);
        const msg = (error as ValidationError).message;
        expect(msg).toContain("No logs found");
        // Each ID should appear in a markdown list item
        expect(msg).toContain(` - \`${ID1}\``);
        expect(msg).toContain(` - \`${ID2}\``);
      }
    });
  });

  describe("--web flag", () => {
    test("opens browser for single log ID", async () => {
      openInBrowserSpy.mockResolvedValue(undefined);

      const { context } = createMockContext();
      const func = await viewCommand.loader();
      await func.call(context, { json: false, web: true }, "my-org/proj", ID1);

      expect(openInBrowserSpy).toHaveBeenCalled();
      const url = openInBrowserSpy.mock.calls[0][1] as string;
      expect(url).toContain(ID1);
      // Should NOT fetch logs when using --web
      expect(getLogsSpy).not.toHaveBeenCalled();
    });

    test("refuses to open multiple tabs in non-interactive mode", async () => {
      openInBrowserSpy.mockResolvedValue(undefined);

      const { context } = createMockContext();
      const func = await viewCommand.loader();
      await func.call(
        context,
        { json: false, web: true },
        "my-org/proj",
        ID1,
        ID2
      );

      // Non-interactive (no TTY in tests) — should warn and not open any tabs
      expect(openInBrowserSpy).not.toHaveBeenCalled();
    });
  });

  describe("target resolution", () => {
    test("project-search resolves and fetches logs", async () => {
      resolveProjectBySlugSpy.mockResolvedValue({
        org: "resolved-org",
        project: "resolved-proj",
      });
      getLogsSpy.mockResolvedValue([makeSampleLog(ID1)]);

      const { context } = createMockContext();
      const func = await viewCommand.loader();
      await func.call(context, { json: true, web: false }, "my-project", ID1);

      expect(resolveProjectBySlugSpy).toHaveBeenCalled();
      expect(getLogsSpy).toHaveBeenCalledWith("resolved-org", "resolved-proj", [
        ID1,
      ]);
    });

    test("org/ target (org-all) throws ContextError", async () => {
      const { context } = createMockContext();
      const func = await viewCommand.loader();

      try {
        await func.call(context, { json: false, web: false }, "my-org/", ID1);
        expect.unreachable("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(ContextError);
        expect((error as ContextError).message).toContain("Specific project");
      }
    });

    test("sets telemetry context with resolved org and project", async () => {
      getLogsSpy.mockResolvedValue([makeSampleLog(ID1)]);

      const { context } = createMockContext();
      const func = await viewCommand.loader();
      await func.call(
        context,
        { json: true, web: false },
        "test-org/test-proj",
        ID1
      );

      expect(context.setContext).toHaveBeenCalledWith(
        ["test-org"],
        ["test-proj"]
      );
    });

    test("auto-detect resolves org/project and fetches logs", async () => {
      resolveOrgAndProjectSpy.mockResolvedValue({
        org: "detected-org",
        project: "detected-proj",
        detectedFrom: ".env file",
      });
      getLogsSpy.mockResolvedValue([makeSampleLog(ID1)]);

      const { context, stdoutWrite } = createMockContext();
      const func = await viewCommand.loader();
      // No target arg — triggers auto-detect
      await func.call(context, { json: false, web: false }, ID1);

      expect(resolveOrgAndProjectSpy).toHaveBeenCalled();
      expect(getLogsSpy).toHaveBeenCalledWith("detected-org", "detected-proj", [
        ID1,
      ]);

      // Human output should include the detected-from hint
      const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
      expect(output).toContain("Detected from .env file");
    });

    test("throws ContextError when auto-detect returns null", async () => {
      resolveOrgAndProjectSpy.mockResolvedValue(null);

      const { context } = createMockContext();
      const func = await viewCommand.loader();

      try {
        await func.call(context, { json: false, web: false }, ID1);
        expect.unreachable("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(ContextError);
        expect((error as ContextError).message).toContain(
          "Organization and project"
        );
      }
    });
  });
});
