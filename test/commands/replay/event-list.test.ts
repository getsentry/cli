/**
 * Replay Event List Command Tests
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
import { listCommand } from "../../../src/commands/replay/event/list.js";
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
    duration: 60,
    error_ids: [],
    info_ids: [],
    project_id: "42",
    started_at: "2025-01-01T00:00:00.000Z",
    tags: {},
    trace_ids: [],
    urls: ["/signup"],
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
        data: { href: "/signup" },
      },
      {
        type: 5,
        timestamp: Date.parse("2025-01-01T00:00:02.000Z"),
        data: {
          tag: "deadClick",
          payload: { selector: "button[type=submit]", label: "Sign up" },
        },
      },
      {
        type: 5,
        timestamp: Date.parse("2025-01-01T00:00:03.000Z"),
        data: {
          tag: "breadcrumb",
          payload: {
            category: "fetch",
            message: "POST /api/signup",
            data: { status_code: 500, url: "/api/signup" },
          },
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

describe("replay event list", () => {
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
      project: "cli",
      projectData: { id: "42", slug: "cli", name: "CLI" },
    });
  });

  afterEach(() => {
    getReplaySpy.mockRestore();
    getReplayRecordingSegmentsSpy.mockRestore();
    resolveTargetSpy.mockRestore();
  });

  test("renders filtered JSON event envelope", async () => {
    const { context, stdoutWrite } = createMockContext();
    const func = await listCommand.loader();
    await func.call(
      context,
      {
        fresh: false,
        json: true,
        jsonl: false,
        kind: ["click,network"],
        limit: 10,
        raw: false,
        url: "/signup",
      },
      `test-org/cli/${REPLAY_ID}`
    );

    expect(getReplayRecordingSegmentsSpy).toHaveBeenCalledWith(
      "test-org",
      "42",
      REPLAY_ID,
      { expectedSegments: 1 }
    );

    const output = stdoutWrite.mock.calls.map((call) => call[0]).join("");
    const parsed = JSON.parse(output);
    expect(parsed.data).toHaveLength(2);
    expect(parsed.data[0].kind).toBe("click");
    expect(parsed.data[0].selector).toBe("button[type=submit]");
    expect(parsed.data[1].kind).toBe("network");
    expect(parsed.total).toBe(2);
    expect(parsed.truncated).toBe(false);
  });

  test("emits JSONL when requested", async () => {
    const { context, stdoutWrite } = createMockContext();
    const func = await listCommand.loader();
    await func.call(
      context,
      {
        fresh: false,
        json: true,
        jsonl: true,
        limit: 2,
        raw: false,
      },
      `test-org/${REPLAY_ID}`
    );

    const lines = stdoutWrite.mock.calls
      .map((call) => call[0])
      .join("")
      .trim()
      .split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!).kind).toBe("navigation");
    expect(JSON.parse(lines[1]!).kind).toBe("click");
  });

  test("rejects before or after windows without around", async () => {
    const { context } = createMockContext();
    const func = await listCommand.loader();

    await expect(
      func.call(
        context,
        {
          before: 5000,
          fresh: false,
          json: true,
          jsonl: false,
          limit: 10,
          raw: false,
        },
        `test-org/cli/${REPLAY_ID}`
      )
    ).rejects.toThrow("--before and --after require --around");

    expect(getReplaySpy).not.toHaveBeenCalled();
    expect(getReplayRecordingSegmentsSpy).not.toHaveBeenCalled();
  });
});
