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
import * as initSpinner from "../../../src/lib/init/spinner.js";
// biome-ignore lint/performance/noNamespaceImport: spyOn requires object reference
import * as initTransport from "../../../src/lib/init/transport.js";
// biome-ignore lint/performance/noNamespaceImport: spyOn requires object reference
import * as registry from "../../../src/lib/init/tools/registry.js";
import type {
  InitActionResumeBody,
  InitEvent,
  ResolvedInitContext,
  ToolPayload,
  WizardOptions,
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
    project: "my-app",
    authToken: "test-token",
    ...overrides,
  };
}

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
let startInitStreamSpy: ReturnType<typeof spyOn>;
let reconnectInitStreamSpy: ReturnType<typeof spyOn>;
let resumeInitActionSpy: ReturnType<typeof spyOn>;
let readNdjsonStreamSpy: ReturnType<typeof spyOn>;
let describeToolSpy: ReturnType<typeof spyOn>;
let executeToolSpy: ReturnType<typeof spyOn>;
let precomputeSentryDetectionSpy: ReturnType<typeof spyOn>;
let stderrSpy: ReturnType<typeof spyOn>;

let streamBatches: InitEvent[][];
let resumeBodies: InitActionResumeBody[];

beforeEach(() => {
  process.exitCode = 0;
  streamBatches = [[{ type: "summary", output: { platform: "React" } }, { type: "done", ok: true }]];
  resumeBodies = [];

  introSpy = spyOn(clack, "intro").mockImplementation(noop);
  confirmSpy = spyOn(clack, "confirm").mockResolvedValue(true);
  cancelSpy = spyOn(clack, "cancel").mockImplementation(noop);
  logInfoSpy = spyOn(clack.log, "info").mockImplementation(noop);
  logWarnSpy = spyOn(clack.log, "warn").mockImplementation(noop);
  logErrorSpy = spyOn(clack.log, "error").mockImplementation(noop);
  spinnerSpy = spyOn(initSpinner, "createWizardSpinner").mockReturnValue(
    spinnerMock as never
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
  precomputeSentryDetectionSpy = spyOn(
    workflowInputs,
    "precomputeSentryDetection"
  ).mockResolvedValue({
    ok: true,
    data: { status: "none", signals: [] },
  });
  stderrSpy = spyOn(process.stderr, "write").mockImplementation(
    () => true as never
  );

  startInitStreamSpy = spyOn(
    initTransport,
    "startInitStream"
  ).mockResolvedValue({
    response: {} as Response,
    runId: "run-123",
  });
  reconnectInitStreamSpy = spyOn(
    initTransport,
    "reconnectInitStream"
  ).mockResolvedValue({} as Response);
  resumeInitActionSpy = spyOn(
    initTransport,
    "resumeInitAction"
  ).mockImplementation(async (_actionId, body) => {
    resumeBodies.push(body);
  });
  readNdjsonStreamSpy = spyOn(
    initTransport,
    "readNdjsonStream"
  ).mockImplementation(async (_response, onEvent) => {
    const batch = streamBatches.shift() ?? [];
    for (const event of batch) {
      await onEvent(event);
    }
    return batch.length;
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
  startInitStreamSpy.mockRestore();
  reconnectInitStreamSpy.mockRestore();
  resumeInitActionSpy.mockRestore();
  readNdjsonStreamSpy.mockRestore();
  describeToolSpy.mockRestore();
  executeToolSpy.mockRestore();
  precomputeSentryDetectionSpy.mockRestore();
  stderrSpy.mockRestore();

  process.exitCode = 0;
});

describe("runWizard", () => {
  test("starts the workflow without authToken, dirListing, or fileCache in the payload", async () => {
    await runWizard(makeOptions());

    const startArg = startInitStreamSpy.mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(startArg).toMatchObject({
      directory: "/tmp/test",
      yes: true,
      dryRun: false,
      org: "acme",
      team: "platform",
      project: "my-app",
      existingSentry: { status: "none", signals: [] },
      cliVersion: expect.any(String),
    });
    expect(startArg.authToken).toBeUndefined();
    expect(startArg.dirListing).toBeUndefined();
    expect(startArg.fileCache).toBeUndefined();
    expect(formatResultSpy).toHaveBeenCalledWith({ platform: "React" });
    expect(formatErrorSpy).not.toHaveBeenCalled();
    expect(spinnerMock.stop).toHaveBeenCalledWith("Done");
  });

  test("passes dry-run as non-interactive into preflight", async () => {
    await runWizard(makeOptions({ dryRun: true, yes: false }));

    expect(resolveInitContextSpy).toHaveBeenCalledWith(
      expect.objectContaining({ dryRun: true, yes: true })
    );
    expect(logWarnSpy).toHaveBeenCalled();
  });

  test("stops before transport creation when preflight returns null", async () => {
    resolveInitContextSpy.mockResolvedValue(null);

    await runWizard(makeOptions());

    expect(startInitStreamSpy).not.toHaveBeenCalled();
    expect(formatResultSpy).not.toHaveBeenCalled();
  });

  test("aborts cleanly when git safety check fails", async () => {
    checkGitStatusSpy.mockResolvedValue(false);

    await runWizard(makeOptions());

    expect(cancelSpy).toHaveBeenCalledWith("Setup cancelled.");
    expect(startInitStreamSpy).not.toHaveBeenCalled();
  });

  test("dispatches tool action requests through the local registry", async () => {
    const payload: ToolPayload = {
      type: "tool",
      operation: "run-commands",
      cwd: "/tmp/test",
      params: { commands: ["npm install @sentry/node"] },
    };
    streamBatches = [
      [
        {
          type: "action_request",
          actionId: "tool-1",
          kind: "tool",
          name: "install-deps",
          payload,
        },
      ],
      [{ type: "done", ok: true }],
    ];

    await runWizard(makeOptions());

    expect(describeToolSpy).toHaveBeenCalledWith(payload);
    expect(executeToolSpy).toHaveBeenCalledWith(payload, makeContext());
    expect(resumeInitActionSpy).toHaveBeenCalledWith(
      "tool-1",
      expect.objectContaining({
        ok: true,
        output: expect.objectContaining({
          ok: true,
          data: { results: [] },
        }),
      }),
      expect.objectContaining({ baseUrl: expect.any(String) })
    );
    expect(reconnectInitStreamSpy).toHaveBeenCalledWith(
      "run-123",
      1,
      expect.objectContaining({ baseUrl: expect.any(String) })
    );
    expect(spinnerMock.message).toHaveBeenCalledWith("Running tool...");
  });

  test("dispatches prompt action requests through interactive handlers", async () => {
    streamBatches = [
      [
        {
          type: "action_request",
          actionId: "prompt-1",
          kind: "prompt",
          name: "select-features",
          payload: {
            type: "interactive",
            kind: "confirm",
            prompt: "Continue?",
          },
        },
      ],
      [{ type: "done", ok: true }],
    ];

    await runWizard(makeOptions());

    expect(handleInteractiveSpy).toHaveBeenCalledWith(
      {
        type: "interactive",
        kind: "confirm",
        prompt: "Continue?",
      },
      makeContext()
    );
    expect(resumeBodies[0]).toEqual({
      ok: true,
      output: {
        action: "continue",
        _phase: "apply",
      },
    });
  });

  test("deduplicates replayed action requests by actionId", async () => {
    const payload: ToolPayload = {
      type: "tool",
      operation: "list-dir",
      cwd: "/tmp/test",
      params: { path: ".", recursive: true },
    };
    streamBatches = [
      [
        {
          type: "action_request",
          actionId: "dup-1",
          kind: "tool",
          name: "detect-platform",
          payload,
        },
      ],
      [
        {
          type: "action_request",
          actionId: "dup-1",
          kind: "tool",
          name: "detect-platform",
          payload,
        },
        { type: "summary", output: { platform: "node" } },
        { type: "done", ok: true },
      ],
    ];

    await runWizard(makeOptions());

    expect(executeToolSpy).toHaveBeenCalledTimes(1);
    expect(resumeInitActionSpy).toHaveBeenCalledTimes(1);
    expect(reconnectInitStreamSpy).toHaveBeenCalledWith(
      "run-123",
      1,
      expect.objectContaining({ baseUrl: expect.any(String) })
    );
  });

  test("skips verify-changes prompt actions during dry-run", async () => {
    resolveInitContextSpy.mockResolvedValue(makeContext({ dryRun: true }));
    streamBatches = [
      [
        {
          type: "action_request",
          actionId: "verify-1",
          kind: "prompt",
          name: "verify-changes",
          payload: {
            type: "interactive",
            kind: "confirm",
            prompt: "Verification found issues. Continue anyway?",
          },
        },
      ],
      [{ type: "done", ok: true }],
    ];

    await runWizard(makeOptions({ dryRun: true }));

    expect(handleInteractiveSpy).not.toHaveBeenCalled();
    expect(resumeBodies[0]).toEqual({
      ok: true,
      output: {
        action: "continue",
        _phase: "apply",
      },
    });
  });

  test("renders final summaries from summary and done events", async () => {
    streamBatches = [
      [
        {
          type: "summary",
          output: {
            platform: "Node",
            projectDir: "/tmp/test",
            warnings: ["Heads up"],
          },
        },
        { type: "done", ok: true },
      ],
    ];

    await runWizard(makeOptions());

    expect(formatResultSpy).toHaveBeenCalledWith({
      platform: "Node",
      projectDir: "/tmp/test",
      warnings: ["Heads up"],
    });
  });

  test("renders final errors from summary and error events", async () => {
    streamBatches = [
      [
        {
          type: "summary",
          output: { platform: "Node", commands: ["npm install"] },
        },
        {
          type: "error",
          message: "Could not determine project platform",
          exitCode: 20,
        },
      ],
    ];

    await expect(runWizard(makeOptions())).rejects.toThrow(WizardError);

    expect(formatErrorSpy).toHaveBeenCalledWith({
      type: "error",
      message: "Could not determine project platform",
      exitCode: 20,
      output: {
        platform: "Node",
        commands: ["npm install"],
      },
    });
    expect(formatResultSpy).not.toHaveBeenCalled();
  });

  test("surfaces malformed action payload types", async () => {
    streamBatches = [
      [
        {
          type: "action_request",
          actionId: "bad-1",
          kind: "tool",
          name: "detect-platform",
          payload: {
            type: "unknown",
            operation: "list-dir",
            cwd: "/tmp/test",
            params: { path: "." },
          },
        },
      ],
      [{ type: "error", message: "Bad action payload" }],
    ];

    await expect(runWizard(makeOptions())).rejects.toThrow(WizardError);
    expect(resumeBodies[0]).toEqual({
      ok: false,
      error: expect.objectContaining({
        message: "Invalid tool action payload",
      }),
    });
  });

  test("shows a multiline tree while reading files and then analyzing them", async () => {
    streamBatches = [
      [
        {
          type: "action_request",
          actionId: "read-1",
          kind: "tool",
          name: "detect-platform",
          payload: {
            type: "tool",
            operation: "read-files",
            cwd: "/tmp/test",
            params: {
              paths: ["src/settings.py", "src/urls.py"],
            },
          },
        },
      ],
      [{ type: "done", ok: true }],
    ];

    await runWizard(makeOptions());

    const messages = spinnerMock.message.mock.calls.map((call: string[]) =>
      call[0]?.replace(
        // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping ANSI escape sequences
        /\x1b\[[^m]*m/g,
        ""
      )
    );
    expect(messages).toContain(
      "Reading files...\n├─ ● settings.py\n└─ ● urls.py"
    );
    expect(messages).toContain(
      "Analyzing files...\n├─ ✓ settings.py\n└─ ✓ urls.py"
    );
  });

  test("renders tool result messages via the spinner stop state", async () => {
    streamBatches = [
      [
        {
          type: "action_request",
          actionId: "ensure-1",
          kind: "tool",
          name: "ensure-sentry-project",
          payload: {
            type: "tool",
            operation: "create-sentry-project",
            cwd: "/tmp/test",
            params: { name: "my-app", platform: "javascript-react" },
          },
        },
      ],
      [{ type: "done", ok: true }],
    ];
    executeToolSpy.mockResolvedValue({
      ok: true,
      message: "Using existing project",
      data: {},
    });

    await runWizard(makeOptions());

    expect(spinnerMock.stop).toHaveBeenCalledWith("Using existing project");
  });
});
