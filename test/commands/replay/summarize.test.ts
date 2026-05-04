/**
 * Replay Summarize Command Tests
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
import { summarizeCommand } from "../../../src/commands/replay/summarize.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as apiClient from "../../../src/lib/api-client.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as resolveTarget from "../../../src/lib/resolve-target.js";
import type {
  ReplayDetails,
  ReplayRecordingSegments,
} from "../../../src/types/index.js";

const REPLAY_ID = "346789a703f6454384f1de473b8b9fcc";

function sampleReplay(overrides: Partial<ReplayDetails> = {}): ReplayDetails {
  return {
    id: REPLAY_ID,
    count_errors: 0,
    count_segments: 1,
    duration: 12,
    error_ids: [],
    info_ids: [],
    project_id: "42",
    started_at: "2025-01-01T00:00:00.000Z",
    tags: {},
    trace_ids: [],
    urls: ["https://example.com/signup"],
    user: null,
    warning_ids: [],
    ...overrides,
  };
}

function sampleSegments(): ReplayRecordingSegments {
  return [
    [
      {
        type: 4,
        timestamp: Date.parse("2025-01-01T00:00:01.000Z"),
        data: { href: "https://example.com/signup" },
      },
      {
        type: 5,
        timestamp: Date.parse("2025-01-01T00:00:02.000Z"),
        data: {
          tag: "deadClick",
          payload: { selector: "button[type=submit]", label: "Sign up" },
        },
      },
    ],
  ];
}

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

describe("replay summarize", () => {
  let getReplaySpy: ReturnType<typeof spyOn>;
  let getReplayRecordingSegmentsSpy: ReturnType<typeof spyOn>;
  let resolveTargetSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    getReplaySpy = spyOn(apiClient, "getReplay").mockResolvedValue(
      sampleReplay()
    );
    getReplayRecordingSegmentsSpy = spyOn(
      apiClient,
      "getReplayRecordingSegments"
    ).mockResolvedValue(sampleSegments());
    resolveTargetSpy = spyOn(
      resolveTarget,
      "resolveOrgOptionalProjectFromArg"
    ).mockResolvedValue({
      org: "test-org",
      project: "web",
      projectData: { id: "42", slug: "web", name: "Web" },
    });
  });

  afterEach(() => {
    getReplaySpy.mockRestore();
    getReplayRecordingSegmentsSpy.mockRestore();
    resolveTargetSpy.mockRestore();
  });

  test("renders a JSON replay behavior summary", async () => {
    const { context, stdoutWrite } = createMockContext();
    const func = await summarizeCommand.loader();
    await func.call(
      context,
      {
        fresh: false,
        json: true,
        "limit-events": 5,
        "limit-signals": 5,
        path: "/signup",
      },
      `test-org/web/${REPLAY_ID}`
    );

    const output = stdoutWrite.mock.calls.map((call) => call[0]).join("");
    const parsed = JSON.parse(output);
    expect(parsed.replayId).toBe(REPLAY_ID);
    expect(parsed.focusPath).toBe("/signup");
    expect(parsed.counts.clicks).toBe(1);
    expect(parsed.routes[0].path).toBe("/signup");
    expect(parsed.signals[0].kind).toBe("dead_click");
  });

  test("renders missing human duration without seconds suffix", async () => {
    getReplaySpy.mockResolvedValue(sampleReplay({ duration: null }));

    const { context, stdoutWrite } = createMockContext();
    const func = await summarizeCommand.loader();
    await func.call(
      context,
      {
        fresh: false,
        json: false,
        "limit-events": 5,
        "limit-signals": 5,
      },
      `test-org/web/${REPLAY_ID}`
    );

    const output = stdoutWrite.mock.calls.map((call) => call[0]).join("");
    expect(output).toContain("Duration: -");
    expect(output).not.toContain("Duration: -s");
  });
});
