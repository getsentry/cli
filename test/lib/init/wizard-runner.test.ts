/**
 * Wizard Runner Unit Tests
 *
 * Tests for the init wizard runner using spyOn on namespace imports
 * (no mock.module) so these run under test:unit and contribute to
 * lcov coverage.
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
// biome-ignore lint/performance/noNamespaceImport: spyOn requires object reference
import * as clack from "@clack/prompts";
import { MastraClient } from "@mastra/client-js";
// biome-ignore lint/performance/noNamespaceImport: spyOn requires object reference
import * as auth from "../../../src/lib/db/auth.js";
// biome-ignore lint/performance/noNamespaceImport: spyOn requires object reference
import * as banner from "../../../src/lib/banner.js";
// biome-ignore lint/performance/noNamespaceImport: spyOn requires object reference
import * as fmt from "../../../src/lib/init/formatters.js";
// biome-ignore lint/performance/noNamespaceImport: spyOn requires object reference
import * as inter from "../../../src/lib/init/interactive.js";
// biome-ignore lint/performance/noNamespaceImport: spyOn requires object reference
import * as ops from "../../../src/lib/init/local-ops.js";
import type {
  WizardOptions,
  WorkflowRunResult,
} from "../../../src/lib/init/types.js";
import { runWizard } from "../../../src/lib/init/wizard-runner.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

const noop = () => {
  /* suppress output */
};

function makeOptions(overrides?: Partial<WizardOptions>): WizardOptions {
  return {
    directory: "/tmp/test",
    force: false,
    yes: true,
    dryRun: false,
    ...overrides,
  };
}

// ── Spy declarations ────────────────────────────────────────────────────────

// clack
let introSpy: ReturnType<typeof spyOn>;
let logInfoSpy: ReturnType<typeof spyOn>;
let logWarnSpy: ReturnType<typeof spyOn>;
let logErrorSpy: ReturnType<typeof spyOn>;
let cancelSpy: ReturnType<typeof spyOn>;
let spinnerSpy: ReturnType<typeof spyOn>;

// deps
let getAuthTokenSpy: ReturnType<typeof spyOn>;
let formatBannerSpy: ReturnType<typeof spyOn>;
let formatResultSpy: ReturnType<typeof spyOn>;
let formatErrorSpy: ReturnType<typeof spyOn>;
let handleLocalOpSpy: ReturnType<typeof spyOn>;
let handleInteractiveSpy: ReturnType<typeof spyOn>;

// MastraClient
let getWorkflowSpy: ReturnType<typeof spyOn>;

// stderr
let stderrSpy: ReturnType<typeof spyOn>;

// ── Mock workflow run ───────────────────────────────────────────────────────

let mockStartResult: WorkflowRunResult;
let mockResumeResults: WorkflowRunResult[];
let resumeCallCount: number;

const spinnerMock = {
  start: mock(),
  stop: mock(),
  message: mock(),
};

function setupWorkflowSpy() {
  const mockRun = {
    startAsync: mock(() => Promise.resolve(mockStartResult)),
    resumeAsync: mock(() => {
      const result = mockResumeResults[resumeCallCount] ?? {
        status: "success" as const,
      };
      resumeCallCount += 1;
      return Promise.resolve(result);
    }),
  };

  const mockWorkflow = {
    createRun: mock(() => Promise.resolve(mockRun)),
  };

  getWorkflowSpy = spyOn(MastraClient.prototype, "getWorkflow").mockReturnValue(
    mockWorkflow as any
  );

  return { mockRun, mockWorkflow };
}

// ── Setup / Teardown ────────────────────────────────────────────────────────

beforeEach(() => {
  mockStartResult = { status: "success" };
  mockResumeResults = [];
  resumeCallCount = 0;
  process.exitCode = 0;

  // clack spies
  introSpy = spyOn(clack, "intro").mockImplementation(noop);
  logInfoSpy = spyOn(clack.log, "info").mockImplementation(noop);
  logWarnSpy = spyOn(clack.log, "warn").mockImplementation(noop);
  logErrorSpy = spyOn(clack.log, "error").mockImplementation(noop);
  cancelSpy = spyOn(clack, "cancel").mockImplementation(noop);
  spinnerSpy = spyOn(clack, "spinner").mockReturnValue(spinnerMock as any);

  // Reset spinner mock call counts
  spinnerMock.start.mockClear();
  spinnerMock.stop.mockClear();
  spinnerMock.message.mockClear();

  // dep spies
  getAuthTokenSpy = spyOn(auth, "getAuthToken").mockReturnValue("fake-token");
  formatBannerSpy = spyOn(banner, "formatBanner").mockReturnValue("BANNER");
  formatResultSpy = spyOn(fmt, "formatResult").mockImplementation(noop);
  formatErrorSpy = spyOn(fmt, "formatError").mockImplementation(noop);
  handleLocalOpSpy = spyOn(ops, "handleLocalOp").mockResolvedValue({
    ok: true,
    data: { results: [] },
  });
  handleInteractiveSpy = spyOn(inter, "handleInteractive").mockResolvedValue({
    action: "continue",
  });

  // stderr spy (suppress banner output)
  stderrSpy = spyOn(process.stderr, "write").mockImplementation(
    () => true as any
  );

  // MastraClient
  setupWorkflowSpy();
});

afterEach(() => {
  introSpy.mockRestore();
  logInfoSpy.mockRestore();
  logWarnSpy.mockRestore();
  logErrorSpy.mockRestore();
  cancelSpy.mockRestore();
  spinnerSpy.mockRestore();

  getAuthTokenSpy.mockRestore();
  formatBannerSpy.mockRestore();
  formatResultSpy.mockRestore();
  formatErrorSpy.mockRestore();
  handleLocalOpSpy.mockRestore();
  handleInteractiveSpy.mockRestore();

  stderrSpy.mockRestore();
  getWorkflowSpy.mockRestore();

  process.exitCode = 0;
});

// ── Tests ───────────────────────────────────────────────────────────────────

describe("runWizard", () => {
  describe("success path", () => {
    test("calls formatResult when workflow completes successfully", async () => {
      mockStartResult = { status: "success", result: { platform: "React" } };

      await runWizard(makeOptions());

      expect(formatResultSpy).toHaveBeenCalled();
      expect(formatErrorSpy).not.toHaveBeenCalled();
      expect(spinnerMock.stop).toHaveBeenCalledWith("Done");
    });
  });

  describe("TTY check", () => {
    test("writes error to stderr when not TTY and not --yes", async () => {
      const origIsTTY = process.stdin.isTTY;
      Object.defineProperty(process.stdin, "isTTY", {
        value: false,
        configurable: true,
      });

      await runWizard(makeOptions({ yes: false }));

      Object.defineProperty(process.stdin, "isTTY", {
        value: origIsTTY,
        configurable: true,
      });

      const written = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
      expect(written).toContain("Interactive mode requires a terminal");
      expect(process.exitCode).toBe(1);
    });
  });

  describe("connection error", () => {
    test("handles startAsync rejection gracefully", async () => {
      const mockRun = {
        startAsync: mock(() => Promise.reject(new Error("Connection refused"))),
        resumeAsync: mock(),
      };
      const mockWorkflow = {
        createRun: mock(() => Promise.resolve(mockRun)),
      };
      getWorkflowSpy.mockReturnValue(mockWorkflow as any);

      await runWizard(makeOptions());

      expect(logErrorSpy).toHaveBeenCalledWith("Connection refused");
      expect(cancelSpy).toHaveBeenCalledWith("Setup failed");
      expect(process.exitCode).toBe(1);
    });
  });

  describe("workflow failure", () => {
    test("calls formatError when status is failed", async () => {
      mockStartResult = { status: "failed", error: "workflow exploded" };

      await runWizard(makeOptions());

      expect(formatErrorSpy).toHaveBeenCalled();
      expect(formatResultSpy).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(1);
    });
  });

  describe("success with exitCode", () => {
    test("treats success with exitCode as error", async () => {
      mockStartResult = {
        status: "success",
        result: { exitCode: 10 } as unknown,
      };

      await runWizard(makeOptions());

      expect(formatErrorSpy).toHaveBeenCalled();
      expect(process.exitCode).toBe(1);
    });
  });

  describe("dry-run mode", () => {
    test("shows dry-run warning on start", async () => {
      mockStartResult = { status: "success" };

      await runWizard(makeOptions({ dryRun: true }));

      expect(logWarnSpy).toHaveBeenCalled();
      const warnMsg: string = logWarnSpy.mock.calls[0][0];
      expect(warnMsg).toContain("Dry-run");
    });
  });

  describe("suspend/resume loop", () => {
    test("dispatches local-op payload to handleLocalOp", async () => {
      mockStartResult = {
        status: "suspended",
        suspended: [["detect-platform"]],
        steps: {
          "detect-platform": {
            suspendPayload: {
              type: "local-op",
              operation: "list-dir",
              cwd: "/app",
              params: { path: "." },
            },
          },
        },
      };
      mockResumeResults = [{ status: "success" }];

      await runWizard(makeOptions());

      expect(handleLocalOpSpy).toHaveBeenCalled();
      const payload = handleLocalOpSpy.mock.calls[0][0] as {
        type: string;
        operation: string;
      };
      expect(payload.type).toBe("local-op");
      expect(payload.operation).toBe("list-dir");
    });

    test("dispatches interactive payload to handleInteractive", async () => {
      mockStartResult = {
        status: "suspended",
        suspended: [["select-features"]],
        steps: {
          "select-features": {
            suspendPayload: {
              type: "interactive",
              kind: "multi-select",
              prompt: "Select features",
              availableFeatures: ["errorMonitoring"],
            },
          },
        },
      };
      mockResumeResults = [{ status: "success" }];

      await runWizard(makeOptions());

      expect(handleInteractiveSpy).toHaveBeenCalled();
      const payload = handleInteractiveSpy.mock.calls[0][0] as {
        type: string;
        kind: string;
      };
      expect(payload.type).toBe("interactive");
      expect(payload.kind).toBe("multi-select");
    });

    test("auto-continues verify-changes in dry-run mode", async () => {
      mockStartResult = {
        status: "suspended",
        suspended: [["verify-changes"]],
        steps: {
          "verify-changes": {
            suspendPayload: {
              type: "interactive",
              kind: "confirm",
              prompt: "Changes look good?",
            },
          },
        },
      };
      mockResumeResults = [{ status: "success" }];

      await runWizard(makeOptions({ dryRun: true }));

      expect(handleInteractiveSpy).not.toHaveBeenCalled();
    });

    test("handles unknown suspend payload type", async () => {
      mockStartResult = {
        status: "suspended",
        suspended: [["some-step"]],
        steps: {
          "some-step": {
            suspendPayload: { type: "alien", data: 42 },
          },
        },
      };

      await runWizard(makeOptions());

      expect(logErrorSpy).toHaveBeenCalled();
      const errorMsg: string = logErrorSpy.mock.calls[0][0];
      expect(errorMsg).toContain("alien");
      expect(process.exitCode).toBe(1);
    });

    test("handles missing suspend payload", async () => {
      mockStartResult = {
        status: "suspended",
        suspended: [["empty-step"]],
        steps: {},
      };

      await runWizard(makeOptions());

      expect(logErrorSpy).toHaveBeenCalled();
      const errorMsg: string = logErrorSpy.mock.calls[0][0];
      expect(errorMsg).toContain("No suspend payload");
      expect(process.exitCode).toBe(1);
    });

    test("non-WizardCancelledError in catch triggers log.error + cancel", async () => {
      handleLocalOpSpy.mockImplementation(() =>
        Promise.reject("string error")
      );

      mockStartResult = {
        status: "suspended",
        suspended: [["detect-platform"]],
        steps: {
          "detect-platform": {
            suspendPayload: {
              type: "local-op",
              operation: "list-dir",
              cwd: "/app",
              params: { path: "." },
            },
          },
        },
      };

      await runWizard(makeOptions());

      expect(logErrorSpy).toHaveBeenCalledWith("string error");
      expect(cancelSpy).toHaveBeenCalledWith("Setup failed");
      expect(process.exitCode).toBe(1);
    });

    test("falls back to result.suspendPayload when step payload missing", async () => {
      mockStartResult = {
        status: "suspended",
        suspended: [["unknown-step"]],
        steps: {},
        suspendPayload: {
          type: "local-op",
          operation: "read-files",
          cwd: "/app",
          params: { paths: ["package.json"] },
        },
      };
      mockResumeResults = [{ status: "success" }];

      await runWizard(makeOptions());

      expect(handleLocalOpSpy).toHaveBeenCalled();
    });

    test("falls back to iterating steps when stepId key not found", async () => {
      mockStartResult = {
        status: "suspended",
        suspended: [["step-a"]],
        steps: {
          "step-b": {
            suspendPayload: {
              type: "local-op",
              operation: "read-files",
              cwd: "/app",
              params: { paths: ["index.ts"] },
            },
          },
        },
      };
      mockResumeResults = [{ status: "success" }];

      await runWizard(makeOptions());

      expect(handleLocalOpSpy).toHaveBeenCalled();
    });

    test("handles multiple suspend/resume iterations", async () => {
      mockStartResult = {
        status: "suspended",
        suspended: [["detect-platform"]],
        steps: {
          "detect-platform": {
            suspendPayload: {
              type: "local-op",
              operation: "list-dir",
              cwd: "/app",
              params: { path: "." },
            },
          },
        },
      };
      mockResumeResults = [
        {
          status: "suspended",
          suspended: [["select-features"]],
          steps: {
            "select-features": {
              suspendPayload: {
                type: "interactive",
                kind: "multi-select",
                prompt: "Select features",
                availableFeatures: ["errorMonitoring"],
              },
            },
          },
        },
        { status: "success" },
      ];

      await runWizard(makeOptions());

      expect(handleLocalOpSpy).toHaveBeenCalledTimes(1);
      expect(handleInteractiveSpy).toHaveBeenCalledTimes(1);
      expect(formatResultSpy).toHaveBeenCalled();
    });
  });
});
