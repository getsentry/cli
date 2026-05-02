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
import { ENV_VAR_AGENTS } from "../../../src/lib/detect-agent.js";
import { setEnv } from "../../../src/lib/env.js";
import { WizardError } from "../../../src/lib/errors.js";
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
import * as initSpinner from "../../../src/lib/init/spinner.js";
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
let startAsyncMock: ReturnType<typeof mock>;

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
/**
 * ClientOptions captured from each MastraClient instance constructed by
 * runWizard. Used by the MastraClient lifecycle suite to assert that the
 * `abortSignal` passed at construction time is aborted on teardown.
 */
let capturedClientOptions: { abortSignal?: AbortSignal }[] = [];

let savedPlainOutput: string | undefined;

beforeEach(() => {
  // Force rich output so clack-plain.ts delegates to real clack (spied below)
  savedPlainOutput = process.env.SENTRY_PLAIN_OUTPUT;
  process.env.SENTRY_PLAIN_OUTPUT = "0";

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
  spinnerSpy = spyOn(initSpinner, "createWizardSpinner").mockReturnValue(
    spinnerMock as any
  );

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

  startAsyncMock = mock(() => Promise.resolve(mockStartResult));
  const run = {
    startAsync: startAsyncMock,
    resumeAsync: mock(() => {
      const result = mockResumeResults[resumeCallCount] ?? {
        status: "success",
      };
      resumeCallCount += 1;
      return Promise.resolve(result);
    }),
  };
  const workflow = {
    createRun: mock(() => Promise.resolve(run)),
  };
  capturedClientOptions = [];
  getWorkflowSpy = spyOn(
    MastraClient.prototype,
    "getWorkflow"
  ).mockImplementation(function (this: MastraClient) {
    // `this` is the MastraClient instance. `BaseResource.options` holds the
    // full ClientOptions passed to the constructor — including abortSignal.
    capturedClientOptions.push(
      (this as unknown as { options: { abortSignal?: AbortSignal } }).options
    );
    return workflow as any;
  });
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

  if (savedPlainOutput === undefined) {
    delete process.env.SENTRY_PLAIN_OUTPUT;
  } else {
    process.env.SENTRY_PLAIN_OUTPUT = savedPlainOutput;
  }

  // Restore the env sandbox in case any test used setEnv without try/finally.
  setEnv(process.env);
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
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining("BANNER"));
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
    expect(cancelSpy).toHaveBeenCalledWith("Setup failed");
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
  });

  test("shows a multiline tree while reading files and then analyzing them", async () => {
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

    const messages = spinnerMock.message.mock.calls.map((call: string[]) =>
      call[0]
        ?.replace(
          // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping ANSI escape sequences
          /\x1b\[[^m]*m/g,
          ""
        )
        // Normalize whitespace left behind by code span padding
        .replace(/[ \t]+$/gm, "")
        .replace(/ {2,}/g, " ")
    );
    expect(messages).toContain(
      "Reading files...\n├─ ● settings.py\n└─ ● urls.py"
    );
    expect(messages).toContain(
      "Analyzing files...\n├─ ✓ settings.py\n└─ ✓ urls.py"
    );
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
        createRun: mock(() =>
          Promise.resolve({
            startAsync: startAsyncMock,
            resumeAsync: mock(() => Promise.resolve({ status: "success" })),
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
