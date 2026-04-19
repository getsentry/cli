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
  const stderrWrite = mock(() => true);
  return {
    context: {
      stdout: { write: stdoutWrite },
      stderr: { write: stderrWrite },
      cwd: "/tmp",
    },
    stdoutWrite,
    stderrWrite,
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

  test("rejects issues where org could not be determined", async () => {
    // One issue resolves without org (e.g. bare numeric ID, no DSN match),
    // the other has a known org — without the guard, the merge would
    // silently proceed to the known org and fail with a confusing API error.
    resolveIssueSpy.mockImplementation(({ issueArg }: { issueArg: string }) => {
      if (issueArg === "CLI-A") {
        return Promise.resolve({
          org: "my-org",
          issue: makeMockIssue({ shortId: "CLI-A", id: "10A" }),
        });
      }
      return Promise.resolve({
        org: undefined,
        issue: makeMockIssue({ shortId: "NO-ORG", id: "999" }),
      });
    });

    const { context } = createMockContext();
    const func = await mergeCommand.loader();
    const err = await func
      .call(context, { json: false }, "CLI-A", "999")
      .catch((e: Error) => e);

    expect(err.message).toContain("Could not determine the organization");
    expect(err.message).toContain("NO-ORG");
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

  test("--into accepts project-alias suffix (e.g. 'f-g')", async () => {
    // When the user passes `f-g` as --into, it doesn't match any shortId
    // on the direct-match fast path, so the command falls back to
    // resolveIssue and then matches by numeric ID.
    let callIdx = 0;
    resolveIssueSpy.mockImplementation(({ issueArg }: { issueArg: string }) => {
      callIdx += 1;
      // Positional args resolve to CLI-A / CLI-B
      if (issueArg === "CLI-A" || issueArg === "CLI-B") {
        return Promise.resolve({
          org: "test-org",
          issue: makeMockIssue({
            shortId: issueArg,
            id: issueArg.replace("CLI-", "10"),
          }),
        });
      }
      // --into 'f-g' resolves (alias lookup) to CLI-B
      if (issueArg === "f-g") {
        return Promise.resolve({
          org: "test-org",
          issue: makeMockIssue({ shortId: "CLI-B", id: "10B" }),
        });
      }
      return Promise.reject(new Error(`unexpected issueArg: ${issueArg}`));
    });
    mergeSpy.mockResolvedValue({ parent: "10B", children: ["10A"] });

    const { context } = createMockContext();
    const func = await mergeCommand.loader();
    await func.call(context, { json: false, into: "f-g" }, "CLI-A", "CLI-B");

    const callArgs = mergeSpy.mock.calls[0] as [string, string[]];
    // Parent (10B) moved to front of the merge call
    expect(callArgs[1][0]).toBe("10B");
    // Three resolve calls total: 2 positional + 1 alias fallback
    expect(callIdx).toBeGreaterThanOrEqual(3);
  });

  test("--into accepts org-qualified short ID", async () => {
    resolveIssueSpy.mockImplementation(({ issueArg }: { issueArg: string }) =>
      Promise.resolve({
        org: "test-org",
        issue: makeMockIssue({
          // resolveIssue returns bare short ID even if arg was org-qualified
          shortId: issueArg.split("/").pop() as string,
          id: (issueArg.split("/").pop() as string).replace("CLI-", "10"),
        }),
      })
    );
    mergeSpy.mockResolvedValue({ parent: "10B", children: ["10A", "10C"] });

    const { context } = createMockContext();
    const func = await mergeCommand.loader();
    // User passes org-qualified form to --into; should still match.
    await func.call(
      context,
      { json: false, into: "my-org/CLI-B" },
      "CLI-A",
      "CLI-B",
      "CLI-C"
    );

    const callArgs = mergeSpy.mock.calls[0] as [string, string[]];
    expect(callArgs[1][0]).toBe("10B"); // parent still moved to front
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

  test("JSON output maps numeric IDs back to short IDs with URL", async () => {
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
      parent: { shortId: string; id: string; url: string };
      children: { shortId: string; id: string }[];
    };
    expect(parsed.org).toBe("test-org");
    expect(parsed.parent.shortId).toBe("CLI-A");
    expect(parsed.parent.id).toBe("10A");
    // URL surfaces the canonical parent so users can click through.
    expect(parsed.parent.url).toContain("test-org");
    expect(parsed.parent.url).toContain("10A");
    expect(parsed.children).toEqual([{ shortId: "CLI-B", id: "10B" }]);
  });

  test("warns when --into preference is overridden by Sentry", async () => {
    resolveIssueSpy.mockImplementation(({ issueArg }: { issueArg: string }) =>
      Promise.resolve({
        org: "test-org",
        issue: makeMockIssue({
          shortId: issueArg,
          id: issueArg.replace("CLI-", "10"),
        }),
      })
    );
    // User asked for CLI-B, but Sentry picked CLI-A (e.g. larger by count)
    mergeSpy.mockResolvedValue({ parent: "10A", children: ["10B"] });

    const { context, stderrWrite } = createMockContext();
    const func = await mergeCommand.loader();
    await func.call(context, { json: false, into: "CLI-B" }, "CLI-A", "CLI-B");

    const stderr = stderrWrite.mock.calls.map((c) => String(c[0])).join("");
    expect(stderr).toContain("--into 'CLI-B' was a preference");
    expect(stderr).toContain("CLI-A as the canonical parent");
  });

  test("does not warn when --into preference was honored", async () => {
    resolveIssueSpy.mockImplementation(({ issueArg }: { issueArg: string }) =>
      Promise.resolve({
        org: "test-org",
        issue: makeMockIssue({
          shortId: issueArg,
          id: issueArg.replace("CLI-", "10"),
        }),
      })
    );
    // User asked for CLI-B, Sentry agreed.
    mergeSpy.mockResolvedValue({ parent: "10B", children: ["10A"] });

    const { context, stderrWrite } = createMockContext();
    const func = await mergeCommand.loader();
    await func.call(context, { json: false, into: "CLI-B" }, "CLI-A", "CLI-B");

    const stderr = stderrWrite.mock.calls.map((c) => String(c[0])).join("");
    expect(stderr).not.toContain("--into");
  });
});
