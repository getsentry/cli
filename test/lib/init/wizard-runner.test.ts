/**
 * Wizard Runner Tests
 *
 * Tests for the init wizard runner. Uses spyOn on namespace imports
 * to stub heavy dependencies (MastraClient, clack, handlers, auth, help).
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
// biome-ignore lint/performance/noNamespaceImport: spyOn requires object reference
import * as mastraModule from "@mastra/client-js";
// biome-ignore lint/performance/noNamespaceImport: spyOn requires object reference
import * as authModule from "../../../src/lib/db/auth.js";
// biome-ignore lint/performance/noNamespaceImport: spyOn requires object reference
import * as helpModule from "../../../src/lib/help.js";
// biome-ignore lint/performance/noNamespaceImport: spyOn requires object reference
import * as formattersModule from "../../../src/lib/init/formatters.js";
// biome-ignore lint/performance/noNamespaceImport: spyOn requires object reference
import * as interactiveModule from "../../../src/lib/init/interactive.js";
// biome-ignore lint/performance/noNamespaceImport: spyOn requires object reference
import * as localOpsModule from "../../../src/lib/init/local-ops.js";
import type {
  WizardOptions,
  WorkflowRunResult,
} from "../../../src/lib/init/types.js";
import { runWizard } from "../../../src/lib/init/wizard-runner.js";

const noop = () => {
  /* suppress output */
};

// ── Clack spinner mock ──────────────────────────────────────────────────────
const spinnerMock = {
  start: mock(),
  stop: mock(),
  message: mock(),
};

// ── Spy references ──────────────────────────────────────────────────────────
let spinnerSpy: ReturnType<typeof spyOn>;
let introSpy: ReturnType<typeof spyOn>;
let logInfoSpy: ReturnType<typeof spyOn>;
let logWarnSpy: ReturnType<typeof spyOn>;
let logErrorSpy: ReturnType<typeof spyOn>;
let cancelSpy: ReturnType<typeof spyOn>;
let handleLocalOpSpy: ReturnType<typeof spyOn>;
let handleInteractiveSpy: ReturnType<typeof spyOn>;
let formatResultSpy: ReturnType<typeof spyOn>;
let formatErrorSpy: ReturnType<typeof spyOn>;
let getAuthTokenSpy: ReturnType<typeof spyOn>;
let formatBannerSpy: ReturnType<typeof spyOn>;
let mastraClientSpy: ReturnType<typeof spyOn>;

// ── Workflow state ──────────────────────────────────────────────────────────
let mockStartResult: WorkflowRunResult;
let mockResumeResults: WorkflowRunResult[];
let resumeCallCount: number;
let startShouldThrow: boolean;

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

beforeEach(() => {
  // Reset workflow state
  mockStartResult = { status: "success" };
  mockResumeResults = [];
  resumeCallCount = 0;
  startShouldThrow = false;

  // Clack spies
  spinnerMock.start.mockClear();
  spinnerMock.stop.mockClear();
  spinnerMock.message.mockClear();

  spinnerSpy = spyOn(clack, "spinner").mockReturnValue(spinnerMock as any);
  introSpy = spyOn(clack, "intro").mockImplementation(noop);
  logInfoSpy = spyOn(clack.log, "info").mockImplementation(noop);
  logWarnSpy = spyOn(clack.log, "warn").mockImplementation(noop);
  logErrorSpy = spyOn(clack.log, "error").mockImplementation(noop);
  cancelSpy = spyOn(clack, "cancel").mockImplementation(noop);

  // Handler spies
  handleLocalOpSpy = spyOn(localOpsModule, "handleLocalOp").mockImplementation(
    () => Promise.resolve({ ok: true, data: { results: [] } }) as any
  );
  handleInteractiveSpy = spyOn(
    interactiveModule,
    "handleInteractive"
  ).mockImplementation(() => Promise.resolve({ action: "continue" }) as any);

  // Formatter spies
  formatResultSpy = spyOn(formattersModule, "formatResult").mockImplementation(
    noop
  );
  formatErrorSpy = spyOn(formattersModule, "formatError").mockImplementation(
    noop
  );

  // Auth & help spies
  getAuthTokenSpy = spyOn(authModule, "getAuthToken").mockReturnValue(
    "fake-token" as any
  );
  formatBannerSpy = spyOn(helpModule, "formatBanner").mockReturnValue(
    "BANNER" as any
  );

  // MastraClient spy — mockImplementation returns an object, so `new` uses it
  mastraClientSpy = spyOn(mastraModule, "MastraClient").mockImplementation(
    () =>
      ({
        getWorkflow: () => ({
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
        }),
      }) as any
  );
});

afterEach(() => {
  spinnerSpy.mockRestore();
  introSpy.mockRestore();
  logInfoSpy.mockRestore();
  logWarnSpy.mockRestore();
  logErrorSpy.mockRestore();
  cancelSpy.mockRestore();
  handleLocalOpSpy.mockRestore();
  handleInteractiveSpy.mockRestore();
  formatResultSpy.mockRestore();
  formatErrorSpy.mockRestore();
  getAuthTokenSpy.mockRestore();
  formatBannerSpy.mockRestore();
  mastraClientSpy.mockRestore();
});

describe("runWizard", () => {
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

      expect(formatResultSpy).toHaveBeenCalled();
      expect(formatErrorSpy).not.toHaveBeenCalled();
    });
  });

  describe("error paths", () => {
    test("calls formatError when workflow fails", async () => {
      mockStartResult = { status: "failed", error: "workflow exploded" };

      await runWizard(makeOptions());

      expect(formatErrorSpy).toHaveBeenCalled();
      expect(formatResultSpy).not.toHaveBeenCalled();
    });

    test("treats success with exitCode as error", async () => {
      mockStartResult = {
        status: "success",
        result: { exitCode: 10 } as unknown,
      };

      await runWizard(makeOptions());

      expect(formatErrorSpy).toHaveBeenCalled();
    });

    test("handles connection error gracefully", async () => {
      startShouldThrow = true;

      await runWizard(makeOptions());

      expect(logErrorSpy).toHaveBeenCalledWith("Connection refused");
      expect(cancelSpy).toHaveBeenCalledWith("Setup failed");
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
    });

    test("handles multiple suspend/resume iterations", async () => {
      // First iteration: local-op, second: interactive, third: success
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

    test("handles non-Error exception in catch block", async () => {
      handleLocalOpSpy.mockImplementationOnce(() =>
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
    });

    test("falls back to iterating steps when stepId key not found", async () => {
      // The suspend path references "step-a" but the payload is under "step-b"
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
});
