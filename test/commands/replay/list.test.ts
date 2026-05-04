/**
 * Replay List Command Tests
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
import { listCommand, parseSort } from "../../../src/commands/replay/list.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as apiClient from "../../../src/lib/api-client.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as paginationDb from "../../../src/lib/db/pagination.js";
import { LIST_PERIOD_FLAG } from "../../../src/lib/list-command.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as resolveTarget from "../../../src/lib/resolve-target.js";
import { parsePeriod } from "../../../src/lib/time-range.js";
import {
  REPLAY_LIST_FIELDS,
  type ReplayListItem,
} from "../../../src/types/index.js";

describe("parseSort", () => {
  test("accepts supported sort values", () => {
    expect(parseSort("date")).toBe("-started_at");
    expect(parseSort("duration")).toBe("-duration");
    expect(parseSort("errors")).toBe("-count_errors");
    expect(parseSort("-count_rage_clicks")).toBe("-count_rage_clicks");
  });

  test("throws for invalid sort value", () => {
    expect(() => parseSort("invalid")).toThrow("Invalid sort value");
  });
});

describe("listCommand.func", () => {
  let listReplaysSpy: ReturnType<typeof spyOn>;
  let resolveTargetSpy: ReturnType<typeof spyOn>;
  let resolveCursorSpy: ReturnType<typeof spyOn>;
  let advancePaginationStateSpy: ReturnType<typeof spyOn>;
  let hasPreviousPageSpy: ReturnType<typeof spyOn>;

  const sampleReplays: ReplayListItem[] = [
    {
      id: "346789a703f6454384f1de473b8b9fcc",
      count_errors: 2,
      count_segments: 5,
      duration: 125,
      error_ids: [],
      info_ids: [],
      started_at: "2025-01-30T14:32:15+00:00",
      tags: {},
      project_id: "42",
      trace_ids: [],
      urls: [],
      user: { display_name: "Test User" },
      warning_ids: [],
    },
  ];

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
    listReplaysSpy = spyOn(apiClient, "listReplays");
    resolveTargetSpy = spyOn(resolveTarget, "resolveOrgOptionalProjectFromArg");
    resolveCursorSpy = spyOn(paginationDb, "resolveCursor").mockReturnValue({
      cursor: undefined,
      direction: "next" as const,
    });
    advancePaginationStateSpy = spyOn(
      paginationDb,
      "advancePaginationState"
    ).mockReturnValue(undefined);
    hasPreviousPageSpy = spyOn(paginationDb, "hasPreviousPage").mockReturnValue(
      false
    );
  });

  afterEach(() => {
    listReplaysSpy.mockRestore();
    resolveTargetSpy.mockRestore();
    resolveCursorSpy.mockRestore();
    advancePaginationStateSpy.mockRestore();
    hasPreviousPageSpy.mockRestore();
  });

  test("renders JSON output and forwards project scope", async () => {
    resolveTargetSpy.mockResolvedValue({ org: "test-org", project: "cli" });
    listReplaysSpy.mockResolvedValue({
      data: sampleReplays,
      nextCursor: "0:25:0",
    });

    const { context, stdoutWrite } = createMockContext();
    const func = await listCommand.loader();
    await func.call(
      context,
      { limit: 25, json: true, period: parsePeriod("7d"), sort: "-started_at" },
      "test-org/cli"
    );

    expect(listReplaysSpy).toHaveBeenCalledWith("test-org", {
      environment: undefined,
      fields: [...REPLAY_LIST_FIELDS],
      limit: 25,
      projectSlugs: ["cli"],
      query: undefined,
      sort: "-started_at",
      cursor: undefined,
      statsPeriod: "7d",
    });

    const output = stdoutWrite.mock.calls.map((call) => call[0]).join("");
    const parsed = JSON.parse(output);
    expect(parsed.hasMore).toBe(true);
    expect(parsed.hasPrev).toBe(false);
    expect(parsed.nextCursor).toBe("0:25:0");
    expect(parsed.data[0].id).toBe(sampleReplays[0]?.id);
  });

  test("passes replay environment filters through to the API", async () => {
    resolveTargetSpy.mockResolvedValue({ org: "test-org", project: "cli" });
    listReplaysSpy.mockResolvedValue({
      data: sampleReplays,
      nextCursor: undefined,
    });

    const { context } = createMockContext();
    const func = await listCommand.loader();
    await func.call(
      context,
      {
        environment: ["production,canary", "staging"],
        limit: 25,
        json: true,
        period: parsePeriod("7d"),
        sort: "-started_at",
      },
      "test-org/cli"
    );

    expect(listReplaysSpy).toHaveBeenCalledWith("test-org", {
      environment: ["production", "canary", "staging"],
      fields: [...REPLAY_LIST_FIELDS],
      limit: 25,
      projectSlugs: ["cli"],
      query: undefined,
      sort: "-started_at",
      cursor: undefined,
      statsPeriod: "7d",
    });
  });

  test("combines URL sugar with query and filters problem-only rows", async () => {
    resolveTargetSpy.mockResolvedValue({ org: "test-org", project: "cli" });
    listReplaysSpy.mockResolvedValue({
      data: [
        sampleReplays[0]!,
        {
          ...sampleReplays[0]!,
          id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          count_errors: 0,
          count_dead_clicks: 0,
          count_rage_clicks: 0,
          count_warnings: 0,
          error_ids: [],
          warning_ids: [],
        },
      ],
      nextCursor: undefined,
    });

    const { context, stdoutWrite } = createMockContext();
    const func = await listCommand.loader();
    await func.call(
      context,
      {
        "problem-only": true,
        limit: 25,
        json: true,
        period: parsePeriod("7d"),
        query: "environment:production",
        sort: "-started_at",
        url: "/signup",
      },
      "test-org/cli"
    );

    expect(listReplaysSpy).toHaveBeenCalledWith("test-org", {
      environment: undefined,
      fields: [...REPLAY_LIST_FIELDS],
      limit: 25,
      projectSlugs: ["cli"],
      query: "environment:production url:*/signup*",
      sort: "-started_at",
      cursor: undefined,
      statsPeriod: "7d",
    });

    const output = stdoutWrite.mock.calls.map((call) => call[0]).join("");
    const parsed = JSON.parse(output);
    expect(parsed.data).toHaveLength(1);
    expect(parsed.data[0].id).toBe(sampleReplays[0]?.id);
  });

  test("filters --path by actual replay URL pathname", async () => {
    resolveTargetSpy.mockResolvedValue({ org: "test-org", project: "cli" });
    listReplaysSpy.mockResolvedValue({
      data: [
        {
          ...sampleReplays[0]!,
          urls: ["https://example.com/signup/direct"],
        },
        {
          ...sampleReplays[0]!,
          id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          urls: ["https://example.com/replays/?query=/signup"],
        },
      ],
      nextCursor: undefined,
    });

    const { context, stdoutWrite } = createMockContext();
    const func = await listCommand.loader();
    await func.call(
      context,
      {
        limit: 25,
        json: true,
        path: "/signup",
        period: parsePeriod("7d"),
        sort: "-started_at",
      },
      "test-org/cli"
    );

    expect(listReplaysSpy).toHaveBeenCalledWith("test-org", {
      environment: undefined,
      fields: [...REPLAY_LIST_FIELDS],
      limit: 25,
      projectSlugs: ["cli"],
      query: "url:*/signup*",
      sort: "-started_at",
      cursor: undefined,
      statsPeriod: "7d",
    });

    const output = stdoutWrite.mock.calls.map((call) => call[0]).join("");
    const parsed = JSON.parse(output);
    expect(parsed.data).toHaveLength(1);
    expect(parsed.data[0].urls[0]).toBe("https://example.com/signup/direct");
  });

  test("renders human output with a replay hint", async () => {
    resolveTargetSpy.mockResolvedValue({ org: "test-org", project: "cli" });
    listReplaysSpy.mockResolvedValue({ data: sampleReplays });

    const { context, stdoutWrite } = createMockContext();
    const func = await listCommand.loader();
    await func.call(
      context,
      {
        limit: 25,
        json: false,
        period: parsePeriod("7d"),
        sort: "-started_at",
      },
      "test-org/cli"
    );

    const output = stdoutWrite.mock.calls.map((call) => call[0]).join("");
    expect(output).toContain("Recent replays in test-org/cli:");
    expect(output).toContain("Test User");
    expect(output).toContain("Showing 1 replay.");
    expect(output).toContain("sentry replay view test-org/");
  });

  test("omits --period in next-page hints for the shared default period", async () => {
    resolveTargetSpy.mockResolvedValue({ org: "test-org", project: "cli" });
    listReplaysSpy.mockResolvedValue({
      data: sampleReplays,
      nextCursor: "0:25:0",
    });

    const { context, stdoutWrite } = createMockContext();
    const func = await listCommand.loader();
    await func.call(
      context,
      {
        limit: 25,
        json: false,
        period: parsePeriod(LIST_PERIOD_FLAG.default),
        sort: "-started_at",
      },
      "test-org/cli"
    );

    const output = stdoutWrite.mock.calls.map((call) => call[0]).join("");
    expect(output).toContain("sentry replay list test-org/cli -c next");
    expect(output).not.toContain("--period");
  });
});
