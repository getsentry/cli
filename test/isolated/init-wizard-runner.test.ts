/**
 * Isolated tests for the init wizard runner.
 *
 * Uses mock.module() to stub heavy dependencies (MastraClient, clack, handlers,
 * auth, help). Kept isolated to avoid module-level mock leakage.
 */

import { beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import type {
  WizardOptions,
  WorkflowRunResult,
} from "../../src/lib/init/types.js";

// ── Clack mocks ────────────────────────────────────────────────────────────
const spinnerMock = {
  start: mock(),
  stop: mock(),
  message: mock(),
};
const introMock = mock();
const logMock = { info: mock(), warn: mock(), error: mock() };
const cancelMock = mock();

mock.module("@clack/prompts", () => ({
  spinner: () => spinnerMock,
  intro: introMock,
  log: logMock,
  cancel: cancelMock,
  note: mock(),
  outro: mock(),
  select: mock(),
  multiselect: mock(),
  confirm: mock(),
  isCancel: (v: unknown) => v === Symbol.for("cancel"),
}));

// ── Handler mocks ──────────────────────────────────────────────────────────
const mockHandleLocalOp = mock(() =>
  Promise.resolve({ ok: true, data: { results: [] } })
);
mock.module("../../src/lib/init/local-ops.js", () => ({
  handleLocalOp: mockHandleLocalOp,
  validateCommand: () => {
    /* noop mock */
  },
}));

const mockHandleInteractive = mock(() =>
  Promise.resolve({ action: "continue" })
);
mock.module("../../src/lib/init/interactive.js", () => ({
  handleInteractive: mockHandleInteractive,
}));

const mockFormatResult = mock();
const mockFormatError = mock();
mock.module("../../src/lib/init/formatters.js", () => ({
  formatResult: mockFormatResult,
  formatError: mockFormatError,
}));

mock.module("../../src/lib/db/auth.js", () => ({
  getAuthToken: () => "fake-token",
  isAuthenticated: () => Promise.resolve(false),
}));

mock.module("../../src/lib/help.js", () => ({
  formatBanner: () => "BANNER",
}));

// ── MastraClient mock ──────────────────────────────────────────────────────
let mockStartResult: WorkflowRunResult = { status: "success" };
let mockResumeResults: WorkflowRunResult[] = [];
let resumeCallCount = 0;
let startShouldThrow = false;

mock.module("@mastra/client-js", () => ({
  MastraClient: class {
    getWorkflow() {
      return {
        createRun: () =>
          Promise.resolve({
            startAsync: () => {
              if (startShouldThrow) {
                return Promise.reject(new Error("Connection refused"));
              }
              return Promise.resolve(mockStartResult);
            },
            resumeAsync: () => {
              const result = mockResumeResults[resumeCallCount] ?? {
                status: "success",
              };
              resumeCallCount += 1;
              return Promise.resolve(result);
            },
          }),
      };
    }
  },
}));

const { runWizard } = await import("../../src/lib/init/wizard-runner.js");

function makeOptions(overrides?: Partial<WizardOptions>): WizardOptions {
  return {
    directory: "/tmp/test",
    force: false,
    yes: true, // default to --yes to avoid TTY check
    dryRun: false,
    stdout: { write: () => true },
    stderr: { write: () => true },
    stdin: process.stdin,
    ...overrides,
  };
}

function resetAllMocks() {
  spinnerMock.start.mockClear();
  spinnerMock.stop.mockClear();
  spinnerMock.message.mockClear();
  introMock.mockClear();
  logMock.info.mockClear();
  logMock.warn.mockClear();
  logMock.error.mockClear();
  cancelMock.mockClear();
  mockHandleLocalOp.mockClear();
  mockHandleInteractive.mockClear();
  mockFormatResult.mockClear();
  mockFormatError.mockClear();

  mockStartResult = { status: "success" };
  mockResumeResults = [];
  resumeCallCount = 0;
  startShouldThrow = false;
}

describe("runWizard", () => {
  beforeEach(resetAllMocks);

  describe("TTY check", () => {
    test("writes error to stderr when not TTY and not --yes", async () => {
      const origIsTTY = process.stdin.isTTY;
      Object.defineProperty(process.stdin, "isTTY", {
        value: false,
        configurable: true,
      });

      const stderrSpy = spyOn(process.stderr, "write");

      await runWizard(makeOptions({ yes: false }));

      Object.defineProperty(process.stdin, "isTTY", {
        value: origIsTTY,
        configurable: true,
      });

      const written = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
      stderrSpy.mockRestore();

      expect(written).toContain("Interactive mode requires a terminal");

      // Clean up the exitCode set by the wizard
      process.exitCode = 0;
    });
  });

  describe("success path", () => {
    test("calls formatResult when workflow completes successfully", async () => {
      mockStartResult = { status: "success", result: { platform: "React" } };

      await runWizard(makeOptions());

      expect(mockFormatResult).toHaveBeenCalled();
      expect(mockFormatError).not.toHaveBeenCalled();
    });
  });

  describe("error paths", () => {
    test("calls formatError when workflow fails", async () => {
      mockStartResult = { status: "failed", error: "workflow exploded" };

      await runWizard(makeOptions());

      expect(mockFormatError).toHaveBeenCalled();
      expect(mockFormatResult).not.toHaveBeenCalled();
    });

    test("treats success with exitCode as error", async () => {
      mockStartResult = {
        status: "success",
        result: { exitCode: 10 } as unknown,
      };

      await runWizard(makeOptions());

      expect(mockFormatError).toHaveBeenCalled();
    });

    test("handles connection error gracefully", async () => {
      startShouldThrow = true;

      await runWizard(makeOptions());

      expect(logMock.error).toHaveBeenCalledWith("Connection refused");
      expect(cancelMock).toHaveBeenCalledWith("Setup failed");
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

      expect(mockHandleLocalOp).toHaveBeenCalled();
      const payload = mockHandleLocalOp.mock.calls[0][0] as {
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

      expect(mockHandleInteractive).toHaveBeenCalled();
      const payload = mockHandleInteractive.mock.calls[0][0] as {
        type: string;
        kind: string;
      };
      expect(payload.type).toBe("interactive");
      expect(payload.kind).toBe("multi-select");
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

      expect(mockHandleLocalOp).toHaveBeenCalled();
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

      // handleInteractive should NOT be called — dry-run auto-continues
      expect(mockHandleInteractive).not.toHaveBeenCalled();
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

      expect(logMock.error).toHaveBeenCalled();
      const errorMsg: string = logMock.error.mock.calls[0][0];
      expect(errorMsg).toContain("alien");
    });

    test("handles missing suspend payload", async () => {
      mockStartResult = {
        status: "suspended",
        suspended: [["empty-step"]],
        steps: {},
      };

      await runWizard(makeOptions());

      expect(logMock.error).toHaveBeenCalled();
      const errorMsg: string = logMock.error.mock.calls[0][0];
      expect(errorMsg).toContain("No suspend payload");
    });
  });

  describe("dry-run mode", () => {
    test("shows dry-run warning on start", async () => {
      mockStartResult = { status: "success" };

      await runWizard(makeOptions({ dryRun: true }));

      expect(logMock.warn).toHaveBeenCalled();
      const warnMsg: string = logMock.warn.mock.calls[0][0];
      expect(warnMsg).toContain("Dry-run");
    });
  });
});
