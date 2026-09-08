/** Tests the issue link command, including its shared output wrapper. */

import { beforeEach, describe, expect, test, vi } from "vitest";
import { linkCommand } from "../../../src/commands/issue/link.js";
import { resolveIssue } from "../../../src/commands/issue/utils.js";
import { updateIssueStatus } from "../../../src/lib/api-client.js";
import {
  ApiError,
  ContextError,
  ValidationError,
} from "../../../src/lib/errors.js";
import {
  type ExternalIssueLinkResult,
  linkExternalIssue,
} from "../../../src/lib/issue-links.js";
import type { SentryIssue } from "../../../src/types/sentry.js";

vi.mock("../../../src/commands/issue/utils.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../../src/commands/issue/utils.js")
  >()),
  resolveIssue: vi.fn(),
}));

vi.mock("../../../src/lib/api-client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/lib/api-client.js")>()),
  updateIssueStatus: vi.fn(),
}));

vi.mock("../../../src/lib/issue-links.js", () => ({
  linkExternalIssue: vi.fn(),
}));

const externalUrl = "https://github.com/example/app/issues/42";
const defaultFlags = {
  "external-issue": externalUrl,
  "dry-run": false,
  json: false,
};
const issue = {
  id: "123456789",
  shortId: "APP-42",
  title: "TypeError: boom",
  culprit: "handler",
  count: "10",
  userCount: 3,
  firstSeen: "2026-03-01T00:00:00Z",
  lastSeen: "2026-04-03T12:00:00Z",
  level: "error",
  status: "unresolved",
  permalink: "https://sentry.io/organizations/test-org/issues/123456789/",
  project: { id: "456", slug: "test-project", name: "Test Project" },
} as SentryIssue;
const linkedResult: ExternalIssueLinkResult = {
  org: "test-org",
  issueId: "123456789",
  action: "link",
  linked: true,
  changed: true,
  externalIssue: {
    id: "789",
    identifier: "example/app#42",
    url: externalUrl,
    provider: "github",
  },
};

function createMockContext() {
  const stdoutWrite = vi.fn((_chunk: string) => true);
  return {
    context: {
      stdout: { write: stdoutWrite },
      stderr: { write: vi.fn((_chunk: string) => true) },
      cwd: "/tmp/example-project",
    },
    output: () => stdoutWrite.mock.calls.map(([chunk]) => chunk).join(""),
  };
}

describe("issue link", () => {
  beforeEach(() => {
    vi.mocked(resolveIssue).mockReset();
    vi.mocked(linkExternalIssue).mockReset();
    vi.mocked(updateIssueStatus).mockClear();
    vi.mocked(resolveIssue).mockResolvedValue({ org: "test-org", issue });
    vi.mocked(linkExternalIssue).mockResolvedValue(linkedResult);
  });

  test("forwards resolved organization, issue and project with the integration selector", async () => {
    const { context, output } = createMockContext();
    const func = await linkCommand.loader();
    await func.call(
      context,
      { ...defaultFlags, integration: "99" },
      "test-org/APP-42"
    );

    expect(resolveIssue).toHaveBeenCalledExactlyOnceWith({
      issueArg: "test-org/APP-42",
      cwd: "/tmp/example-project",
      command: "link",
    });
    expect(linkExternalIssue).toHaveBeenCalledExactlyOnceWith({
      orgSlug: "test-org",
      issueId: "123456789",
      projectId: "456",
      url: externalUrl,
      integrationId: "99",
      appSlug: undefined,
      fields: undefined,
      dryRun: false,
    });
    expect(output()).toContain("Linked");
    expect(output()).toContain(externalUrl);
    expect(output()).toContain("test-org/123456789");
    expect(updateIssueStatus).not.toHaveBeenCalled();
  });

  test("forwards an App selector and parses repeatable fields without losing values", async () => {
    const { context } = createMockContext();
    const func = await linkCommand.loader();
    await func.call(
      context,
      {
        ...defaultFlags,
        "external-issue": "https://tracker.example/issues/42",
        app: "custom-tracker",
        field: ["team=team-1", "query=key=value", "optional="],
      },
      "APP-42"
    );

    expect(linkExternalIssue).toHaveBeenCalledExactlyOnceWith({
      orgSlug: "test-org",
      issueId: "123456789",
      projectId: "456",
      url: "https://tracker.example/issues/42",
      integrationId: undefined,
      appSlug: "custom-tracker",
      fields: { team: "team-1", query: "key=value", optional: "" },
      dryRun: false,
    });
    expect(updateIssueStatus).not.toHaveBeenCalled();
  });

  test.each([
    ["team"],
    ["=team-1"],
    ["team=one", "team=two"],
    ["__proto__=value"],
    ["constructor=value"],
    ["prototype=value"],
  ])("rejects malformed or ambiguous --field input %j before resolving or writing", async (...fields) => {
    const { context, output } = createMockContext();
    const func = await linkCommand.loader();

    await expect(
      func.call(
        context,
        { ...defaultFlags, app: "custom-tracker", field: fields },
        "APP-42"
      )
    ).rejects.toBeInstanceOf(ValidationError);

    expect(resolveIssue).not.toHaveBeenCalled();
    expect(linkExternalIssue).not.toHaveBeenCalled();
    expect(output()).toBe("");
  });

  test("requires organization context before linking a numeric issue", async () => {
    vi.mocked(resolveIssue).mockResolvedValue({ org: undefined, issue });
    const { context } = createMockContext();
    const func = await linkCommand.loader();

    await expect(
      func.call(context, defaultFlags, "123456789")
    ).rejects.toBeInstanceOf(ContextError);
    expect(linkExternalIssue).not.toHaveBeenCalled();
  });

  test("renders a dry-run preview while forwarding the no-write flag", async () => {
    vi.mocked(linkExternalIssue).mockResolvedValue({
      ...linkedResult,
      linked: false,
      changed: false,
      dryRun: true,
    });
    const { context, output } = createMockContext();
    const func = await linkCommand.loader();
    await func.call(context, { ...defaultFlags, "dry-run": true }, "APP-42");

    expect(linkExternalIssue).toHaveBeenCalledWith(
      expect.objectContaining({ dryRun: true })
    );
    expect(output()).toContain("Would link");
    expect(output()).toContain("dry run");
    expect(updateIssueStatus).not.toHaveBeenCalled();
  });

  test.each([
    true,
    false,
  ])("emits structured link state with changed=%s in JSON", async (changed) => {
    const result = { ...linkedResult, changed };
    vi.mocked(linkExternalIssue).mockResolvedValue(result);
    const { context, output } = createMockContext();
    const func = await linkCommand.loader();
    await func.call(context, { ...defaultFlags, json: true }, "APP-42");

    expect(JSON.parse(output())).toEqual(result);
    expect(updateIssueStatus).not.toHaveBeenCalled();
  });

  test("propagates the original 403 so scope recovery can handle it", async () => {
    const error = new ApiError("Permission denied", 403, "Missing event:write");
    vi.mocked(linkExternalIssue).mockRejectedValue(error);
    const { context, output } = createMockContext();
    const func = await linkCommand.loader();

    await expect(
      func.call(context, { ...defaultFlags, json: true }, "APP-42")
    ).rejects.toBe(error);
    expect(output()).toBe("");
  });
});
