/**
 * Team List Command Tests
 *
 * Tests for the team list command in src/commands/team/list.ts.
 * Covers all four target modes (auto-detect, explicit, project-search, org-all)
 * plus cursor pagination, --cursor next/prev, and error paths.
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
import { listCommand } from "../../../src/commands/team/list.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as apiClient from "../../../src/lib/api-client.js";
import { DEFAULT_SENTRY_URL } from "../../../src/lib/constants.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as defaults from "../../../src/lib/db/defaults.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as paginationDb from "../../../src/lib/db/pagination.js";
import { setOrgRegion } from "../../../src/lib/db/regions.js";
import { ValidationError } from "../../../src/lib/errors.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as resolveTarget from "../../../src/lib/resolve-target.js";
import type { SentryTeam } from "../../../src/types/sentry.js";
import { useAuthMock } from "../../helpers.js";

// Sample test data
const sampleTeams: SentryTeam[] = [
  {
    id: "100",
    slug: "backend",
    name: "Backend Team",
    memberCount: 8,
    isMember: true,
    teamRole: null,
    dateCreated: "2024-01-10T09:00:00Z",
  },
  {
    id: "101",
    slug: "frontend",
    name: "Frontend Team",
    memberCount: 5,
    isMember: false,
    teamRole: null,
    dateCreated: "2024-02-15T14:00:00Z",
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
    },
    stdoutWrite,
    stderrWrite,
  };
}

useAuthMock();

describe("listCommand.func — project-search (bare slug)", () => {
  let listProjectTeamsSpy: ReturnType<typeof spyOn>;
  let findProjectsBySlugSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    listProjectTeamsSpy = spyOn(apiClient, "listProjectTeams");
    findProjectsBySlugSpy = spyOn(apiClient, "findProjectsBySlug");
  });

  afterEach(() => {
    listProjectTeamsSpy.mockRestore();
    findProjectsBySlugSpy.mockRestore();
  });

  test("outputs JSON array when --json flag is set", async () => {
    findProjectsBySlugSpy.mockResolvedValue({
      projects: [{ slug: "test-org-proj", orgSlug: "test-org" }],
      orgs: [],
    });
    listProjectTeamsSpy.mockResolvedValue(sampleTeams);

    const { context, stdoutWrite } = createMockContext();
    const func = await listCommand.loader();
    await func.call(context, { limit: 30, json: true }, "test-org-proj");

    const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
    const parsed = JSON.parse(output);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].slug).toBe("backend");
    expect(parsed[1].slug).toBe("frontend");
  });

  test("outputs empty JSON array when no teams found with --json", async () => {
    findProjectsBySlugSpy.mockResolvedValue({
      projects: [{ slug: "test-org-proj", orgSlug: "test-org" }],
      orgs: [],
    });
    listProjectTeamsSpy.mockResolvedValue([]);

    const { context, stdoutWrite } = createMockContext();
    const func = await listCommand.loader();
    await func.call(context, { limit: 30, json: true }, "test-org-proj");

    const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
    expect(JSON.parse(output)).toEqual([]);
  });

  test("writes 'No teams found' when empty without --json", async () => {
    findProjectsBySlugSpy.mockResolvedValue({
      projects: [{ slug: "test-org-proj", orgSlug: "test-org" }],
      orgs: [],
    });
    listProjectTeamsSpy.mockResolvedValue([]);

    const { context, stdoutWrite } = createMockContext();
    const func = await listCommand.loader();
    await func.call(context, { limit: 30, json: false }, "test-org-proj");

    const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("No teams found");
  });

  test("writes header and rows for human output", async () => {
    findProjectsBySlugSpy.mockResolvedValue({
      projects: [{ slug: "test-org-proj", orgSlug: "test-org" }],
      orgs: [],
    });
    listProjectTeamsSpy.mockResolvedValue(sampleTeams);

    const { context, stdoutWrite } = createMockContext();
    const func = await listCommand.loader();
    await func.call(context, { limit: 30, json: false }, "test-org-proj");

    const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("ORG");
    expect(output).toContain("SLUG");
    expect(output).toContain("NAME");
    expect(output).toContain("MEMBERS");
    expect(output).toContain("backend");
    expect(output).toContain("Backend Team");
    expect(output).toContain("8");
    expect(output).toContain("frontend");
    expect(output).toContain("Frontend Team");
    expect(output).toContain("5");
  });

  test("shows count when results exceed limit", async () => {
    const manyTeams = Array.from({ length: 10 }, (_, i) => ({
      ...sampleTeams[0]!,
      id: String(i),
      slug: `team-${i}`,
      name: `Team ${i}`,
    }));
    findProjectsBySlugSpy.mockResolvedValue({
      projects: [{ slug: "test-org-proj", orgSlug: "test-org" }],
      orgs: [],
    });
    listProjectTeamsSpy.mockResolvedValue(manyTeams);

    const { context, stdoutWrite } = createMockContext();
    const func = await listCommand.loader();
    await func.call(context, { limit: 5, json: false }, "test-org-proj");

    const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("Showing 5 of 10 teams");
  });

  test("shows all teams when count is under limit", async () => {
    findProjectsBySlugSpy.mockResolvedValue({
      projects: [{ slug: "test-org-proj", orgSlug: "test-org" }],
      orgs: [],
    });
    listProjectTeamsSpy.mockResolvedValue(sampleTeams);

    const { context, stdoutWrite } = createMockContext();
    const func = await listCommand.loader();
    await func.call(context, { limit: 30, json: false }, "test-org-proj");

    const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("Showing 2 teams");
  });

  test("outputs empty JSON array when project not found", async () => {
    findProjectsBySlugSpy.mockResolvedValue({ projects: [], orgs: [] });

    const { context, stdoutWrite } = createMockContext();
    const func = await listCommand.loader();
    await func.call(context, { limit: 30, json: true }, "unknown-proj");

    const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
    expect(JSON.parse(output)).toEqual([]);
  });
});

describe("listCommand.func — explicit org/project", () => {
  let listProjectTeamsSpy: ReturnType<typeof spyOn>;

  beforeEach(async () => {
    listProjectTeamsSpy = spyOn(apiClient, "listProjectTeams");
    setOrgRegion("my-org", DEFAULT_SENTRY_URL);
  });

  afterEach(() => {
    listProjectTeamsSpy.mockRestore();
  });

  test("explicit org/project calls listProjectTeams for that project", async () => {
    listProjectTeamsSpy.mockResolvedValue(sampleTeams);

    const { context } = createMockContext();
    const func = await listCommand.loader();
    await func.call(context, { limit: 30, json: false }, "my-org/my-project");

    expect(listProjectTeamsSpy).toHaveBeenCalledWith("my-org", "my-project");
  });

  test("explicit org/project outputs JSON from project-scoped fetch", async () => {
    listProjectTeamsSpy.mockResolvedValue(sampleTeams);

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
  let listTeamsSpy: ReturnType<typeof spyOn>;
  let listOrganizationsSpy: ReturnType<typeof spyOn>;
  let getDefaultOrganizationSpy: ReturnType<typeof spyOn>;
  let resolveAllTargetsSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    listTeamsSpy = spyOn(apiClient, "listTeams");
    listOrganizationsSpy = spyOn(apiClient, "listOrganizations");
    getDefaultOrganizationSpy = spyOn(defaults, "getDefaultOrganization");
    resolveAllTargetsSpy = spyOn(resolveTarget, "resolveAllTargets");

    getDefaultOrganizationSpy.mockReturnValue(null);
    resolveAllTargetsSpy.mockResolvedValue({ targets: [] });
  });

  afterEach(() => {
    listTeamsSpy.mockRestore();
    listOrganizationsSpy.mockRestore();
    getDefaultOrganizationSpy.mockRestore();
    resolveAllTargetsSpy.mockRestore();
  });

  test("uses default organization when no org provided", async () => {
    getDefaultOrganizationSpy.mockReturnValue("default-org");
    listTeamsSpy.mockResolvedValue(sampleTeams);

    const { context } = createMockContext();
    const func = await listCommand.loader();
    await func.call(context, { limit: 30, json: false }, undefined);

    expect(listTeamsSpy).toHaveBeenCalledWith("default-org");
  });

  test("uses DSN auto-detection when no org and no default", async () => {
    resolveAllTargetsSpy.mockResolvedValue({
      targets: [{ org: "detected-org", project: "some-project" }],
    });
    listTeamsSpy.mockResolvedValue(sampleTeams);

    const { context } = createMockContext();
    const func = await listCommand.loader();
    await func.call(context, { limit: 30, json: false }, undefined);

    expect(listTeamsSpy).toHaveBeenCalledWith("detected-org");
  });

  test("falls back to all orgs when no org specified and no detection", async () => {
    listOrganizationsSpy.mockResolvedValue([
      { id: "1", slug: "org-a", name: "Org A" },
      { id: "2", slug: "org-b", name: "Org B" },
    ]);
    listTeamsSpy.mockResolvedValue(sampleTeams);

    const { context } = createMockContext();
    const func = await listCommand.loader();
    await func.call(context, { limit: 30, json: false }, undefined);

    expect(listOrganizationsSpy).toHaveBeenCalled();
  });

  test("outputs JSON in auto-detect mode", async () => {
    getDefaultOrganizationSpy.mockReturnValue("auto-org");
    listTeamsSpy.mockResolvedValue(sampleTeams);

    const { context, stdoutWrite } = createMockContext();
    const func = await listCommand.loader();
    await func.call(context, { limit: 30, json: true }, undefined);

    const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
    const parsed = JSON.parse(output);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(2);
  });

  test("shows 'No teams found' in auto-detect when empty and single org", async () => {
    getDefaultOrganizationSpy.mockReturnValue("empty-org");
    listTeamsSpy.mockResolvedValue([]);

    const { context, stdoutWrite } = createMockContext();
    const func = await listCommand.loader();
    await func.call(context, { limit: 30, json: false }, undefined);

    const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("No teams found");
  });

  test("shows 'No teams found.' fallback when no orgs at all", async () => {
    listOrganizationsSpy.mockResolvedValue([]);
    listTeamsSpy.mockResolvedValue([]);

    const { context, stdoutWrite } = createMockContext();
    const func = await listCommand.loader();
    await func.call(context, { limit: 30, json: false }, undefined);

    const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("No teams found");
  });
});

describe("listCommand.func — org-all mode (cursor pagination)", () => {
  let listTeamsPaginatedSpy: ReturnType<typeof spyOn>;
  let advancePaginationStateSpy: ReturnType<typeof spyOn>;
  let hasPreviousPageSpy: ReturnType<typeof spyOn>;
  let resolveCursorSpy: ReturnType<typeof spyOn>;

  beforeEach(async () => {
    listTeamsPaginatedSpy = spyOn(apiClient, "listTeamsPaginated");
    advancePaginationStateSpy = spyOn(paginationDb, "advancePaginationState");
    hasPreviousPageSpy = spyOn(paginationDb, "hasPreviousPage");
    resolveCursorSpy = spyOn(paginationDb, "resolveCursor");

    advancePaginationStateSpy.mockReturnValue(undefined);
    hasPreviousPageSpy.mockReturnValue(false);
    setOrgRegion("my-org", DEFAULT_SENTRY_URL);
  });

  afterEach(() => {
    listTeamsPaginatedSpy.mockRestore();
    advancePaginationStateSpy.mockRestore();
    hasPreviousPageSpy.mockRestore();
    resolveCursorSpy.mockRestore();
  });

  test("returns paginated JSON with hasMore=false when no nextCursor", async () => {
    listTeamsPaginatedSpy.mockResolvedValue({
      data: sampleTeams,
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
    expect(advancePaginationStateSpy).toHaveBeenCalled();
  });

  test("returns paginated JSON with hasMore=true and nextCursor when more pages", async () => {
    listTeamsPaginatedSpy.mockResolvedValue({
      data: sampleTeams,
      nextCursor: "cursor:abc:123",
    });

    const { context, stdoutWrite } = createMockContext();
    const func = await listCommand.loader();
    await func.call(context, { limit: 25, json: true }, "my-org/");

    const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
    const parsed = JSON.parse(output);
    expect(parsed).toHaveProperty("hasMore", true);
    expect(parsed).toHaveProperty("nextCursor", "cursor:abc:123");
    expect(advancePaginationStateSpy).toHaveBeenCalled();
  });

  test("human output shows table and next page hint when hasMore", async () => {
    listTeamsPaginatedSpy.mockResolvedValue({
      data: sampleTeams,
      nextCursor: "cursor:abc:123",
    });

    const { context, stdoutWrite } = createMockContext();
    const func = await listCommand.loader();
    await func.call(context, { limit: 25, json: false }, "my-org/");

    const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("backend");
    expect(output).toContain("more available");
    expect(output).toContain("Next:");
    expect(output).toContain("-c next");
  });

  test("human output shows count without next-page hint when no more", async () => {
    listTeamsPaginatedSpy.mockResolvedValue({
      data: sampleTeams,
      nextCursor: undefined,
    });

    const { context, stdoutWrite } = createMockContext();
    const func = await listCommand.loader();
    await func.call(context, { limit: 25, json: false }, "my-org/");

    const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("Showing 2 teams");
    expect(output).not.toContain("Next:");
  });

  test("human output 'No teams found' when empty and no cursor", async () => {
    listTeamsPaginatedSpy.mockResolvedValue({
      data: [],
      nextCursor: undefined,
    });

    const { context, stdoutWrite } = createMockContext();
    const func = await listCommand.loader();
    await func.call(context, { limit: 25, json: false }, "my-org/");

    const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("No teams found in organization 'my-org'.");
  });

  test("uses explicit cursor string when provided", async () => {
    resolveCursorSpy.mockReturnValue({
      cursor: "explicit:cursor:value",
      direction: "next",
    });
    listTeamsPaginatedSpy.mockResolvedValue({
      data: sampleTeams,
      nextCursor: undefined,
    });

    const { context } = createMockContext();
    const func = await listCommand.loader();
    await func.call(
      context,
      { limit: 25, json: false, cursor: "explicit:cursor:value" },
      "my-org/"
    );

    expect(listTeamsPaginatedSpy).toHaveBeenCalledWith(
      "my-org",
      expect.objectContaining({ cursor: "explicit:cursor:value" })
    );
  });

  test("resolves '-c next' cursor from cache", async () => {
    resolveCursorSpy.mockReturnValue({
      cursor: "cached:cursor:456",
      direction: "next",
    });
    listTeamsPaginatedSpy.mockResolvedValue({
      data: sampleTeams,
      nextCursor: undefined,
    });

    const { context } = createMockContext();
    const func = await listCommand.loader();
    await func.call(
      context,
      { limit: 25, json: false, cursor: "next" },
      "my-org/"
    );

    expect(listTeamsPaginatedSpy).toHaveBeenCalledWith(
      "my-org",
      expect.objectContaining({ cursor: "cached:cursor:456" })
    );
  });

  test("throws ValidationError when '-c next' has no saved state", async () => {
    resolveCursorSpy.mockImplementation(() => {
      throw new ValidationError(
        "No next page saved for this query. Run without --cursor first.",
        "cursor"
      );
    });

    const { context } = createMockContext();
    const func = await listCommand.loader();

    await expect(
      func.call(context, { limit: 25, json: false, cursor: "next" }, "my-org/")
    ).rejects.toThrow("No next page saved");
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
    listTeamsPaginatedSpy.mockResolvedValue({
      data: [],
      nextCursor: undefined,
    });

    const { context } = createMockContext();
    const func = await listCommand.loader();
    await func.call(context, { limit: 10, json: false }, "my-org/");

    expect(listTeamsPaginatedSpy).toHaveBeenCalledWith(
      "my-org",
      expect.objectContaining({ perPage: 10 })
    );
  });
});
