/**
 * Issue Archive Command Tests
 *
 * Tests for `sentry issue archive` func() body — substatus selection,
 * statusDetails construction, flag validation, and human output.
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
import { archiveCommand } from "../../../src/commands/issue/archive.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as issueUtils from "../../../src/commands/issue/utils.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as apiClient from "../../../src/lib/api-client.js";
import { ValidationError } from "../../../src/lib/errors.js";
import type { SentryIssue } from "../../../src/types/sentry.js";

function makeMockIssue(overrides?: Partial<SentryIssue>): SentryIssue {
  return {
    id: "123456789",
    shortId: "CLI-G5",
    title: "TypeError: boom",
    culprit: "handler",
    count: "10",
    userCount: 3,
    firstSeen: "2026-03-01T00:00:00Z",
    lastSeen: "2026-04-03T12:00:00Z",
    level: "error",
    status: "ignored",
    permalink: "https://sentry.io/organizations/test-org/issues/123456789/",
    project: { id: "456", slug: "test-project", name: "Test Project" },
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

describe("archiveCommand.func()", () => {
  let resolveIssueSpy: ReturnType<typeof spyOn>;
  let updateSpy: ReturnType<typeof spyOn>;
  let func: Awaited<ReturnType<typeof archiveCommand.loader>>;

  beforeEach(async () => {
    resolveIssueSpy = spyOn(issueUtils, "resolveIssue");
    updateSpy = spyOn(apiClient, "updateIssueStatus");
    func = await archiveCommand.loader();
  });

  afterEach(() => {
    resolveIssueSpy.mockRestore();
    updateSpy.mockRestore();
  });

  test("archives forever when no flags provided", async () => {
    resolveIssueSpy.mockResolvedValue({
      org: "test-org",
      issue: makeMockIssue({ status: "unresolved" }),
    });
    updateSpy.mockResolvedValue(makeMockIssue());

    const { context } = createMockContext();
    await func.call(context, { json: false }, "CLI-G5");

    expect(updateSpy).toHaveBeenCalledWith("123456789", "ignored", {
      substatus: "archived_forever",
      orgSlug: "test-org",
    });
  });

  test("archives until escalating with --until-escalating", async () => {
    resolveIssueSpy.mockResolvedValue({
      org: "test-org",
      issue: makeMockIssue(),
    });
    updateSpy.mockResolvedValue(makeMockIssue());

    const { context } = createMockContext();
    await func.call(
      context,
      { json: false, "until-escalating": true },
      "CLI-G5"
    );

    expect(updateSpy).toHaveBeenCalledWith("123456789", "ignored", {
      substatus: "archived_until_escalating",
      orgSlug: "test-org",
    });
  });

  test("archives with --duration sends ignoreDuration + condition substatus", async () => {
    resolveIssueSpy.mockResolvedValue({
      org: "test-org",
      issue: makeMockIssue(),
    });
    updateSpy.mockResolvedValue(makeMockIssue());

    const { context } = createMockContext();
    await func.call(context, { json: false, duration: 60 }, "CLI-G5");

    expect(updateSpy).toHaveBeenCalledWith("123456789", "ignored", {
      statusDetails: { ignoreDuration: 60 },
      substatus: "archived_until_condition_met",
      orgSlug: "test-org",
    });
  });

  test("archives with --count and --window sends both fields", async () => {
    resolveIssueSpy.mockResolvedValue({
      org: "test-org",
      issue: makeMockIssue(),
    });
    updateSpy.mockResolvedValue(makeMockIssue());

    const { context } = createMockContext();
    await func.call(context, { json: false, count: 100, window: 60 }, "CLI-G5");

    expect(updateSpy).toHaveBeenCalledWith("123456789", "ignored", {
      statusDetails: { ignoreCount: 100, ignoreWindow: 60 },
      substatus: "archived_until_condition_met",
      orgSlug: "test-org",
    });
  });

  test("archives with --users and --user-window sends both fields", async () => {
    resolveIssueSpy.mockResolvedValue({
      org: "test-org",
      issue: makeMockIssue(),
    });
    updateSpy.mockResolvedValue(makeMockIssue());

    const { context } = createMockContext();
    await func.call(
      context,
      { json: false, users: 10, "user-window": 120 },
      "CLI-G5"
    );

    expect(updateSpy).toHaveBeenCalledWith("123456789", "ignored", {
      statusDetails: { ignoreUserCount: 10, ignoreUserWindow: 120 },
      substatus: "archived_until_condition_met",
      orgSlug: "test-org",
    });
  });

  test("--count alone without --window sends only ignoreCount", async () => {
    resolveIssueSpy.mockResolvedValue({
      org: "test-org",
      issue: makeMockIssue(),
    });
    updateSpy.mockResolvedValue(makeMockIssue());

    const { context } = createMockContext();
    await func.call(context, { json: false, count: 50 }, "CLI-G5");

    expect(updateSpy).toHaveBeenCalledWith("123456789", "ignored", {
      statusDetails: { ignoreCount: 50 },
      substatus: "archived_until_condition_met",
      orgSlug: "test-org",
    });
  });

  test("human output includes 'Archived' label", async () => {
    resolveIssueSpy.mockResolvedValue({
      org: "test-org",
      issue: makeMockIssue(),
    });
    updateSpy.mockResolvedValue(makeMockIssue());

    const { context, stdoutWrite } = createMockContext();
    await func.call(context, { json: false }, "CLI-G5");

    const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("Archived");
    expect(output).toContain("CLI-G5");
  });
});

describe("archiveCommand.func() — validation", () => {
  let func: Awaited<ReturnType<typeof archiveCommand.loader>>;

  beforeEach(async () => {
    func = await archiveCommand.loader();
  });

  test("--window without --count throws ValidationError", async () => {
    const { context } = createMockContext();
    await expect(
      func.call(context, { json: false, window: 60 }, "CLI-G5")
    ).rejects.toBeInstanceOf(ValidationError);
  });

  test("--user-window without --users throws ValidationError", async () => {
    const { context } = createMockContext();
    await expect(
      func.call(context, { json: false, "user-window": 120 }, "CLI-G5")
    ).rejects.toBeInstanceOf(ValidationError);
  });

  test("--until-escalating with --duration throws ValidationError", async () => {
    const { context } = createMockContext();
    await expect(
      func.call(
        context,
        { json: false, "until-escalating": true, duration: 60 },
        "CLI-G5"
      )
    ).rejects.toBeInstanceOf(ValidationError);
  });

  test("--until-escalating with --count throws ValidationError", async () => {
    const { context } = createMockContext();
    await expect(
      func.call(
        context,
        { json: false, "until-escalating": true, count: 100 },
        "CLI-G5"
      )
    ).rejects.toBeInstanceOf(ValidationError);
  });

  test("--until-escalating with --users throws ValidationError", async () => {
    const { context } = createMockContext();
    await expect(
      func.call(
        context,
        { json: false, "until-escalating": true, users: 10 },
        "CLI-G5"
      )
    ).rejects.toBeInstanceOf(ValidationError);
  });
});
