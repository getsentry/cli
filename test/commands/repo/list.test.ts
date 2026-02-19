/**
 * Repository List Command Tests
 *
 * Tests for the repo list command in src/commands/repo/list.ts.
 * Covers all four target modes (auto-detect, explicit, project-search, org-all)
 * plus cursor pagination, --cursor last, and error paths.
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
import { listCommand } from "../../../src/commands/repo/list.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as apiClient from "../../../src/lib/api-client.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as defaults from "../../../src/lib/db/defaults.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as paginationDb from "../../../src/lib/db/pagination.js";
import { ValidationError } from "../../../src/lib/errors.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as resolveTarget from "../../../src/lib/resolve-target.js";
import type { SentryRepository } from "../../../src/types/sentry.js";

// Sample test data
const sampleRepos: SentryRepository[] = [
  {
    id: "123",
    name: "getsentry/sentry",
    url: "https://github.com/getsentry/sentry",
    provider: { id: "integrations:github", name: "GitHub" },
    status: "active",
    dateCreated: "2024-01-15T10:00:00Z",
    integrationId: "456",
    externalSlug: "getsentry/sentry",
    externalId: "12345",
  },
  {
    id: "124",
    name: "getsentry/sentry-javascript",
    url: "https://github.com/getsentry/sentry-javascript",
    provider: { id: "integrations:github", name: "GitHub" },
    status: "active",
    dateCreated: "2024-01-16T11:00:00Z",
    integrationId: "456",
    externalSlug: "getsentry/sentry-javascript",
    externalId: "12346",
  },
];

function createMockContext(cwd = "/tmp") {
  const stdoutWrite = mock(() => true);
  const stderrWrite = mock(() => true);
  return {
    context: {
      stdout: { write: stdoutWrite },
      stderr: { write: stderrWrite },
      cwd,
      setContext: mock(() => {
        // no-op for test
      }),
    },
    stdoutWrite,
    stderrWrite,
  };
}

describe("listCommand.func — project-search (bare slug)", () => {
  let listRepositoriesSpy: ReturnType<typeof spyOn>;
  let findProjectsBySlugSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    listRepositoriesSpy = spyOn(apiClient, "listRepositories");
    findProjectsBySlugSpy = spyOn(apiClient, "findProjectsBySlug");
  });

  afterEach(() => {
    listRepositoriesSpy.mockRestore();
    findProjectsBySlugSpy.mockRestore();
  });

  test("outputs JSON array when --json flag is set", async () => {
    findProjectsBySlugSpy.mockResolvedValue([
      { slug: "test-proj", orgSlug: "test-org" },
    ]);
    listRepositoriesSpy.mockResolvedValue(sampleRepos);

    const { context, stdoutWrite } = createMockContext();
    const func = await listCommand.loader();
    await func.call(context, { limit: 30, json: true }, "test-proj");

    const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
    const parsed = JSON.parse(output);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].name).toBe("getsentry/sentry");
    expect(parsed[1].name).toBe("getsentry/sentry-javascript");
  });

  test("outputs empty JSON array when no repos found with --json", async () => {
    findProjectsBySlugSpy.mockResolvedValue([
      { slug: "test-proj", orgSlug: "test-org" },
    ]);
    listRepositoriesSpy.mockResolvedValue([]);

    const { context, stdoutWrite } = createMockContext();
    const func = await listCommand.loader();
    await func.call(context, { limit: 30, json: true }, "test-proj");

    const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
    expect(JSON.parse(output)).toEqual([]);
  });

  test("writes 'No repositories found' when empty without --json", async () => {
    findProjectsBySlugSpy.mockResolvedValue([
      { slug: "test-proj", orgSlug: "test-org" },
    ]);
    listRepositoriesSpy.mockResolvedValue([]);

    const { context, stdoutWrite } = createMockContext();
    const func = await listCommand.loader();
    await func.call(context, { limit: 30, json: false }, "test-proj");

    const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("No repositories found");
  });

  test("writes header and rows for human output", async () => {
    findProjectsBySlugSpy.mockResolvedValue([
      { slug: "test-proj", orgSlug: "test-org" },
    ]);
    listRepositoriesSpy.mockResolvedValue(sampleRepos);

    const { context, stdoutWrite } = createMockContext();
    const func = await listCommand.loader();
    await func.call(context, { limit: 30, json: false }, "test-proj");

    const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("ORG");
    expect(output).toContain("NAME");
    expect(output).toContain("PROVIDER");
    expect(output).toContain("STATUS");
    expect(output).toContain("URL");
    expect(output).toContain("getsentry/sentry");
    expect(output).toContain("getsentry/sentry-javascript");
    expect(output).toContain("GitHub");
    expect(output).toContain("active");
  });

  test("shows count when results exceed limit", async () => {
    const manyRepos = Array.from({ length: 10 }, (_, i) => ({
      ...sampleRepos[0]!,
      id: String(i),
      name: `repo-${i}`,
    }));
    findProjectsBySlugSpy.mockResolvedValue([
      { slug: "test-proj", orgSlug: "test-org" },
    ]);
    listRepositoriesSpy.mockResolvedValue(manyRepos);

    const { context, stdoutWrite } = createMockContext();
    const func = await listCommand.loader();
    await func.call(context, { limit: 5, json: false }, "test-proj");

    const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("Showing 5 of 10 repositories");
  });

  test("shows all repos when count is under limit", async () => {
    findProjectsBySlugSpy.mockResolvedValue([
      { slug: "test-proj", orgSlug: "test-org" },
    ]);
    listRepositoriesSpy.mockResolvedValue(sampleRepos);

    const { context, stdoutWrite } = createMockContext();
    const func = await listCommand.loader();
    await func.call(context, { limit: 30, json: false }, "test-proj");

    const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("Showing 2 repositories");
  });

  test("outputs empty JSON array when project not found", async () => {
    findProjectsBySlugSpy.mockResolvedValue([]);

    const { context, stdoutWrite } = createMockContext();
    const func = await listCommand.loader();
    await func.call(context, { limit: 30, json: true }, "unknown-proj");

    const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
    expect(JSON.parse(output)).toEqual([]);
  });
});

describe("listCommand.func — explicit org/project (org-scoped with note)", () => {
  let listRepositoriesSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    listRepositoriesSpy = spyOn(apiClient, "listRepositories");
  });

  afterEach(() => {
    listRepositoriesSpy.mockRestore();
  });

  test("explicit org/project uses org part (repos are org-scoped)", async () => {
    listRepositoriesSpy.mockResolvedValue(sampleRepos);

    const { context } = createMockContext();
    const func = await listCommand.loader();
    await func.call(context, { limit: 30, json: false }, "my-org/my-project");

    expect(listRepositoriesSpy).toHaveBeenCalledWith("my-org");
  });

  test("explicit org/project writes org-scoped note in human output", async () => {
    listRepositoriesSpy.mockResolvedValue(sampleRepos);

    const { context, stdoutWrite } = createMockContext();
    const func = await listCommand.loader();
    await func.call(context, { limit: 30, json: false }, "my-org/my-project");

    const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("org-scoped");
  });

  test("explicit org/project suppresses note in JSON output", async () => {
    listRepositoriesSpy.mockResolvedValue(sampleRepos);

    const { context, stdoutWrite } = createMockContext();
    const func = await listCommand.loader();
    await func.call(context, { limit: 30, json: true }, "my-org/my-project");

    const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
    const parsed = JSON.parse(output);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(2);
  });
});

describe("listCommand.func — auto-detect mode", () => {
  let listRepositoriesSpy: ReturnType<typeof spyOn>;
  let listOrganizationsSpy: ReturnType<typeof spyOn>;
  let getDefaultOrganizationSpy: ReturnType<typeof spyOn>;
  let resolveAllTargetsSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    listRepositoriesSpy = spyOn(apiClient, "listRepositories");
    listOrganizationsSpy = spyOn(apiClient, "listOrganizations");
    getDefaultOrganizationSpy = spyOn(defaults, "getDefaultOrganization");
    resolveAllTargetsSpy = spyOn(resolveTarget, "resolveAllTargets");

    getDefaultOrganizationSpy.mockResolvedValue(null);
    resolveAllTargetsSpy.mockResolvedValue({ targets: [] });
  });

  afterEach(() => {
    listRepositoriesSpy.mockRestore();
    listOrganizationsSpy.mockRestore();
    getDefaultOrganizationSpy.mockRestore();
    resolveAllTargetsSpy.mockRestore();
  });

  test("uses default organization when no org provided", async () => {
    getDefaultOrganizationSpy.mockResolvedValue("default-org");
    listRepositoriesSpy.mockResolvedValue(sampleRepos);

    const { context } = createMockContext();
    const func = await listCommand.loader();
    await func.call(context, { limit: 30, json: false }, undefined);

    expect(listRepositoriesSpy).toHaveBeenCalledWith("default-org");
  });

  test("uses DSN auto-detection when no org and no default", async () => {
    resolveAllTargetsSpy.mockResolvedValue({
      targets: [{ org: "detected-org", project: "some-project" }],
    });
    listRepositoriesSpy.mockResolvedValue(sampleRepos);

    const { context } = createMockContext();
    const func = await listCommand.loader();
    await func.call(context, { limit: 30, json: false }, undefined);

    expect(listRepositoriesSpy).toHaveBeenCalledWith("detected-org");
  });

  test("falls back to all orgs when no org specified and no detection", async () => {
    listOrganizationsSpy.mockResolvedValue([
      { id: "1", slug: "org-a", name: "Org A" },
      { id: "2", slug: "org-b", name: "Org B" },
    ]);
    listRepositoriesSpy.mockResolvedValue(sampleRepos);

    const { context } = createMockContext();
    const func = await listCommand.loader();
    await func.call(context, { limit: 30, json: false }, undefined);

    expect(listOrganizationsSpy).toHaveBeenCalled();
  });

  test("outputs JSON in auto-detect mode", async () => {
    getDefaultOrganizationSpy.mockResolvedValue("auto-org");
    listRepositoriesSpy.mockResolvedValue(sampleRepos);

    const { context, stdoutWrite } = createMockContext();
    const func = await listCommand.loader();
    await func.call(context, { limit: 30, json: true }, undefined);

    const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
    const parsed = JSON.parse(output);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(2);
  });

  test("shows 'No repositories found' in auto-detect when empty and single org", async () => {
    getDefaultOrganizationSpy.mockResolvedValue("empty-org");
    listRepositoriesSpy.mockResolvedValue([]);

    const { context, stdoutWrite } = createMockContext();
    const func = await listCommand.loader();
    await func.call(context, { limit: 30, json: false }, undefined);

    const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("No repositories found");
  });

  test("shows 'No repositories found.' fallback when no orgs at all", async () => {
    listOrganizationsSpy.mockResolvedValue([]);
    listRepositoriesSpy.mockResolvedValue([]);

    const { context, stdoutWrite } = createMockContext();
    const func = await listCommand.loader();
    await func.call(context, { limit: 30, json: false }, undefined);

    const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("No repositories found");
  });
});

describe("listCommand.func — org-all mode (cursor pagination)", () => {
  let listRepositoriesPaginatedSpy: ReturnType<typeof spyOn>;
  let getPaginationCursorSpy: ReturnType<typeof spyOn>;
  let setPaginationCursorSpy: ReturnType<typeof spyOn>;
  let clearPaginationCursorSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    listRepositoriesPaginatedSpy = spyOn(
      apiClient,
      "listRepositoriesPaginated"
    );
    getPaginationCursorSpy = spyOn(paginationDb, "getPaginationCursor");
    setPaginationCursorSpy = spyOn(paginationDb, "setPaginationCursor");
    clearPaginationCursorSpy = spyOn(paginationDb, "clearPaginationCursor");

    setPaginationCursorSpy.mockReturnValue(undefined);
    clearPaginationCursorSpy.mockReturnValue(undefined);
  });

  afterEach(() => {
    listRepositoriesPaginatedSpy.mockRestore();
    getPaginationCursorSpy.mockRestore();
    setPaginationCursorSpy.mockRestore();
    clearPaginationCursorSpy.mockRestore();
  });

  test("returns paginated JSON with hasMore=false when no nextCursor", async () => {
    listRepositoriesPaginatedSpy.mockResolvedValue({
      data: sampleRepos,
      nextCursor: undefined,
    });

    const { context, stdoutWrite } = createMockContext();
    const func = await listCommand.loader();
    await func.call(context, { limit: 25, json: true }, "my-org/");

    const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
    const parsed = JSON.parse(output);
    expect(parsed).toHaveProperty("data");
    expect(parsed).toHaveProperty("hasMore", false);
    expect(parsed.data).toHaveLength(2);
    expect(clearPaginationCursorSpy).toHaveBeenCalled();
  });

  test("returns paginated JSON with hasMore=true and nextCursor when more pages", async () => {
    listRepositoriesPaginatedSpy.mockResolvedValue({
      data: sampleRepos,
      nextCursor: "cursor:abc:123",
    });

    const { context, stdoutWrite } = createMockContext();
    const func = await listCommand.loader();
    await func.call(context, { limit: 25, json: true }, "my-org/");

    const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
    const parsed = JSON.parse(output);
    expect(parsed).toHaveProperty("hasMore", true);
    expect(parsed).toHaveProperty("nextCursor", "cursor:abc:123");
    expect(setPaginationCursorSpy).toHaveBeenCalled();
  });

  test("human output shows table and next page hint when hasMore", async () => {
    listRepositoriesPaginatedSpy.mockResolvedValue({
      data: sampleRepos,
      nextCursor: "cursor:abc:123",
    });

    const { context, stdoutWrite } = createMockContext();
    const func = await listCommand.loader();
    await func.call(context, { limit: 25, json: false }, "my-org/");

    const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("getsentry/sentry");
    expect(output).toContain("more available");
    expect(output).toContain("Next page:");
    expect(output).toContain("-c last");
  });

  test("human output shows count without next-page hint when no more", async () => {
    listRepositoriesPaginatedSpy.mockResolvedValue({
      data: sampleRepos,
      nextCursor: undefined,
    });

    const { context, stdoutWrite } = createMockContext();
    const func = await listCommand.loader();
    await func.call(context, { limit: 25, json: false }, "my-org/");

    const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("Showing 2 repositories");
    expect(output).not.toContain("Next page:");
  });

  test("human output 'No repositories found' when empty and no cursor", async () => {
    listRepositoriesPaginatedSpy.mockResolvedValue({
      data: [],
      nextCursor: undefined,
    });

    const { context, stdoutWrite } = createMockContext();
    const func = await listCommand.loader();
    await func.call(context, { limit: 25, json: false }, "my-org/");

    const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("No repositories found in organization 'my-org'.");
  });

  test("uses explicit cursor string when provided", async () => {
    listRepositoriesPaginatedSpy.mockResolvedValue({
      data: sampleRepos,
      nextCursor: undefined,
    });

    const { context } = createMockContext();
    const func = await listCommand.loader();
    await func.call(
      context,
      { limit: 25, json: false, cursor: "explicit:cursor:value" },
      "my-org/"
    );

    expect(listRepositoriesPaginatedSpy).toHaveBeenCalledWith(
      "my-org",
      expect.objectContaining({ cursor: "explicit:cursor:value" })
    );
  });

  test("resolves 'last' cursor from cache", async () => {
    getPaginationCursorSpy.mockReturnValue("cached:cursor:456");
    listRepositoriesPaginatedSpy.mockResolvedValue({
      data: sampleRepos,
      nextCursor: undefined,
    });

    const { context } = createMockContext();
    const func = await listCommand.loader();
    await func.call(
      context,
      { limit: 25, json: false, cursor: "last" },
      "my-org/"
    );

    expect(listRepositoriesPaginatedSpy).toHaveBeenCalledWith(
      "my-org",
      expect.objectContaining({ cursor: "cached:cursor:456" })
    );
  });

  test("throws ContextError when 'last' cursor not in cache", async () => {
    getPaginationCursorSpy.mockReturnValue(null);

    const { context } = createMockContext();
    const func = await listCommand.loader();

    await expect(
      func.call(context, { limit: 25, json: false, cursor: "last" }, "my-org/")
    ).rejects.toThrow("No saved cursor");
  });

  test("throws ValidationError when --cursor used outside org-all mode", async () => {
    const { context } = createMockContext();
    const func = await listCommand.loader();

    await expect(
      func.call(
        context,
        { limit: 25, json: false, cursor: "some-cursor" },
        "my-org/my-project"
      )
    ).rejects.toThrow(ValidationError);
  });

  test("passes perPage from limit to paginated call", async () => {
    listRepositoriesPaginatedSpy.mockResolvedValue({
      data: [],
      nextCursor: undefined,
    });

    const { context } = createMockContext();
    const func = await listCommand.loader();
    await func.call(context, { limit: 10, json: false }, "my-org/");

    expect(listRepositoriesPaginatedSpy).toHaveBeenCalledWith(
      "my-org",
      expect.objectContaining({ perPage: 10 })
    );
  });
});
