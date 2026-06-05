import { MastraClient } from "@mastra/client-js";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  type mock,
  test,
  vi,
} from "vitest";
// biome-ignore lint/performance/noNamespaceImport: spyOn requires object reference
import * as banner from "../../../src/lib/banner.js";
import { ENV_VAR_AGENTS } from "../../../src/lib/detect-agent.js";
import { setEnv } from "../../../src/lib/env.js";
import { EXIT, WizardError } from "../../../src/lib/errors.js";
import { WizardCancelledError } from "../../../src/lib/init/clack-utils.js";
// biome-ignore lint/performance/noNamespaceImport: spyOn requires object reference
import * as fmt from "../../../src/lib/init/formatters.js";
// biome-ignore lint/performance/noNamespaceImport: spyOn requires object reference
import * as git from "../../../src/lib/init/git.js";
// biome-ignore lint/performance/noNamespaceImport: spyOn requires object reference
import * as inter from "../../../src/lib/init/interactive.js";
// biome-ignore lint/performance/noNamespaceImport: spyOn requires object reference
import * as preflight from "../../../src/lib/init/preflight.js";
// biome-ignore lint/performance/noNamespaceImport: spyOn requires object reference
import * as readiness from "../../../src/lib/init/readiness.js";
// biome-ignore lint/performance/noNamespaceImport: spyOn requires object reference
import * as registry from "../../../src/lib/init/tools/registry.js";
import type {
  ResolvedInitContext,
  ToolPayload,
  WizardOptions,
  WorkflowRunResult,
} from "../../../src/lib/init/types.js";
// biome-ignore lint/performance/noNamespaceImport: spyOn requires object reference
import * as uiFactory from "../../../src/lib/init/ui/factory.js";
import {
  CANCELLED,
  type SpinnerHandle,
  type WizardUI,
} from "../../../src/lib/init/ui/types.js";
import { runWizard } from "../../../src/lib/init/wizard-runner.js";
// biome-ignore lint/performance/noNamespaceImport: spyOn requires object reference
import * as workflowInputs from "../../../src/lib/init/workflow-inputs.js";
import { createMockUI, type MockCall } from "./ui/mock-ui.js";

const noop = () => {
  /* suppress output */
};

/**
 * Per-test reference to the spinner mock. The wizard-runner calls
 * `ui.spinner()` exactly once and reuses the handle for the entire run,
 * so we expose a singleton with mock fns the test cases can assert on.
 */
const spinnerMock: SpinnerHandle & {
  start: ReturnType<typeof mock>;
  stop: ReturnType<typeof mock>;
  message: ReturnType<typeof mock>;
} = {
  start: vi.fn(),
  stop: vi.fn(),
  message: vi.fn(),
};

let mockUICalls: MockCall[];

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
let startAsyncMock: ReturnType<typeof mock>;
let mockRunByIdResult: WorkflowRunResult | Error;
let runByIdMock: ReturnType<typeof mock>;

let getUISpy: ReturnType<typeof spyOn>;
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
/**
 * ClientOptions captured from each MastraClient instance constructed by
 * runWizard. Used by the MastraClient lifecycle suite to assert that the
 * `abortSignal` passed at construction time is aborted on teardown.
 */
let capturedClientOptions: { abortSignal?: AbortSignal }[] = [];

let savedPlainOutput: string | undefined;

function forceStdinTty<T>(action: () => Promise<T>): Promise<T> {
  const originalDescriptor = Object.getOwnPropertyDescriptor(
    process.stdin,
    "isTTY"
  );
  Object.defineProperty(process.stdin, "isTTY", {
    value: true,
    configurable: true,
    writable: true,
  });
  return action().finally(() => {
    if (originalDescriptor) {
      Object.defineProperty(process.stdin, "isTTY", originalDescriptor);
    } else {
      delete (process.stdin as { isTTY?: boolean }).isTTY;
    }
  });
}

function useMockUI(ui: WizardUI, calls: MockCall[]): void {
  mockUICalls = calls;
  getUISpy.mockResolvedValue({
    ...ui,
    spinner: () => spinnerMock,
  });
}

beforeEach(() => {
  // Force rich output so clack-plain.ts delegates to real clack (spied below)
  savedPlainOutput = process.env.SENTRY_PLAIN_OUTPUT;
  process.env.SENTRY_PLAIN_OUTPUT = "0";

  mockStartResult = { status: "success", result: { platform: "React" } };
  mockResumeResults = [];
  resumeCallCount = 0;
  mockRunByIdResult = new Error("runById not configured");
  process.exitCode = 0;

  spinnerMock.start.mockClear();
  spinnerMock.stop.mockClear();
  spinnerMock.message.mockClear();

  // The wizard runner constructs a UI via `getUI()`. Replace it with a
  // MockUI whose spinner() returns the shared `spinnerMock` so tests can
  // assert on lifecycle calls.
  const { ui, calls, respond } = createMockUI();
  mockUICalls = calls;
  // Pre-load a confirm response so the experimental confirm prompt
  // resolves to "true" by default — the legacy default before MockUI.
  // Tests that exercise `--yes` skip this prompt entirely; the response
  // sits unused on the queue and is harmless.
  respond.confirm(true);
  const wrapped: WizardUI = {
    ...ui,
    spinner: () => spinnerMock,
  };
  getUISpy = vi.spyOn(uiFactory, "getUIAsync").mockResolvedValue(wrapped);

  vi.spyOn(readiness, "checkReadiness").mockResolvedValue(undefined);
  formatBannerSpy = vi.spyOn(banner, "formatBanner").mockReturnValue("BANNER");
  formatResultSpy = vi.spyOn(fmt, "formatResult").mockImplementation(noop);
  formatErrorSpy = vi.spyOn(fmt, "formatError").mockImplementation(noop);
  checkGitStatusSpy = vi.spyOn(git, "checkGitStatus").mockResolvedValue(true);
  handleInteractiveSpy = vi
    .spyOn(inter, "handleInteractive")
    .mockResolvedValue({
      action: "continue",
    });
  resolveInitContextSpy = vi
    .spyOn(preflight, "resolveInitContext")
    .mockResolvedValue(makeContext());
  describeToolSpy = vi
    .spyOn(registry, "describeTool")
    .mockReturnValue("Running tool...");
  executeToolSpy = vi.spyOn(registry, "executeTool").mockResolvedValue({
    ok: true,
    data: { results: [] },
  });
  precomputeDirListingSpy = vi
    .spyOn(workflowInputs, "precomputeDirListing")
    .mockResolvedValue([]);
  preReadCommonFilesSpy = vi
    .spyOn(workflowInputs, "preReadCommonFiles")
    .mockResolvedValue({});
  precomputeSentryDetectionSpy = vi
    .spyOn(workflowInputs, "precomputeSentryDetection")
    .mockResolvedValue({
      ok: true,
      data: { status: "none", signals: [] },
    });
  stderrSpy = vi
    .spyOn(process.stderr, "write")
    .mockImplementation(() => true as any);

  startAsyncMock = vi.fn(() => Promise.resolve(mockStartResult));
  runByIdMock = vi.fn(() =>
    mockRunByIdResult instanceof Error
      ? Promise.reject(mockRunByIdResult)
      : Promise.resolve(mockRunByIdResult)
  );
  const run = {
    runId: "test-run-id",
    startAsync: startAsyncMock,
    resumeAsync: vi.fn(() => {
      const result = mockResumeResults[resumeCallCount] ?? {
        status: "success",
      };
      resumeCallCount += 1;
      return Promise.resolve(result);
    }),
  };
  const workflow = {
    createRun: vi.fn(() => Promise.resolve(run)),
    runById: runByIdMock,
  };
  capturedClientOptions = [];
  getWorkflowSpy = vi
    .spyOn(MastraClient.prototype, "getWorkflow")
    .mockImplementation(function (this: MastraClient) {
      // `this` is the MastraClient instance. `BaseResource.options` holds the
      // full ClientOptions passed to the constructor — including abortSignal.
      capturedClientOptions.push(
        (this as unknown as { options: { abortSignal?: AbortSignal } }).options
      );
      return workflow as any;
    });
});

afterEach(() => {
  getUISpy.mockRestore();
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

  if (savedPlainOutput === undefined) {
    delete process.env.SENTRY_PLAIN_OUTPUT;
  } else {
    process.env.SENTRY_PLAIN_OUTPUT = savedPlainOutput;
  }

  // Restore the env sandbox in case any test used setEnv without try/finally.
  setEnv(process.env);
});

function lastCancelMessage(): string | undefined {
  for (let i = mockUICalls.length - 1; i >= 0; i--) {
    const call = mockUICalls[i];
    if (call?.kind === "cancel") {
      return call.message;
    }
  }
  return;
}

function lastFeedbackOutcome(): string | undefined {
  for (let i = mockUICalls.length - 1; i >= 0; i--) {
    const call = mockUICalls[i];
    if (call?.kind === "feedback") {
      return call.outcome;
    }
  }
  return;
}

function lastWarn(): string | undefined {
  for (let i = mockUICalls.length - 1; i >= 0; i--) {
    const call = mockUICalls[i];
    if (call?.kind === "log.warn") {
      return call.message;
    }
  }
  return;
}

describe("runWizard", () => {
  test("formats successful results", async () => {
    await runWizard(makeOptions());

    expect(formatResultSpy).toHaveBeenCalled();
    expect(formatErrorSpy).not.toHaveBeenCalled();
    expect(spinnerMock.stop).toHaveBeenCalledWith("Done");
  });

  test("throws when stdin is not a TTY without --yes", async () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(
      process.stdin,
      "isTTY"
    );
    Object.defineProperty(process.stdin, "isTTY", {
      value: false,
      configurable: true,
      writable: true,
    });

    try {
      await expect(runWizard(makeOptions({ yes: false }))).rejects.toThrow(
        WizardError
      );
    } finally {
      if (originalDescriptor) {
        Object.defineProperty(process.stdin, "isTTY", originalDescriptor);
      } else {
        delete (process.stdin as { isTTY?: boolean }).isTTY;
      }
    }
  });

  test("passes dry-run as non-interactive into preflight", async () => {
    await runWizard(makeOptions({ dryRun: true, yes: false }));

    expect(resolveInitContextSpy).toHaveBeenCalledWith(
      expect.objectContaining({ dryRun: true, yes: true }),
      expect.anything()
    );
    expect(lastWarn()).toContain("Dry-run");
  });

  test("uses rich welcome screen when available", async () => {
    const { ui, calls, respond } = createMockUI({ welcome: true });
    respond.welcome("continue");
    useMockUI(ui, calls);

    await forceStdinTty(() =>
      runWizard(
        makeOptions({
          yes: false,
          features: ["errorMonitoring", "performanceMonitoring"],
          org: "bete-dev",
          project: "nextjs",
        })
      )
    );

    const welcome = calls.find((call) => call.kind === "welcome");
    expect(welcome).toBeDefined();
    if (welcome?.kind !== "welcome") {
      throw new Error("expected welcome call");
    }
    expect(welcome.options.title).toBe("Sentry Init");
    expect(welcome.options.body).toContain(
      "We'll use AI to inspect this project and configure Sentry."
    );
    expect(welcome.options.punchline).toContain("use AI for setup");
    expect(getUISpy.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        initialWelcome: expect.objectContaining({
          title: "Sentry Init",
        }),
      })
    );
    expect(
      calls.some((call) => call.kind === "select" || call.kind === "confirm")
    ).toBe(false);
    const introOn = calls.findIndex(
      (call) => call.kind === "setIntroMode" && call.enabled
    );
    const introOff = calls.findIndex(
      (call) => call.kind === "setIntroMode" && !call.enabled
    );
    expect(introOn).toBeGreaterThanOrEqual(0);
    expect(introOff).toBeGreaterThanOrEqual(0);
    expect(spinnerMock.message.mock.calls).toContainEqual([
      "Connecting to wizard...",
    ]);
    expect(formatResultSpy).toHaveBeenCalled();
  });

  test("does not log a second AI disclaimer after welcome", async () => {
    const { ui, calls, respond } = createMockUI({ welcome: true });
    respond.welcome("continue");
    useMockUI(ui, calls);

    await forceStdinTty(() =>
      runWizard(
        makeOptions({
          yes: false,
          features: ["errorMonitoring"],
          org: "bete-dev",
          project: "nextjs",
        })
      )
    );

    const infoMessages = calls
      .filter((call) => call.kind === "log.info")
      .map((call) => call.message);
    expect(
      infoMessages.some((message) => message.includes("This wizard uses AI"))
    ).toBe(false);
    expect(
      infoMessages.some((message) => message.includes("For manual setup"))
    ).toBe(false);
  });

  test("cancels cleanly from rich welcome screen", async () => {
    const { ui, calls, respond } = createMockUI({ welcome: true });
    respond.welcome(CANCELLED);
    useMockUI(ui, calls);

    await forceStdinTty(() => runWizard(makeOptions({ yes: false })));

    expect(process.exitCode).toBe(0);
    expect(lastCancelMessage()).toBe("Setup cancelled.");
    expect(lastFeedbackOutcome()).toBe("cancelled");
    expect(getWorkflowSpy).not.toHaveBeenCalled();
  });

  test("falls back to generic continue prompt without rich welcome", async () => {
    const { ui, calls, respond } = createMockUI();
    respond.select("continue");
    useMockUI(ui, calls);

    await forceStdinTty(() => runWizard(makeOptions({ yes: false })));

    const select = calls.find((call) => call.kind === "select");
    expect(select).toBeDefined();
    if (select?.kind !== "select") {
      throw new Error("expected select call");
    }
    expect(select.message).toContain("experimental");
    expect(formatResultSpy).toHaveBeenCalled();
  });

  test("aborts cleanly when user declines the experimental prompt", async () => {
    const { ui, calls, respond } = createMockUI();
    respond.select("exit");
    useMockUI(ui, calls);

    await forceStdinTty(() => runWizard(makeOptions({ yes: false })));

    expect(process.exitCode).toBe(0);
    expect(lastCancelMessage()).toBe("Setup cancelled.");
    expect(lastFeedbackOutcome()).toBe("cancelled");
    expect(getWorkflowSpy).not.toHaveBeenCalled();
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

    expect(lastCancelMessage()).toBe("Setup cancelled.");
    expect(lastFeedbackOutcome()).toBe("cancelled");
    expect(getWorkflowSpy).not.toHaveBeenCalled();
  });

  test("suppresses the ASCII art banner when an agent is detected", async () => {
    setEnv({ ...process.env, CLAUDE_CODE: "1" } as NodeJS.ProcessEnv);
    try {
      await runWizard(makeOptions());
    } finally {
      setEnv(process.env);
    }

    expect(formatBannerSpy).not.toHaveBeenCalled();
    expect(stderrSpy).not.toHaveBeenCalledWith(
      expect.stringContaining("BANNER")
    );
  });

  test("prints the ASCII art banner when no agent is detected", async () => {
    // Strip all agent-detection env vars so detectAgent() returns undefined
    // even when running inside an agent environment (e.g. OpenCode in CI).
    const agentKeys = new Set([
      "AI_AGENT",
      "AGENT",
      "CLAUDECODE",
      "CLAUDE_CODE",
      ...ENV_VAR_AGENTS.keys(),
    ]);
    const cleanEnv = Object.fromEntries(
      Object.entries(process.env).filter(([k]) => !agentKeys.has(k))
    );
    setEnv(cleanEnv as NodeJS.ProcessEnv);
    try {
      await runWizard(makeOptions());
    } finally {
      setEnv(process.env);
    }

    expect(formatBannerSpy).toHaveBeenCalled();
    expect(mockUICalls).toContainEqual({ kind: "banner", art: "BANNER" });
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
      makeContext(),
      expect.anything()
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

  test("tears down forwarding and stops the spinner on tool errors", async () => {
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
    executeToolSpy.mockRejectedValue(new Error("boom"));

    await expect(runWizard(makeOptions())).rejects.toThrow(WizardError);

    expect(spinnerMock.stop).toHaveBeenCalledWith("Error", 1);
    expect(lastCancelMessage()).toBe("Setup failed");
    expect(lastFeedbackOutcome()).toBe("failed");
  });

  test("tears down forwarding and stops the spinner on cancellation", async () => {
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
    executeToolSpy.mockRejectedValue(new WizardCancelledError());

    await runWizard(makeOptions());

    expect(process.exitCode).toBe(0);
    expect(spinnerMock.stop).toHaveBeenCalledWith("Cancelled", 0);
    expect(lastCancelMessage()).toBe("Setup cancelled.");
    expect(lastFeedbackOutcome()).toBe("cancelled");
  });

  test("tears down forwarding when a WizardError is rethrown from a tool", async () => {
    // The reordered catch block stops the spinner BEFORE the WizardError
    // rethrow branch, so any WizardError thrown from handleSuspendedStep
    // (e.g. tool handlers, malformed payloads) must still release the TTY
    // handle via `using` teardown.
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
    executeToolSpy.mockRejectedValue(
      new WizardError("tool rejected by server")
    );

    await expect(runWizard(makeOptions())).rejects.toThrow(WizardError);

    expect(spinnerMock.stop).toHaveBeenCalledWith("Error", 1);
    expect(lastCancelMessage()).toBe("Setup failed");
    expect(lastFeedbackOutcome()).toBe("failed");
  });

  test("shows count-based messages while reading and analyzing files", async () => {
    mockStartResult = {
      status: "suspended",
      suspended: [["detect-platform"]],
      steps: {
        "detect-platform": {
          suspendPayload: {
            type: "tool",
            operation: "read-files",
            cwd: "/tmp/test",
            params: {
              paths: ["src/settings.py", "src/urls.py"],
            },
          },
        },
      },
    };
    mockResumeResults = [{ status: "success" }];

    await runWizard(makeOptions());

    const messages = spinnerMock.message.mock.calls.map(
      (call: string[]) => call[0]
    );
    expect(messages).toContain("Reading 2 files...");
    expect(messages).toContain("Analyzing 2 files...");
  });

  test("passes precomputed dirListing/fileCache/existingSentry via initialState, not inputData", async () => {
    const dirListing = [
      { name: "package.json", path: "package.json", type: "file" as const },
    ];
    const fileCache = { "package.json": '{"name":"app"}' };
    const detectedSentry = { status: "none" as const, signals: [] };

    precomputeDirListingSpy.mockResolvedValue(dirListing);
    preReadCommonFilesSpy.mockResolvedValue(fileCache);
    precomputeSentryDetectionSpy.mockResolvedValue({
      ok: true,
      data: detectedSentry,
    });

    await runWizard(makeOptions());

    expect(startAsyncMock).toHaveBeenCalledTimes(1);
    const call = startAsyncMock.mock.calls[0] as
      | [
          {
            inputData?: Record<string, unknown>;
            initialState?: Record<string, unknown>;
          },
        ]
      | undefined;
    expect(call).toBeDefined();
    const args = call?.[0] ?? {};

    // Large shared context lives on state, not on inputData.
    expect(args.inputData).not.toHaveProperty("dirListing");
    expect(args.inputData).not.toHaveProperty("fileCache");
    expect(args.inputData).not.toHaveProperty("existingSentry");
    expect(args.initialState?.dirListing).toEqual(dirListing);
    expect(args.initialState?.fileCache).toEqual(fileCache);
    expect(args.initialState?.existingSentry).toEqual(detectedSentry);
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

  test("shows --yes hint when LoggingUI prompt fails", async () => {
    const { LoggingUIPromptError } = await import(
      "../../../src/lib/init/ui/logging-ui.js"
    );
    const { ui } = createMockUI();
    const failingUI: WizardUI = {
      ...ui,
      spinner: () => spinnerMock,
      select: () =>
        Promise.reject(
          new LoggingUIPromptError(
            "select",
            "This is experimental and will modify files"
          )
        ),
    };
    getUISpy.mockResolvedValue(failingUI);

    await expect(
      forceStdinTty(() => runWizard(makeOptions({ yes: false })))
    ).rejects.toThrow("Run with --yes for non-interactive mode.");
  });
});

describe("runWizard — MastraClient lifecycle", () => {
  test("aborts the MastraClient signal after a successful run", async () => {
    await runWizard(makeOptions());

    expect(capturedClientOptions).toHaveLength(1);
    const signal = capturedClientOptions[0]?.abortSignal;
    expect(signal).toBeInstanceOf(AbortSignal);
    // Using the non-null assertion safely — we asserted toBeInstanceOf above.
    expect((signal as AbortSignal).aborted).toBe(true);
  });

  test("aborts the MastraClient signal when a tool throws", async () => {
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
    executeToolSpy.mockRejectedValue(new Error("tool blew up"));

    await expect(runWizard(makeOptions())).rejects.toThrow(WizardError);

    expect(capturedClientOptions).toHaveLength(1);
    const signal = capturedClientOptions[0]?.abortSignal;
    expect(signal).toBeInstanceOf(AbortSignal);
    expect((signal as AbortSignal).aborted).toBe(true);
  });

  test("aborts the MastraClient signal on cancellation", async () => {
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
    executeToolSpy.mockRejectedValue(new WizardCancelledError());

    await runWizard(makeOptions());

    expect(capturedClientOptions).toHaveLength(1);
    const signal = capturedClientOptions[0]?.abortSignal;
    expect(signal).toBeInstanceOf(AbortSignal);
    expect((signal as AbortSignal).aborted).toBe(true);
  });

  test("signal is live (not pre-aborted) while the wizard is running", async () => {
    // `getWorkflow` runs BEFORE `startAsync` (client.getWorkflow is called
    // synchronously right after `new MastraClient(...)`), so the signal
    // observed at that time is the same instance that in-flight fetches
    // would see during the wizard. If the signal were somehow pre-aborted
    // at construction, it would be aborted here too. This proves the
    // `using _mastraCleanup` disposable does NOT fire until teardown.
    let abortedAtConstruction: boolean | undefined;
    getWorkflowSpy.mockImplementation(function (this: MastraClient) {
      const opts = (
        this as unknown as { options: { abortSignal?: AbortSignal } }
      ).options;
      capturedClientOptions.push(opts);
      abortedAtConstruction = opts.abortSignal?.aborted;
      return {
        createRun: vi.fn(() =>
          Promise.resolve({
            startAsync: startAsyncMock,
            resumeAsync: vi.fn(() => Promise.resolve({ status: "success" })),
          })
        ),
      } as any;
    });

    await runWizard(makeOptions());

    expect(abortedAtConstruction).toBe(false);
    // And teardown aborted it by the time the wizard returned.
    expect(capturedClientOptions[0]?.abortSignal?.aborted).toBe(true);
  });
});

// ─── Additional coverage tests ───────────────────────────────────────────────

describe("runWizard — workflow exit codes", () => {
  // handleFinalResult calls mapWorkflowExitCode when the workflow result
  // carries a non-zero exitCode. Each case maps a server-internal code to
  // the CLI's semantic EXIT constant.
  test.each([
    [20, EXIT.CONFIG],
    [30, EXIT.WIZARD_DEPS],
    [40, EXIT.WIZARD_CODEMOD],
    [41, EXIT.WIZARD_CODEMOD],
    [50, EXIT.WIZARD_VERIFY],
    // 999 is an unknown code; also exercises the default branch of mapWorkflowExitCode
    [999, EXIT.WIZARD],
  ])("maps workflow exit code %s to the expected EXIT constant", async (workflowCode, expectedExitCode) => {
    mockStartResult = {
      status: "success",
      result: { exitCode: workflowCode },
    };

    const err = await runWizard(makeOptions()).catch((e) => e);

    expect(err).toBeInstanceOf(WizardError);
    expect((err as WizardError).exitCode).toBe(expectedExitCode);
  });
});

describe("runWizard — resumeWithRetry stale-step recovery", () => {
  const toolPayload: ToolPayload = {
    type: "tool",
    operation: "run-commands",
    cwd: "/tmp/test",
    params: { commands: ["npm install"] },
  };

  function makeStaleStepRun(resumeAsyncImpl: () => Promise<WorkflowRunResult>) {
    let runByIdRef: ReturnType<typeof mock>;
    getWorkflowSpy.mockImplementation(function (this: MastraClient) {
      capturedClientOptions.push(
        (this as unknown as { options: { abortSignal?: AbortSignal } }).options
      );
      runByIdRef = runByIdMock;
      return {
        createRun: vi.fn(() =>
          Promise.resolve({
            runId: "test-run-id",
            startAsync: startAsyncMock,
            resumeAsync: vi.fn(resumeAsyncImpl),
          })
        ),
        runById: runByIdRef,
      } as any;
    });
  }

  function staleStepError(): Error {
    return new Error(
      "HTTP error! status: 500 - " +
        JSON.stringify({
          error:
            "This workflow step 'tool-step' was not suspended. Available suspended steps: [next-step]",
        })
    );
  }

  function staleRunError(): Error {
    return new Error(
      "HTTP error! status: 500 - " +
        JSON.stringify({ error: "This workflow run was not suspended" })
    );
  }

  test("recovers when server has already advanced to the next step", async () => {
    mockStartResult = {
      status: "suspended",
      suspended: [["tool-step"]],
      steps: { "tool-step": { suspendPayload: toolPayload } },
    };
    // runById returns a finished workflow — the wizard should complete cleanly.
    mockRunByIdResult = { status: "success" };

    let resumeCount = 0;
    makeStaleStepRun(() => {
      resumeCount += 1;
      if (resumeCount === 1) {
        return Promise.reject(staleStepError());
      }
      return Promise.resolve({ status: "success" });
    });

    await runWizard(makeOptions());

    expect(formatResultSpy).toHaveBeenCalled();
    expect(runByIdMock).toHaveBeenCalledWith(
      "test-run-id",
      expect.objectContaining({ fields: expect.any(Array) })
    );
    // Recovery succeeded on the first attempt — resumeAsync was not called again.
    expect(resumeCount).toBe(1);
  });

  test("recovers from run-level not-suspended errors after transient runById failure", async () => {
    mockStartResult = {
      status: "suspended",
      suspended: [["tool-step"]],
      steps: { "tool-step": { suspendPayload: toolPayload } },
    };
    runByIdMock
      .mockRejectedValueOnce(new Error("D1 snapshot not ready"))
      .mockResolvedValueOnce({ status: "success" });

    let resumeCount = 0;
    makeStaleStepRun(() => {
      resumeCount += 1;
      return Promise.reject(staleRunError());
    });

    await runWizard(makeOptions());

    expect(formatResultSpy).toHaveBeenCalled();
    expect(runByIdMock).toHaveBeenCalledTimes(2);
    expect(resumeCount).toBe(1);
  });

  test("throws when stale-step error occurs and runById keeps failing", async () => {
    mockStartResult = {
      status: "suspended",
      suspended: [["tool-step"]],
      steps: { "tool-step": { suspendPayload: toolPayload } },
    };
    // runById is unreachable — recovery fails, wizard throws without retrying
    // the stale resume request.
    mockRunByIdResult = new Error("runById network error");

    let resumeCount = 0;
    makeStaleStepRun(() => {
      resumeCount += 1;
      return Promise.reject(staleStepError());
    });

    await expect(runWizard(makeOptions())).rejects.toThrow(WizardError);

    // Threw after recovery polling failed — no futile retries of the stale step.
    expect(resumeCount).toBe(1);
    expect(runByIdMock).toHaveBeenCalledTimes(4);
  });
});

describe("runWizard — additional coverage", () => {
  test("throws WizardError and stops spinner when workflow start fails", async () => {
    startAsyncMock.mockRejectedValue(new Error("connection refused"));

    await expect(runWizard(makeOptions())).rejects.toThrow(WizardError);

    expect(spinnerMock.stop).toHaveBeenCalledWith("Connection failed", 1);
    expect(lastCancelMessage()).toBe("Setup failed");
  });

  test("throws when the workflow response has an unrecognised status", async () => {
    startAsyncMock.mockResolvedValue({ status: "bailed" });

    await expect(runWizard(makeOptions())).rejects.toThrow(
      /Unexpected workflow status/
    );
  });

  test("throws when a suspend payload is a non-object truthy value", async () => {
    mockStartResult = {
      status: "suspended",
      suspended: [["detect-platform"]],
      steps: {
        "detect-platform": {
          // 42 is truthy, so extractSuspendPayload passes it to
          // assertSuspendPayload, which rejects non-objects.
          suspendPayload: 42,
        },
      },
    };

    await expect(runWizard(makeOptions())).rejects.toThrow(WizardError);
  });

  test("finds suspend payload via fallback loop when primary step has none", async () => {
    const payload: ToolPayload = {
      type: "tool",
      operation: "run-commands",
      cwd: "/tmp/test",
      params: { commands: ["echo hi"] },
    };
    // `suspended` points to "step-a", but its payload is missing.
    // extractSuspendPayload falls back to iterating all steps and finds
    // the payload in "step-b".
    mockStartResult = {
      status: "suspended",
      suspended: [["step-a"]],
      steps: {
        "step-a": {},
        "step-b": { suspendPayload: payload },
      },
    };
    mockResumeResults = [{ status: "success" }];

    await runWizard(makeOptions());

    expect(executeToolSpy).toHaveBeenCalledWith(payload, makeContext());
  });

  test("marks the previous step completed when the workflow advances", async () => {
    const payloadA: ToolPayload = {
      type: "tool",
      operation: "list-dir",
      cwd: "/tmp/test",
      params: { path: "." },
    };
    const payloadB: ToolPayload = {
      type: "tool",
      operation: "read-files",
      cwd: "/tmp/test",
      params: { paths: ["package.json"] },
    };

    mockStartResult = {
      status: "suspended",
      suspended: [["discover-context"]],
      steps: { "discover-context": { suspendPayload: payloadA } },
    };
    mockResumeResults = [
      {
        status: "suspended",
        suspended: [["detect-platform"]],
        steps: { "detect-platform": { suspendPayload: payloadB } },
      },
      { status: "success" },
    ];

    await runWizard(makeOptions());

    const stepCalls = mockUICalls.filter((c) => c.kind === "setStep");
    expect(stepCalls).toContainEqual({
      kind: "setStep",
      stepId: "discover-context",
      status: "in_progress",
    });
    expect(stepCalls).toContainEqual({
      kind: "setStep",
      stepId: "discover-context",
      status: "completed",
    });
    expect(stepCalls).toContainEqual({
      kind: "setStep",
      stepId: "detect-platform",
      status: "in_progress",
    });
    const inProgressIdx = stepCalls.findIndex(
      (c) =>
        c.kind === "setStep" &&
        c.stepId === "discover-context" &&
        c.status === "in_progress"
    );
    const completedIdx = stepCalls.findIndex(
      (c) =>
        c.kind === "setStep" &&
        c.stepId === "discover-context" &&
        c.status === "completed"
    );
    expect(inProgressIdx).toBeLessThan(completedIdx);
  });

  test("uses existing platform name in detect-platform spinner label", async () => {
    resolveInitContextSpy.mockResolvedValue(
      makeContext({ existingProject: { platform: "javascript-nextjs" } })
    );
    mockStartResult = {
      status: "suspended",
      suspended: [["detect-platform"]],
      steps: {
        "detect-platform": {
          suspendPayload: {
            type: "tool",
            operation: "list-dir",
            cwd: "/tmp/test",
            params: { path: "." },
          },
        },
      },
    };
    mockResumeResults = [{ status: "success" }];

    await runWizard(makeOptions());

    const messages = spinnerMock.message.mock.calls.map(
      (c: unknown[]) => c[0] as string
    );
    expect(messages.some((m) => m.includes("javascript-nextjs"))).toBe(true);
  });
});
