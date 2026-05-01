/**
 * Replay View Command Tests
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
import {
  parsePositionalArgs,
  viewCommand,
} from "../../../src/commands/replay/view.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as apiClient from "../../../src/lib/api-client.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as browser from "../../../src/lib/browser.js";
import {
  ApiError,
  ContextError,
  ResolutionError,
} from "../../../src/lib/errors.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as resolveTarget from "../../../src/lib/resolve-target.js";
import type { ReplayDetails } from "../../../src/types/index.js";

const REPLAY_ID = "346789a703f6454384f1de473b8b9fcc";

function sampleReplay(overrides: Partial<ReplayDetails> = {}): ReplayDetails {
  return {
    id: REPLAY_ID,
    count_errors: 2,
    count_segments: 5,
    duration: 125,
    error_ids: [],
    info_ids: [],
    started_at: "2025-01-30T14:32:15+00:00",
    tags: {},
    project_id: "42",
    trace_ids: ["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
    urls: [],
    user: { display_name: "Test User" },
    warning_ids: [],
    ...overrides,
  };
}

describe("parsePositionalArgs", () => {
  test("parses replay ID only", () => {
    const result = parsePositionalArgs([REPLAY_ID]);
    expect(result.replayId).toBe(REPLAY_ID);
    expect(result.targetArg).toBeUndefined();
  });

  test("parses org/replay-id shorthand", () => {
    const result = parsePositionalArgs([`test-org/${REPLAY_ID}`]);
    expect(result.replayId).toBe(REPLAY_ID);
    expect(result.targetArg).toBe("test-org/");
  });

  test("parses org/project/replay-id form", () => {
    const result = parsePositionalArgs([`test-org/cli/${REPLAY_ID}`]);
    expect(result.replayId).toBe(REPLAY_ID);
    expect(result.targetArg).toBe("test-org/cli");
  });

  test("parses replay URL", () => {
    const result = parsePositionalArgs([
      `https://sentry.io/organizations/test-org/explore/replays/${REPLAY_ID}/`,
    ]);
    expect(result.replayId).toBe(REPLAY_ID);
    expect(result.targetArg).toBe("test-org/");
  });

  test("parses legacy replay URL", () => {
    const result = parsePositionalArgs([
      `https://test-org.sentry.io/replays/${REPLAY_ID}/`,
    ]);
    expect(result.replayId).toBe(REPLAY_ID);
    expect(result.targetArg).toBe("test-org/");
  });

  test("detects swapped args", () => {
    const result = parsePositionalArgs([REPLAY_ID, "test-org/cli"]);
    expect(result.replayId).toBe(REPLAY_ID);
    expect(result.targetArg).toBe("test-org/cli");
    expect(result.warning).toContain("reversed");
  });

  test("throws ContextError for org/project with no replay ID", () => {
    expect(() => parsePositionalArgs(["test-org/cli"])).toThrow(ContextError);
  });
});

describe("viewCommand.func", () => {
  let getReplaySpy: ReturnType<typeof spyOn>;
  let resolveTargetSpy: ReturnType<typeof spyOn>;
  let openInBrowserSpy: ReturnType<typeof spyOn>;

  function createMockContext() {
    const stdoutWrite = mock(() => true);
    return {
      context: {
        stdout: { write: stdoutWrite },
        stderr: { write: mock(() => true) },
        cwd: "/tmp",
      },
      stdoutWrite,
    };
  }

  beforeEach(() => {
    getReplaySpy = spyOn(apiClient, "getReplay");
    resolveTargetSpy = spyOn(resolveTarget, "resolveOrgOptionalProjectFromArg");
    openInBrowserSpy = spyOn(browser, "openInBrowser").mockResolvedValue();
  });

  afterEach(() => {
    getReplaySpy.mockRestore();
    resolveTargetSpy.mockRestore();
    openInBrowserSpy.mockRestore();
  });

  test("renders JSON output", async () => {
    resolveTargetSpy.mockResolvedValue({ org: "test-org", project: "cli" });
    getReplaySpy.mockResolvedValue(sampleReplay());

    const { context, stdoutWrite } = createMockContext();
    const func = await viewCommand.loader();
    await func.call(
      context,
      { json: true, web: false, fresh: false },
      REPLAY_ID
    );

    const output = stdoutWrite.mock.calls.map((call) => call[0]).join("");
    const parsed = JSON.parse(output);
    expect(parsed.id).toBe(REPLAY_ID);
    expect(parsed.trace_ids[0]).toBe("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  });

  test("opens the replay in the browser with --web", async () => {
    resolveTargetSpy.mockResolvedValue({ org: "test-org", project: "cli" });

    const { context } = createMockContext();
    const func = await viewCommand.loader();
    await func.call(
      context,
      { json: false, web: true, fresh: false },
      `test-org/${REPLAY_ID}`
    );

    expect(openInBrowserSpy).toHaveBeenCalledWith(
      "https://test-org.sentry.io/explore/replays/346789a703f6454384f1de473b8b9fcc/",
      "replay"
    );
  });

  test("opens the replay URL target from a replay URL with --web", async () => {
    resolveTargetSpy.mockResolvedValue({ org: "test-org", project: undefined });

    const { context } = createMockContext();
    const func = await viewCommand.loader();
    await func.call(
      context,
      { json: false, web: true, fresh: false },
      `https://sentry.io/organizations/test-org/explore/replays/${REPLAY_ID}/`
    );

    expect(openInBrowserSpy).toHaveBeenCalledWith(
      "https://test-org.sentry.io/explore/replays/346789a703f6454384f1de473b8b9fcc/",
      "replay"
    );
  });

  test("converts missing replays into ResolutionError", async () => {
    resolveTargetSpy.mockResolvedValue({ org: "test-org", project: "cli" });
    getReplaySpy.mockRejectedValue(
      new ApiError("Failed to get replay", 404, "Not Found")
    );

    const { context } = createMockContext();
    const func = await viewCommand.loader();

    await expect(
      func.call(context, { json: false, web: false, fresh: false }, REPLAY_ID)
    ).rejects.toThrow(ResolutionError);
  });
});
