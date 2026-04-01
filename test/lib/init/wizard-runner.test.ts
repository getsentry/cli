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
  jest,
  mock,
  spyOn,
  test,
} from "bun:test";
// biome-ignore lint/performance/noNamespaceImport: spyOn requires object reference
import * as clack from "@clack/prompts";
import { MastraClient } from "@mastra/client-js";
// biome-ignore lint/performance/noNamespaceImport: spyOn requires object reference
import * as apiClient from "../../../src/lib/api-client.js";
// biome-ignore lint/performance/noNamespaceImport: spyOn requires object reference
import * as banner from "../../../src/lib/banner.js";
// biome-ignore lint/performance/noNamespaceImport: spyOn requires object reference
import * as auth from "../../../src/lib/db/auth.js";
// biome-ignore lint/performance/noNamespaceImport: spyOn requires object reference
import * as fmt from "../../../src/lib/init/formatters.js";
// biome-ignore lint/performance/noNamespaceImport: spyOn requires object reference
import * as git from "../../../src/lib/init/git.js";
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
    yes: true,
    dryRun: false,
    org: "test-org",
    ...overrides,
  };
}

// ── Spy declarations ────────────────────────────────────────────────────────

// clack
let isCancelSpy: ReturnType<typeof spyOn>;
let introSpy: ReturnType<typeof spyOn>;
let confirmSpy: ReturnType<typeof spyOn>;
let logInfoSpy: ReturnType<typeof spyOn>;
let logWarnSpy: ReturnType<typeof spyOn>;
let logErrorSpy: ReturnType<typeof spyOn>;
let cancelSpy: ReturnType<typeof spyOn>;
let selectSpy: ReturnType<typeof spyOn>;
let spinnerSpy: ReturnType<typeof spyOn>;

// git
let checkGitStatusSpy: ReturnType<typeof spyOn>;

// deps
let getAuthTokenSpy: ReturnType<typeof spyOn>;
let getAuthConfigSpy: ReturnType<typeof spyOn>;
let isAuthenticatedSpy: ReturnType<typeof spyOn>;
let formatBannerSpy: ReturnType<typeof spyOn>;
let formatResultSpy: ReturnType<typeof spyOn>;
let formatErrorSpy: ReturnType<typeof spyOn>;
let handleLocalOpSpy: ReturnType<typeof spyOn>;
let precomputeDirListingSpy: ReturnType<typeof spyOn>;
let handleInteractiveSpy: ReturnType<typeof spyOn>;
let listTeamsSpy: ReturnType<typeof spyOn>;

// MastraClient
let getWorkflowSpy: ReturnType<typeof spyOn>;

// stderr
let stderrSpy: ReturnType<typeof spyOn>;

// ── Mock workflow run ───────────────────────────────────────────────────────

let mockStartResult: WorkflowRunResult;
let mockResumeResults: WorkflowRunResult[];
let resumeCallCount: number;
let mockRun: {
  startAsync: ReturnType<typeof mock>;
  resumeAsync: ReturnType<typeof mock>;
};

const spinnerMock = {
  start: mock(),
  stop: mock(),
  message: mock(),
};

function setupWorkflowSpy() {
  mockRun = {
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

  return { mockWorkflow };
}

// ── Setup / Teardown ────────────────────────────────────────────────────────

let savedAuthToken: string | undefined;
beforeEach(() => {
  savedAuthToken = process.env.SENTRY_AUTH_TOKEN;
  delete process.env.SENTRY_AUTH_TOKEN;
});
afterEach(() => {
  if (savedAuthToken !== undefined) {
    process.env.SENTRY_AUTH_TOKEN = savedAuthToken;
  }
});

beforeEach(() => {
  mockStartResult = { status: "success" };
  mockResumeResults = [];
  resumeCallCount = 0;
  process.exitCode = 0;

  // clack spies
  isCancelSpy = spyOn(clack, "isCancel").mockImplementation(
    (v: unknown) => v === Symbol.for("cancel")
  );
  introSpy = spyOn(clack, "intro").mockImplementation(noop);
  confirmSpy = spyOn(clack, "confirm").mockResolvedValue(true);
  logInfoSpy = spyOn(clack.log, "info").mockImplementation(noop);
  logWarnSpy = spyOn(clack.log, "warn").mockImplementation(noop);
  logErrorSpy = spyOn(clack.log, "error").mockImplementation(noop);
  cancelSpy = spyOn(clack, "cancel").mockImplementation(noop);
  selectSpy = spyOn(clack, "select").mockResolvedValue("test-team");
  spinnerSpy = spyOn(clack, "spinner").mockReturnValue(spinnerMock as any);

  // Reset spinner mock call counts
  spinnerMock.start.mockClear();
  spinnerMock.stop.mockClear();
  spinnerMock.message.mockClear();

  // git spy — default: pass all checks
  checkGitStatusSpy = spyOn(git, "checkGitStatus").mockResolvedValue(true);

  // dep spies
  getAuthTokenSpy = spyOn(auth, "getAuthToken").mockReturnValue("fake-token");
  getAuthConfigSpy = spyOn(auth, "getAuthConfig").mockReturnValue({
    token: "fake-token",
    source: "oauth" as const,
  });
  isAuthenticatedSpy = spyOn(auth, "isAuthenticated").mockReturnValue(true);
  formatBannerSpy = spyOn(banner, "formatBanner").mockReturnValue("BANNER");
  formatResultSpy = spyOn(fmt, "formatResult").mockImplementation(noop);
  formatErrorSpy = spyOn(fmt, "formatError").mockImplementation(noop);
  handleLocalOpSpy = spyOn(ops, "handleLocalOp").mockResolvedValue({
    ok: true,
    data: { results: [] },
  });
  precomputeDirListingSpy = spyOn(ops, "precomputeDirListing").mockReturnValue(
    []
  );
  handleInteractiveSpy = spyOn(inter, "handleInteractive").mockResolvedValue({
    action: "continue",
  });
  listTeamsSpy = spyOn(apiClient, "listTeams").mockResolvedValue([]);

  // stderr spy (suppress banner output)
  stderrSpy = spyOn(process.stderr, "write").mockImplementation(
    () => true as any
  );

  // MastraClient
  setupWorkflowSpy();
});

afterEach(() => {
  isCancelSpy.mockRestore();
  introSpy.mockRestore();
  confirmSpy.mockRestore();
  logInfoSpy.mockRestore();
  logWarnSpy.mockRestore();
  logErrorSpy.mockRestore();
  cancelSpy.mockRestore();
  selectSpy.mockRestore();
  spinnerSpy.mockRestore();

  checkGitStatusSpy.mockRestore();
  getAuthTokenSpy.mockRestore();
  getAuthConfigSpy.mockRestore();
  isAuthenticatedSpy.mockRestore();
  formatBannerSpy.mockRestore();
  formatResultSpy.mockRestore();
  formatErrorSpy.mockRestore();
  handleLocalOpSpy.mockRestore();
  precomputeDirListingSpy.mockRestore();
  handleInteractiveSpy.mockRestore();
  listTeamsSpy.mockRestore();

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

  describe("experimental warning", () => {
    test("shows experimental warning and proceeds on confirm", async () => {
      const origIsTTY = process.stdin.isTTY;
      Object.defineProperty(process.stdin, "isTTY", {
        value: true,
        configurable: true,
      });

      mockStartResult = { status: "success" };

      await runWizard(makeOptions({ yes: false }));

      Object.defineProperty(process.stdin, "isTTY", {
        value: origIsTTY,
        configurable: true,
      });

      expect(confirmSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining("EXPERIMENTAL"),
        })
      );
      expect(formatResultSpy).toHaveBeenCalled();
    });

    test("skips experimental warning with --yes", async () => {
      mockStartResult = { status: "success" };

      await runWizard(makeOptions({ yes: true }));

      expect(confirmSpy).not.toHaveBeenCalled();
      expect(formatResultSpy).toHaveBeenCalled();
    });

    test("exits cleanly when user presses Ctrl+C on experimental warning", async () => {
      const origIsTTY = process.stdin.isTTY;
      Object.defineProperty(process.stdin, "isTTY", {
        value: true,
        configurable: true,
      });

      confirmSpy.mockResolvedValue(Symbol.for("cancel"));

      await runWizard(makeOptions({ yes: false }));

      Object.defineProperty(process.stdin, "isTTY", {
        value: origIsTTY,
        configurable: true,
      });

      expect(cancelSpy).toHaveBeenCalledWith(
        expect.stringContaining("Setup cancelled")
      );
      expect(process.exitCode).toBe(0);
      expect(formatResultSpy).not.toHaveBeenCalled();
    });

    test("exits cleanly when user declines experimental warning", async () => {
      const origIsTTY = process.stdin.isTTY;
      Object.defineProperty(process.stdin, "isTTY", {
        value: true,
        configurable: true,
      });

      confirmSpy.mockResolvedValue(false);

      await runWizard(makeOptions({ yes: false }));

      Object.defineProperty(process.stdin, "isTTY", {
        value: origIsTTY,
        configurable: true,
      });

      expect(cancelSpy).toHaveBeenCalledWith("Setup cancelled.");
      expect(process.exitCode).toBe(0);
      expect(formatResultSpy).not.toHaveBeenCalled();
    });
  });

  describe("connection error", () => {
    test("times out if startAsync hangs", async () => {
      jest.useFakeTimers();

      const hangingRun = {
        startAsync: mock(
          () =>
            new Promise(() => {
              /* never resolves */
            })
        ),
        resumeAsync: mock(),
      };
      const hangingWorkflow = {
        createRun: mock(() => Promise.resolve(hangingRun)),
      };
      getWorkflowSpy.mockReturnValue(hangingWorkflow as any);

      const { API_TIMEOUT_MS } = await import(
        "../../../src/lib/init/constants.js"
      );

      const promise = runWizard(makeOptions());

      // Flush microtasks so runWizard reaches the withTimeout setTimeout.
      // preamble() → confirmExperimental() → checkGitStatus() → createRun()
      // each need a tick.
      for (let i = 0; i < 10; i++) await Promise.resolve();

      // Advance past the timeout
      jest.advanceTimersByTime(API_TIMEOUT_MS);

      await promise;

      expect(logErrorSpy).toHaveBeenCalled();
      const errorMsg: string = logErrorSpy.mock.calls[0][0];
      expect(errorMsg).toContain("timed out");
      expect(process.exitCode).toBe(1);

      jest.useRealTimers();
    });

    test("handles startAsync rejection gracefully", async () => {
      const failingRun = {
        startAsync: mock(() => Promise.reject(new Error("Connection refused"))),
        resumeAsync: mock(),
      };
      const mockWorkflow = {
        createRun: mock(() => Promise.resolve(failingRun)),
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
        result: { exitCode: 10 },
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

  describe("git safety check", () => {
    test("calls checkGitStatus with directory and yes from options", async () => {
      mockStartResult = { status: "success" };

      await runWizard(makeOptions({ directory: "/my/project", yes: true }));

      expect(checkGitStatusSpy).toHaveBeenCalledWith({
        cwd: "/my/project",
        yes: true,
      });
    });

    test("aborts gracefully when checkGitStatus returns false", async () => {
      checkGitStatusSpy.mockResolvedValue(false);
      const origIsTTY = process.stdin.isTTY;
      Object.defineProperty(process.stdin, "isTTY", {
        value: true,
        configurable: true,
      });

      await runWizard(makeOptions({ yes: false }));

      Object.defineProperty(process.stdin, "isTTY", {
        value: origIsTTY,
        configurable: true,
      });

      expect(cancelSpy).toHaveBeenCalledWith("Setup cancelled.");
      expect(process.exitCode).toBe(0);
      // Should not proceed to workflow
      expect(getWorkflowSpy).not.toHaveBeenCalled();
    });

    test("continues to workflow when checkGitStatus returns true", async () => {
      checkGitStatusSpy.mockResolvedValue(true);
      mockStartResult = { status: "success" };

      await runWizard(makeOptions());

      expect(checkGitStatusSpy).toHaveBeenCalled();
      expect(formatResultSpy).toHaveBeenCalled();
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

    test("uses detail field for spinner message when present", async () => {
      mockStartResult = {
        status: "suspended",
        suspended: [["install-deps"]],
        steps: {
          "install-deps": {
            suspendPayload: {
              type: "local-op",
              operation: "run-commands",
              detail: "npm install @sentry/nextjs @sentry/profiling-node",
              cwd: "/app",
              params: {
                commands: ["npm install @sentry/nextjs @sentry/profiling-node"],
              },
            },
          },
        },
      };
      mockResumeResults = [{ status: "success" }];

      await runWizard(makeOptions());

      expect(spinnerMock.message).toHaveBeenCalledWith(
        "npm install @sentry/nextjs @sentry/profiling-node"
      );
    });

    test("falls back to generic message when detail is absent", async () => {
      mockStartResult = {
        status: "suspended",
        suspended: [["install-deps"]],
        steps: {
          "install-deps": {
            suspendPayload: {
              type: "local-op",
              operation: "run-commands",
              cwd: "/app",
              params: { commands: ["npm install @sentry/nextjs"] },
            },
          },
        },
      };
      mockResumeResults = [{ status: "success" }];

      await runWizard(makeOptions());

      expect(spinnerMock.message).toHaveBeenCalledWith(
        "Installing dependencies (run-commands)..."
      );
    });

    test("truncates detail message when terminal is narrow", async () => {
      const origColumns = process.stdout.columns;
      Object.defineProperty(process.stdout, "columns", {
        value: 40,
        configurable: true,
      });

      const longDetail =
        "npm install @sentry/nextjs @sentry/profiling-node @sentry/browser";
      mockStartResult = {
        status: "suspended",
        suspended: [["install-deps"]],
        steps: {
          "install-deps": {
            suspendPayload: {
              type: "local-op",
              operation: "run-commands",
              detail: longDetail,
              cwd: "/app",
              params: { commands: [longDetail] },
            },
          },
        },
      };
      mockResumeResults = [{ status: "success" }];

      try {
        await runWizard(makeOptions());

        // 40 columns - 4 reserved = 36 max, truncated with "…"
        const call = spinnerMock.message.mock.calls.find((c: string[]) =>
          c[0]?.includes("npm install")
        ) as string[] | undefined;
        expect(call).toBeDefined();
        const msg = call?.[0] ?? "";
        expect(msg.length).toBeLessThanOrEqual(36);
        expect(msg.endsWith("…")).toBe(true);
      } finally {
        Object.defineProperty(process.stdout, "columns", {
          value: origColumns,
          configurable: true,
        });
      }
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
      handleLocalOpSpy.mockImplementation(() => Promise.reject("string error"));

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
      // resumeAsync should be called with the actual key ("step-b"), not the
      // original stepId ("step-a") from result.suspended
      expect(mockRun.resumeAsync).toHaveBeenCalledWith(
        expect.objectContaining({ step: "step-b" })
      );
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

  describe("malformed server responses", () => {
    test("rejects non-object response from startAsync", async () => {
      const badRun = {
        startAsync: mock(() => Promise.resolve("not an object")),
        resumeAsync: mock(),
      };
      const badWorkflow = {
        createRun: mock(() => Promise.resolve(badRun)),
      };
      getWorkflowSpy.mockReturnValue(badWorkflow as any);

      await runWizard(makeOptions());

      expect(logErrorSpy).toHaveBeenCalledWith(
        "Invalid workflow response: expected object"
      );
      expect(process.exitCode).toBe(1);
    });

    test("rejects response with invalid status", async () => {
      const badRun = {
        startAsync: mock(() =>
          Promise.resolve({ status: "banana", result: {} })
        ),
        resumeAsync: mock(),
      };
      const badWorkflow = {
        createRun: mock(() => Promise.resolve(badRun)),
      };
      getWorkflowSpy.mockReturnValue(badWorkflow as any);

      await runWizard(makeOptions());

      expect(logErrorSpy).toHaveBeenCalledWith(
        "Unexpected workflow status: banana"
      );
      expect(process.exitCode).toBe(1);
    });

    test("rejects null response from startAsync", async () => {
      const badRun = {
        startAsync: mock(() => Promise.resolve(null)),
        resumeAsync: mock(),
      };
      const badWorkflow = {
        createRun: mock(() => Promise.resolve(badRun)),
      };
      getWorkflowSpy.mockReturnValue(badWorkflow as any);

      await runWizard(makeOptions());

      expect(logErrorSpy).toHaveBeenCalledWith(
        "Invalid workflow response: expected object"
      );
      expect(process.exitCode).toBe(1);
    });
  });
});
