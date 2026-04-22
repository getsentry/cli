import {
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from "bun:test";
import { cancel, log } from "@clack/prompts";
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
import * as registry from "../../../src/lib/init/tools/registry.js";
import type {
  InitActionRequestEvent,
  ResolvedInitContext,
  ToolPayload,
  WizardOptions,
} from "../../../src/lib/init/types.js";
// biome-ignore lint/performance/noNamespaceImport: spyOn requires object reference
import * as transport from "../../../src/lib/init/transport.js";
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

function makeResponse(): Response {
  return new Response("", {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
    },
  });
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
let describeToolSpy: ReturnType<typeof spyOn>;
let executeToolSpy: ReturnType<typeof spyOn>;
let precomputeSentryDetectionSpy: ReturnType<typeof spyOn>;
let stderrSpy: ReturnType<typeof spyOn>;

let startInitStreamSpy: ReturnType<typeof spyOn>;
let reconnectInitStreamSpy: ReturnType<typeof spyOn>;
let resumeInitActionSpy: ReturnType<typeof spyOn>;
let readNdjsonStreamSpy: ReturnType<typeof spyOn>;

beforeEach(() => {
  process.exitCode = 0;

  introSpy = spyOn(clack, "intro").mockImplementation(noop);
  confirmSpy = spyOn(clack, "confirm").mockResolvedValue(true);
  cancelSpy = spyOn(clack, "cancel").mockImplementation(noop);
  logInfoSpy = spyOn(log, "info").mockImplementation(noop);
  logWarnSpy = spyOn(log, "warn").mockImplementation(noop);
  logErrorSpy = spyOn(log, "error").mockImplementation(noop);
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

  startInitStreamSpy = spyOn(transport, "startInitStream").mockResolvedValue({
    response: makeResponse(),
    runId: "run_123",
  });
  reconnectInitStreamSpy = spyOn(
    transport,
    "reconnectInitStream"
  ).mockResolvedValue(makeResponse());
  resumeInitActionSpy = spyOn(
    transport,
    "resumeInitAction"
  ).mockResolvedValue();
  readNdjsonStreamSpy = spyOn(transport, "readNdjsonStream").mockImplementation(
    async (_response, onEvent) => {
      await onEvent({
        output: {
          changedFiles: [],
          commands: [],
          docsUrl: "https://docs.sentry.io/platforms/javascript/guides/nextjs/",
          features: ["errorMonitoring"],
          message: "Done",
          platform: "Next.js",
          projectDir: "/tmp/test",
          sentryProjectUrl: "https://sentry.io/settings/test/projects/app/",
          warnings: [],
        },
        type: "summary",
      });
      await onEvent({
        ok: true,
        type: "done",
      });
      return 2;
    }
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
  precomputeSentryDetectionSpy.mockRestore();
  stderrSpy.mockRestore();

  startInitStreamSpy.mockRestore();
  reconnectInitStreamSpy.mockRestore();
  resumeInitActionSpy.mockRestore();
  readNdjsonStreamSpy.mockRestore();

  process.exitCode = 0;
});

describe("runWizard", () => {
  test("formats successful results", async () => {
    await runWizard(makeOptions());

    expect(formatResultSpy).toHaveBeenCalled();
    expect(formatErrorSpy).not.toHaveBeenCalled();
    expect(spinnerMock.stop).toHaveBeenCalledWith("Done", undefined);
  });

  test("dispatches tool payloads through the registry and resumes the action", async () => {
    const payload: ToolPayload = {
      cwd: "/tmp/test",
      operation: "run-commands",
      params: { commands: ["npm install @sentry/node"] },
      type: "tool",
    };

    readNdjsonStreamSpy.mockImplementationOnce(async (_response, onEvent) => {
      await onEvent({
        actionId: "run_123:action:001:run-commands",
        kind: "tool",
        name: "run-commands",
        payload,
        type: "action_request",
      });
      await onEvent({
        output: {
          changedFiles: [],
          commands: [],
          features: ["errorMonitoring"],
          message: "Done",
          warnings: [],
        },
        type: "summary",
      });
      await onEvent({
        ok: true,
        type: "done",
      });
      return 3;
    });

    await runWizard(makeOptions());

    expect(describeToolSpy).toHaveBeenCalledWith(payload);
    expect(executeToolSpy).toHaveBeenCalledWith(payload, makeContext());
    expect(resumeInitActionSpy).toHaveBeenCalledWith(
      "run_123:action:001:run-commands",
      expect.objectContaining({
        ok: true,
      }),
      expect.objectContaining({
        baseUrl: expect.any(String),
      })
    );
  });

  test("dedupes replayed action requests after reconnect", async () => {
    const event: InitActionRequestEvent = {
      actionId: "run_123:action:001:run-commands",
      description: "Installing dependencies",
      kind: "tool",
      name: "run-commands",
      payload: {
        cwd: "/tmp/test",
        operation: "run-commands",
        params: { commands: ["npm install"] },
        type: "tool",
      },
      type: "action_request",
    };

    readNdjsonStreamSpy
      .mockImplementationOnce(async (_response, onEvent) => {
        await onEvent(event);
        return 1;
      })
      .mockImplementationOnce(async (_response, onEvent) => {
        await onEvent(event);
        await onEvent({
          output: {
            changedFiles: [],
            commands: [],
            features: ["errorMonitoring"],
            message: "Done",
            warnings: [],
          },
          type: "summary",
        });
        await onEvent({
          ok: true,
          type: "done",
        });
        return 3;
      });

    await runWizard(makeOptions());

    expect(resumeInitActionSpy).toHaveBeenCalledTimes(1);
    expect(reconnectInitStreamSpy).toHaveBeenCalledWith(
      "run_123",
      1,
      expect.objectContaining({
        baseUrl: expect.any(String),
      })
    );
  });

  test("surfaces malformed stream events clearly", async () => {
    readNdjsonStreamSpy.mockRejectedValueOnce(new Error("Invalid status event"));

    await expect(runWizard(makeOptions())).rejects.toThrow(WizardError);
    expect(logErrorSpy).toHaveBeenCalledWith(
      "Malformed init stream event: Invalid status event"
    );
  });

  test("surfaces action resume failures clearly", async () => {
    resumeInitActionSpy.mockRejectedValue(new Error("connection dropped"));
    readNdjsonStreamSpy.mockImplementationOnce(async (_response, onEvent) => {
      await onEvent({
        actionId: "run_123:action:001:run-commands",
        description: "Installing dependencies",
        kind: "tool",
        name: "run-commands",
        payload: {
          cwd: "/tmp/test",
          operation: "run-commands",
          params: { commands: ["npm install"] },
          type: "tool",
        },
        type: "action_request",
      });
      return 1;
    });

    await expect(runWizard(makeOptions())).rejects.toThrow(WizardError);
    expect(logErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("Failed to resume tool action")
    );
  });

  test("surfaces retryable runner startup failures from the backend", async () => {
    startInitStreamSpy.mockRejectedValueOnce(
      new Error(
        "Init start failed (503): Runner did not become ready in time [retryable]"
      )
    );

    await expect(runWizard(makeOptions())).rejects.toThrow(WizardError);
    expect(logErrorSpy).toHaveBeenCalledWith(
      "Init start failed (503): Runner did not become ready in time [retryable]"
    );
    expect(cancel).toHaveBeenCalledWith("Setup failed");
  });
});
