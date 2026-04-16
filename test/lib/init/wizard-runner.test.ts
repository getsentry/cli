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
import * as banner from "../../../src/lib/banner.js";
import { WizardError } from "../../../src/lib/errors.js";
// biome-ignore lint/performance/noNamespaceImport: spyOn requires object reference
import * as fmt from "../../../src/lib/init/formatters.js";
// biome-ignore lint/performance/noNamespaceImport: spyOn requires object reference
import * as git from "../../../src/lib/init/git.js";
// biome-ignore lint/performance/noNamespaceImport: spyOn requires object reference
import * as inter from "../../../src/lib/init/interactive.js";
// biome-ignore lint/performance/noNamespaceImport: spyOn requires object reference
import * as preflight from "../../../src/lib/init/preflight.js";
// biome-ignore lint/performance/noNamespaceImport: spyOn requires object reference
import * as registry from "../../../src/lib/init/tools/registry.js";
import type {
  ResolvedInitContext,
  ToolPayload,
  WizardOptions,
  WorkflowRunResult,
} from "../../../src/lib/init/types.js";
import { runWizard } from "../../../src/lib/init/wizard-runner.js";
// biome-ignore lint/performance/noNamespaceImport: spyOn requires object reference
import * as workflowInputs from "../../../src/lib/init/workflow-inputs.js";

const noop = () => {
  /* suppress output */
};

const spinnerMock = {
  start: mock(),
  stop: mock(),
  message: mock(),
};

function makeOptions(overrides?: Partial<WizardOptions>): WizardOptions {
  return {
    directory: "/tmp/test",
    yes: true,
    dryRun: false,
    ...overrides,
  };
}

function makeContext(
  overrides?: Partial<ResolvedInitContext>
): ResolvedInitContext {
  return {
    directory: "/tmp/test",
    yes: true,
    dryRun: false,
    org: "acme",
    team: "platform",
    authToken: "test-token",
    ...overrides,
  };
}

let mockStartResult: WorkflowRunResult;
let mockResumeResults: WorkflowRunResult[];
let resumeCallCount = 0;

let introSpy: ReturnType<typeof spyOn>;
let confirmSpy: ReturnType<typeof spyOn>;
let cancelSpy: ReturnType<typeof spyOn>;
let logInfoSpy: ReturnType<typeof spyOn>;
let logWarnSpy: ReturnType<typeof spyOn>;
let logErrorSpy: ReturnType<typeof spyOn>;
let spinnerSpy: ReturnType<typeof spyOn>;

let formatBannerSpy: ReturnType<typeof spyOn>;
let formatResultSpy: ReturnType<typeof spyOn>;
let formatErrorSpy: ReturnType<typeof spyOn>;
let checkGitStatusSpy: ReturnType<typeof spyOn>;
let handleInteractiveSpy: ReturnType<typeof spyOn>;
let resolveInitContextSpy: ReturnType<typeof spyOn>;
let describeToolSpy: ReturnType<typeof spyOn>;
let executeToolSpy: ReturnType<typeof spyOn>;
let precomputeDirListingSpy: ReturnType<typeof spyOn>;
let preReadCommonFilesSpy: ReturnType<typeof spyOn>;
let precomputeSentryDetectionSpy: ReturnType<typeof spyOn>;
let getWorkflowSpy: ReturnType<typeof spyOn>;
let stderrSpy: ReturnType<typeof spyOn>;

beforeEach(() => {
  mockStartResult = { status: "success", result: { platform: "React" } };
  mockResumeResults = [];
  resumeCallCount = 0;
  process.exitCode = 0;

  introSpy = spyOn(clack, "intro").mockImplementation(noop);
  confirmSpy = spyOn(clack, "confirm").mockResolvedValue(true);
  cancelSpy = spyOn(clack, "cancel").mockImplementation(noop);
  logInfoSpy = spyOn(clack.log, "info").mockImplementation(noop);
  logWarnSpy = spyOn(clack.log, "warn").mockImplementation(noop);
  logErrorSpy = spyOn(clack.log, "error").mockImplementation(noop);
  spinnerSpy = spyOn(clack, "spinner").mockReturnValue(spinnerMock as any);

  spinnerMock.start.mockClear();
  spinnerMock.stop.mockClear();
  spinnerMock.message.mockClear();

  formatBannerSpy = spyOn(banner, "formatBanner").mockReturnValue("BANNER");
  formatResultSpy = spyOn(fmt, "formatResult").mockImplementation(noop);
  formatErrorSpy = spyOn(fmt, "formatError").mockImplementation(noop);
  checkGitStatusSpy = spyOn(git, "checkGitStatus").mockResolvedValue(true);
  handleInteractiveSpy = spyOn(inter, "handleInteractive").mockResolvedValue({
    action: "continue",
  });
  resolveInitContextSpy = spyOn(
    preflight,
    "resolveInitContext"
  ).mockResolvedValue(makeContext());
  describeToolSpy = spyOn(registry, "describeTool").mockReturnValue(
    "Running tool..."
  );
  executeToolSpy = spyOn(registry, "executeTool").mockResolvedValue({
    ok: true,
    data: { results: [] },
  });
  precomputeDirListingSpy = spyOn(
    workflowInputs,
    "precomputeDirListing"
  ).mockResolvedValue([]);
  preReadCommonFilesSpy = spyOn(
    workflowInputs,
    "preReadCommonFiles"
  ).mockResolvedValue({});
  precomputeSentryDetectionSpy = spyOn(
    workflowInputs,
    "precomputeSentryDetection"
  ).mockResolvedValue({
    ok: true,
    data: { status: "none", signals: [] },
  });
  stderrSpy = spyOn(process.stderr, "write").mockImplementation(
    () => true as any
  );

  const run = {
    startAsync: mock(() => Promise.resolve(mockStartResult)),
    resumeAsync: mock(() => {
      const result = mockResumeResults[resumeCallCount] ?? { status: "success" };
      resumeCallCount += 1;
      return Promise.resolve(result);
    }),
  };
  const workflow = {
    createRun: mock(() => Promise.resolve(run)),
  };
  getWorkflowSpy = spyOn(MastraClient.prototype, "getWorkflow").mockReturnValue(
    workflow as any
  );
});

afterEach(() => {
  introSpy.mockRestore();
  confirmSpy.mockRestore();
  cancelSpy.mockRestore();
  logInfoSpy.mockRestore();
  logWarnSpy.mockRestore();
  logErrorSpy.mockRestore();
  spinnerSpy.mockRestore();

  formatBannerSpy.mockRestore();
  formatResultSpy.mockRestore();
  formatErrorSpy.mockRestore();
  checkGitStatusSpy.mockRestore();
  handleInteractiveSpy.mockRestore();
  resolveInitContextSpy.mockRestore();
  describeToolSpy.mockRestore();
  executeToolSpy.mockRestore();
  precomputeDirListingSpy.mockRestore();
  preReadCommonFilesSpy.mockRestore();
  precomputeSentryDetectionSpy.mockRestore();
  getWorkflowSpy.mockRestore();
  stderrSpy.mockRestore();

  process.exitCode = 0;
});

describe("runWizard", () => {
  test("formats successful results", async () => {
    await runWizard(makeOptions());

    expect(formatResultSpy).toHaveBeenCalled();
    expect(formatErrorSpy).not.toHaveBeenCalled();
    expect(spinnerMock.stop).toHaveBeenCalledWith("Done");
  });

  test("throws when stdin is not a TTY without --yes", async () => {
    const originalIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", {
      value: false,
      configurable: true,
    });

    await expect(runWizard(makeOptions({ yes: false }))).rejects.toThrow(
      WizardError
    );

    Object.defineProperty(process.stdin, "isTTY", {
      value: originalIsTTY,
      configurable: true,
    });
  });

  test("passes dry-run as non-interactive into preflight", async () => {
    await runWizard(makeOptions({ dryRun: true, yes: false }));

    expect(resolveInitContextSpy).toHaveBeenCalledWith(
      expect.objectContaining({ dryRun: true, yes: true })
    );
    expect(logWarnSpy).toHaveBeenCalled();
  });

  test("stops before workflow creation when preflight returns null", async () => {
    resolveInitContextSpy.mockResolvedValue(null);

    await runWizard(makeOptions());

    expect(getWorkflowSpy).not.toHaveBeenCalled();
    expect(formatResultSpy).not.toHaveBeenCalled();
  });

  test("aborts cleanly when git safety check fails", async () => {
    checkGitStatusSpy.mockResolvedValue(false);

    await runWizard(makeOptions());

    expect(cancelSpy).toHaveBeenCalledWith("Setup cancelled.");
    expect(getWorkflowSpy).not.toHaveBeenCalled();
  });

  test("dispatches tool payloads through the registry", async () => {
    const payload: ToolPayload = {
      type: "tool",
      operation: "run-commands",
      cwd: "/tmp/test",
      params: { commands: ["npm install @sentry/node"] },
    };
    mockStartResult = {
      status: "suspended",
      suspended: [["install-deps"]],
      steps: {
        "install-deps": { suspendPayload: payload },
      },
    };
    mockResumeResults = [{ status: "success" }];

    await runWizard(makeOptions());

    expect(describeToolSpy).toHaveBeenCalledWith(payload);
    expect(executeToolSpy).toHaveBeenCalledWith(payload, makeContext());
    expect(spinnerMock.message).toHaveBeenCalledWith("Running tool...");
  });

  test("dispatches interactive payloads to the prompt handler", async () => {
    mockStartResult = {
      status: "suspended",
      suspended: [["pick-feature"]],
      steps: {
        "pick-feature": {
          suspendPayload: {
            type: "interactive",
            kind: "confirm",
            prompt: "Continue?",
          },
        },
      },
    };
    mockResumeResults = [{ status: "success" }];

    await runWizard(makeOptions());

    expect(handleInteractiveSpy).toHaveBeenCalledWith(
      {
        type: "interactive",
        kind: "confirm",
        prompt: "Continue?",
      },
      makeContext()
    );
  });

  test("skips verify-changes interactive prompts during dry-run", async () => {
    resolveInitContextSpy.mockResolvedValue(makeContext({ dryRun: true }));
    mockStartResult = {
      status: "suspended",
      suspended: [["verify-changes"]],
      steps: {
        "verify-changes": {
          suspendPayload: {
            type: "interactive",
            kind: "confirm",
            prompt: "Verify changes?",
          },
        },
      },
    };
    mockResumeResults = [{ status: "success" }];

    await runWizard(makeOptions({ dryRun: true }));

    expect(handleInteractiveSpy).not.toHaveBeenCalled();
  });

  test("surfaces malformed suspend payload types", async () => {
    mockStartResult = {
      status: "suspended",
      suspended: [["detect-platform"]],
      steps: {
        "detect-platform": {
          suspendPayload: {
            type: "unknown",
            operation: "list-dir",
            cwd: "/tmp/test",
            params: { path: "." },
          },
        },
      },
    };

    await expect(runWizard(makeOptions())).rejects.toThrow(WizardError);
  });

  test("fails when a suspended step has no payload", async () => {
    mockStartResult = {
      status: "suspended",
      suspended: [["detect-platform"]],
      steps: {
        "detect-platform": {},
      },
    };

    await expect(runWizard(makeOptions())).rejects.toThrow(WizardError);
  });

  test("renders tool result messages via the spinner stop state", async () => {
    mockStartResult = {
      status: "suspended",
      suspended: [["ensure-sentry-project"]],
      steps: {
        "ensure-sentry-project": {
          suspendPayload: {
            type: "tool",
            operation: "create-sentry-project",
            cwd: "/tmp/test",
            params: { name: "my-app", platform: "javascript-react" },
          },
        },
      },
    };
    executeToolSpy.mockResolvedValue({
      ok: true,
      message: "Using existing project",
      data: {},
    });
    mockResumeResults = [{ status: "success" }];

    await runWizard(makeOptions());

    expect(spinnerMock.stop).toHaveBeenCalledWith("Using existing project");
  });
});
