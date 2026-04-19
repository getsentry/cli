/**
 * Issue Merge Command Tests
 *
 * Tests for `sentry issue merge` func() body — arg validation, cross-org
 * rejection, --into parent selection, and API call shape.
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
import { mergeCommand } from "../../../src/commands/issue/merge.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as issueUtils from "../../../src/commands/issue/utils.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as apiClient from "../../../src/lib/api-client.js";
import type { SentryIssue } from "../../../src/types/sentry.js";

function makeMockIssue(overrides?: Partial<SentryIssue>): SentryIssue {
  return {
    id: "100",
    shortId: "CLI-A",
    title: "Boom",
    culprit: "handler",
    count: "10",
    userCount: 1,
    firstSeen: "2026-03-01T00:00:00Z",
    lastSeen: "2026-04-03T12:00:00Z",
    level: "error",
    status: "unresolved",
    permalink: "https://sentry.io/organizations/test-org/issues/100/",
    project: { id: "1", slug: "cli", name: "cli" },
    ...overrides,
  } as SentryIssue;
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

describe("mergeCommand.func()", () => {
  let resolveIssueSpy: ReturnType<typeof spyOn>;
  let mergeSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    resolveIssueSpy = spyOn(issueUtils, "resolveIssue");
    mergeSpy = spyOn(apiClient, "mergeIssues");
  });

  afterEach(() => {
    resolveIssueSpy.mockRestore();
    mergeSpy.mockRestore();
  });

  test("rejects when fewer than 2 issues are provided", async () => {
    const { context } = createMockContext();
    const func = await mergeCommand.loader();
    const err = await func
      .call(context, { json: false }, "CLI-A")
      .catch((e: Error) => e);

    expect(err).toBeInstanceOf(Error);
    expect(err.message).toContain("needs at least 2 issue IDs");
    expect(mergeSpy).not.toHaveBeenCalled();
  });

  test("rejects cross-org merges with a friendly message", async () => {
    resolveIssueSpy.mockImplementation(({ issueArg }: { issueArg: string }) =>
      Promise.resolve({
        org: issueArg === "CLI-A" ? "org-one" : "org-two",
        issue: makeMockIssue({ shortId: issueArg, id: issueArg }),
      })
    );

    const { context } = createMockContext();
    const func = await mergeCommand.loader();
    const err = await func
      .call(context, { json: false }, "CLI-A", "CLI-B")
      .catch((e: Error) => e);

    expect(err.message).toContain("Cannot merge issues across organizations");
    expect(mergeSpy).not.toHaveBeenCalled();
  });

  test("calls mergeIssues with the resolved numeric IDs", async () => {
    resolveIssueSpy.mockImplementation(({ issueArg }: { issueArg: string }) =>
      Promise.resolve({
        org: "test-org",
        issue: makeMockIssue({
          shortId: issueArg,
          id: issueArg.replace("CLI-", "10"),
        }),
      })
    );
    mergeSpy.mockResolvedValue({ parent: "10A", children: ["10B", "10C"] });

    const { context } = createMockContext();
    const func = await mergeCommand.loader();
    await func.call(context, { json: false }, "CLI-A", "CLI-B", "CLI-C");

    expect(mergeSpy).toHaveBeenCalledWith("test-org", ["10A", "10B", "10C"]);
  });

  test("--into pins the parent by short ID", async () => {
    resolveIssueSpy.mockImplementation(({ issueArg }: { issueArg: string }) =>
      Promise.resolve({
        org: "test-org",
        issue: makeMockIssue({
          shortId: issueArg,
          id: issueArg.replace("CLI-", "10"),
        }),
      })
    );
    mergeSpy.mockResolvedValue({ parent: "10B", children: ["10A", "10C"] });

    const { context } = createMockContext();
    const func = await mergeCommand.loader();
    // Pass A, B, C but pin B as parent — ordered list sent to API starts with B
    await func.call(
      context,
      { json: false, into: "CLI-B" },
      "CLI-A",
      "CLI-B",
      "CLI-C"
    );

    const callArgs = mergeSpy.mock.calls[0] as [string, string[]];
    expect(callArgs[0]).toBe("test-org");
    expect(callArgs[1][0]).toBe("10B"); // parent moved to front
    expect(new Set(callArgs[1])).toEqual(new Set(["10A", "10B", "10C"]));
  });

  test("--into rejects a value that doesn't match any provided issue", async () => {
    resolveIssueSpy.mockImplementation(({ issueArg }: { issueArg: string }) =>
      Promise.resolve({
        org: "test-org",
        issue: makeMockIssue({
          shortId: issueArg,
          id: issueArg.replace("CLI-", "10"),
        }),
      })
    );

    const { context } = createMockContext();
    const func = await mergeCommand.loader();
    const err = await func
      .call(context, { json: false, into: "CLI-XYZ" }, "CLI-A", "CLI-B")
      .catch((e: Error) => e);

    expect(err.message).toContain(
      "--into 'CLI-XYZ' did not match any of the provided issues"
    );
    expect(mergeSpy).not.toHaveBeenCalled();
  });

  test("JSON output maps numeric IDs back to short IDs", async () => {
    resolveIssueSpy.mockImplementation(({ issueArg }: { issueArg: string }) =>
      Promise.resolve({
        org: "test-org",
        issue: makeMockIssue({
          shortId: issueArg,
          id: issueArg.replace("CLI-", "10"),
        }),
      })
    );
    mergeSpy.mockResolvedValue({ parent: "10A", children: ["10B"] });

    const { context, stdoutWrite } = createMockContext();
    const func = await mergeCommand.loader();
    await func.call(context, { json: true }, "CLI-A", "CLI-B");

    const output = stdoutWrite.mock.calls.map((c) => String(c[0])).join("");
    const parsed = JSON.parse(output) as {
      org: string;
      parent: { shortId: string; id: string };
      children: { shortId: string; id: string }[];
    };
    expect(parsed.org).toBe("test-org");
    expect(parsed.parent.shortId).toBe("CLI-A");
    expect(parsed.parent.id).toBe("10A");
    expect(parsed.children).toEqual([{ shortId: "CLI-B", id: "10B" }]);
  });
});
