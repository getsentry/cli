/**
 * Tests for the shared org-scoped list infrastructure.
 *
 * Covers: fetchOrgSafe, fetchAllOrgs, handleOrgAll, handleAutoDetect,
 * handleExplicitOrg, handleExplicitProject, handleProjectSearch,
 * dispatchOrgScopedList (with and without overrides, metadata-only config).
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
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as apiClient from "../../src/lib/api-client.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as defaults from "../../src/lib/db/defaults.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as paginationDb from "../../src/lib/db/pagination.js";
import {
  AuthError,
  ContextError,
  ValidationError,
} from "../../src/lib/errors.js";
import {
  dispatchOrgScopedList,
  fetchAllOrgs,
  fetchOrgSafe,
  handleExplicitOrg,
  handleExplicitProject,
  handleOrgAll,
  handleProjectSearch,
  isOrgListConfig,
  type ListCommandMeta,
  type OrgListConfig,
} from "../../src/lib/org-list.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as resolveTarget from "../../src/lib/resolve-target.js";

type FakeEntity = { id: string; name: string };
type FakeWithOrg = FakeEntity & { orgSlug: string };

function makeConfig(
  overrides?: Partial<OrgListConfig<FakeEntity, FakeWithOrg>>
): OrgListConfig<FakeEntity, FakeWithOrg> {
  return {
    paginationKey: "test-list",
    entityName: "widget",
    entityPlural: "widgets",
    commandPrefix: "sentry widget list",
    listForOrg: mock(() => Promise.resolve([])),
    listPaginated: mock(() =>
      Promise.resolve({ data: [] as FakeEntity[], nextCursor: undefined })
    ),
    withOrg: (entity, orgSlug) => ({ ...entity, orgSlug }),
    displayTable: mock(() => {
      // no-op for test
    }),
    ...overrides,
  };
}

const META_ONLY: ListCommandMeta = {
  paginationKey: "meta-list",
  entityName: "thing",
  entityPlural: "things",
  commandPrefix: "sentry thing list",
};

function createStdout() {
  const write = mock((_chunk: string) => true);
  return { writer: { write }, write };
}

// ---------------------------------------------------------------------------
// isOrgListConfig
// ---------------------------------------------------------------------------

describe("isOrgListConfig", () => {
  test("returns true for full OrgListConfig", () => {
    expect(isOrgListConfig(makeConfig())).toBe(true);
  });

  test("returns false for ListCommandMeta only", () => {
    expect(isOrgListConfig(META_ONLY)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// fetchOrgSafe
// ---------------------------------------------------------------------------

describe("fetchOrgSafe", () => {
  test("returns entities with org context on success", async () => {
    const items: FakeEntity[] = [
      { id: "1", name: "A" },
      { id: "2", name: "B" },
    ];
    const config = makeConfig({
      listForOrg: mock(() => Promise.resolve(items)),
    });
    const result = await fetchOrgSafe(config, "my-org");

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ id: "1", name: "A", orgSlug: "my-org" });
    expect(result[1]).toEqual({ id: "2", name: "B", orgSlug: "my-org" });
  });

  test("returns empty array on non-auth error", async () => {
    const config = makeConfig({
      listForOrg: mock(() => Promise.reject(new Error("network"))),
    });
    const result = await fetchOrgSafe(config, "my-org");
    expect(result).toEqual([]);
  });

  test("rethrows AuthError", async () => {
    const config = makeConfig({
      listForOrg: mock(() =>
        Promise.reject(new AuthError("not_authenticated"))
      ),
    });
    await expect(fetchOrgSafe(config, "my-org")).rejects.toThrow(AuthError);
  });
});

// ---------------------------------------------------------------------------
// fetchAllOrgs
// ---------------------------------------------------------------------------

describe("fetchAllOrgs", () => {
  let listOrganizationsSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    listOrganizationsSpy = spyOn(apiClient, "listOrganizations");
  });

  afterEach(() => {
    listOrganizationsSpy.mockRestore();
  });

  test("fetches entities from all accessible orgs", async () => {
    listOrganizationsSpy.mockResolvedValue([
      { id: "1", slug: "org-a", name: "Org A" },
      { id: "2", slug: "org-b", name: "Org B" },
    ]);

    const items: FakeEntity[] = [{ id: "1", name: "Widget" }];
    const config = makeConfig({
      listForOrg: mock(() => Promise.resolve(items)),
    });

    const result = await fetchAllOrgs(config);
    expect(result).toHaveLength(2);
    expect(result[0]!.orgSlug).toBe("org-a");
    expect(result[1]!.orgSlug).toBe("org-b");
  });

  test("skips orgs with non-auth errors", async () => {
    listOrganizationsSpy.mockResolvedValue([
      { id: "1", slug: "org-a", name: "Org A" },
      { id: "2", slug: "org-b", name: "Org B" },
    ]);

    let callCount = 0;
    const config = makeConfig({
      listForOrg: mock(() => {
        callCount += 1;
        if (callCount === 1) return Promise.reject(new Error("forbidden"));
        return Promise.resolve([{ id: "1", name: "Widget" }]);
      }),
    });

    const result = await fetchAllOrgs(config);
    expect(result).toHaveLength(1);
    expect(result[0]!.orgSlug).toBe("org-b");
  });

  test("rethrows AuthError from any org", async () => {
    listOrganizationsSpy.mockResolvedValue([
      { id: "1", slug: "org-a", name: "Org A" },
    ]);

    const config = makeConfig({
      listForOrg: mock(() =>
        Promise.reject(new AuthError("not_authenticated"))
      ),
    });

    await expect(fetchAllOrgs(config)).rejects.toThrow(AuthError);
  });
});

// ---------------------------------------------------------------------------
// handleOrgAll
// ---------------------------------------------------------------------------

describe("handleOrgAll", () => {
  let setPaginationCursorSpy: ReturnType<typeof spyOn>;
  let clearPaginationCursorSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    setPaginationCursorSpy = spyOn(paginationDb, "setPaginationCursor");
    clearPaginationCursorSpy = spyOn(paginationDb, "clearPaginationCursor");
    setPaginationCursorSpy.mockReturnValue(undefined);
    clearPaginationCursorSpy.mockReturnValue(undefined);
  });

  afterEach(() => {
    setPaginationCursorSpy.mockRestore();
    clearPaginationCursorSpy.mockRestore();
  });

  test("JSON output with hasMore=true includes nextCursor", async () => {
    const items: FakeEntity[] = [{ id: "1", name: "A" }];
    const config = makeConfig({
      listPaginated: mock(() =>
        Promise.resolve({ data: items, nextCursor: "next:123" })
      ),
    });
    const { writer, write } = createStdout();

    await handleOrgAll({
      config,
      stdout: writer,
      org: "my-org",
      flags: { limit: 10, json: true },
      contextKey: "key",
      cursor: undefined,
    });

    const output = write.mock.calls.map((c) => c[0]).join("");
    const parsed = JSON.parse(output);
    expect(parsed.hasMore).toBe(true);
    expect(parsed.nextCursor).toBe("next:123");
    expect(parsed.data).toHaveLength(1);
  });

  test("JSON output with hasMore=false when no nextCursor", async () => {
    const config = makeConfig({
      listPaginated: mock(() =>
        Promise.resolve({
          data: [{ id: "1", name: "A" }],
          nextCursor: undefined,
        })
      ),
    });
    const { writer, write } = createStdout();

    await handleOrgAll({
      config,
      stdout: writer,
      org: "my-org",
      flags: { limit: 10, json: true },
      contextKey: "key",
      cursor: undefined,
    });

    const output = write.mock.calls.map((c) => c[0]).join("");
    const parsed = JSON.parse(output);
    expect(parsed.hasMore).toBe(false);
    expect(parsed.nextCursor).toBeUndefined();
  });

  test("human output shows 'no entities found' when empty", async () => {
    const config = makeConfig({
      listPaginated: mock(() =>
        Promise.resolve({ data: [] as FakeEntity[], nextCursor: undefined })
      ),
    });
    const { writer, write } = createStdout();

    await handleOrgAll({
      config,
      stdout: writer,
      org: "my-org",
      flags: { limit: 10, json: false },
      contextKey: "key",
      cursor: undefined,
    });

    const output = write.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("No widgets found in organization 'my-org'.");
  });

  test("human output shows next page hint when more available", async () => {
    const config = makeConfig({
      listPaginated: mock(() =>
        Promise.resolve({ data: [{ id: "1", name: "A" }], nextCursor: "x" })
      ),
    });
    const { writer, write } = createStdout();

    await handleOrgAll({
      config,
      stdout: writer,
      org: "my-org",
      flags: { limit: 10, json: false },
      contextKey: "key",
      cursor: undefined,
    });

    const output = write.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("more available");
    expect(output).toContain("sentry widget list my-org/ -c last");
  });

  test("sets pagination cursor when nextCursor present", async () => {
    const config = makeConfig({
      listPaginated: mock(() =>
        Promise.resolve({
          data: [{ id: "1", name: "A" }],
          nextCursor: "cursor:abc",
        })
      ),
    });
    const { writer } = createStdout();

    await handleOrgAll({
      config,
      stdout: writer,
      org: "my-org",
      flags: { limit: 10, json: false },
      contextKey: "ctx",
      cursor: undefined,
    });

    expect(setPaginationCursorSpy).toHaveBeenCalledWith(
      "test-list",
      "ctx",
      "cursor:abc"
    );
  });

  test("clears pagination cursor when no nextCursor", async () => {
    const config = makeConfig({
      listPaginated: mock(() =>
        Promise.resolve({
          data: [{ id: "1", name: "A" }],
          nextCursor: undefined,
        })
      ),
    });
    const { writer } = createStdout();

    await handleOrgAll({
      config,
      stdout: writer,
      org: "my-org",
      flags: { limit: 10, json: false },
      contextKey: "ctx",
      cursor: undefined,
    });

    expect(clearPaginationCursorSpy).toHaveBeenCalledWith("test-list", "ctx");
  });
});

// ---------------------------------------------------------------------------
// handleExplicitOrg
// ---------------------------------------------------------------------------

describe("handleExplicitOrg", () => {
  test("returns JSON array of entities", async () => {
    const config = makeConfig({
      listForOrg: mock(() => Promise.resolve([{ id: "1", name: "A" }])),
    });
    const { writer, write } = createStdout();

    await handleExplicitOrg({
      config,
      stdout: writer,
      org: "my-org",
      flags: { limit: 10, json: true },
    });

    const output = write.mock.calls.map((c) => c[0]).join("");
    const parsed = JSON.parse(output);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0].orgSlug).toBe("my-org");
  });

  test("writes org-scoped note when noteOrgScoped=true", async () => {
    const config = makeConfig({
      listForOrg: mock(() => Promise.resolve([{ id: "1", name: "A" }])),
    });
    const { writer, write } = createStdout();

    await handleExplicitOrg({
      config,
      stdout: writer,
      org: "my-org",
      flags: { limit: 10, json: false },
      noteOrgScoped: true,
    });

    const output = write.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("widgets are org-scoped");
    expect(output).toContain("my-org");
  });

  test("does not write org-scoped note when noteOrgScoped=false (default)", async () => {
    const config = makeConfig({
      listForOrg: mock(() => Promise.resolve([{ id: "1", name: "A" }])),
    });
    const { writer, write } = createStdout();

    await handleExplicitOrg({
      config,
      stdout: writer,
      org: "my-org",
      flags: { limit: 10, json: false },
    });

    const output = write.mock.calls.map((c) => c[0]).join("");
    expect(output).not.toContain("org-scoped");
  });

  test("does not write org-scoped note for JSON output even when noteOrgScoped=true", async () => {
    const config = makeConfig({
      listForOrg: mock(() => Promise.resolve([{ id: "1", name: "A" }])),
    });
    const { writer, write } = createStdout();

    await handleExplicitOrg({
      config,
      stdout: writer,
      org: "my-org",
      flags: { limit: 10, json: true },
      noteOrgScoped: true,
    });

    const output = write.mock.calls.map((c) => c[0]).join("");
    // Should be valid JSON, no prose note
    expect(() => JSON.parse(output)).not.toThrow();
    expect(output).not.toContain("org-scoped");
  });
});

// ---------------------------------------------------------------------------
// handleExplicitProject
// ---------------------------------------------------------------------------

describe("handleExplicitProject", () => {
  test("fetches and displays project-scoped entities", async () => {
    const listForProject = mock(() =>
      Promise.resolve([{ id: "1", name: "Team A" }])
    );
    const config = makeConfig({ listForProject });
    const { writer, write } = createStdout();

    await handleExplicitProject({
      config,
      stdout: writer,
      org: "my-org",
      project: "my-proj",
      flags: { limit: 10, json: true },
    });

    expect(listForProject).toHaveBeenCalledWith("my-org", "my-proj");
    const output = write.mock.calls.map((c) => c[0]).join("");
    const parsed = JSON.parse(output);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0].orgSlug).toBe("my-org");
  });

  test("throws when listForProject is not defined on config", async () => {
    const config = makeConfig(); // no listForProject
    const { writer } = createStdout();

    await expect(
      handleExplicitProject({
        config,
        stdout: writer,
        org: "my-org",
        project: "my-proj",
        flags: { limit: 10, json: false },
      })
    ).rejects.toThrow("listForProject is not defined");
  });

  test("shows 'no entities found' when project has none", async () => {
    const config = makeConfig({
      listForProject: mock(() => Promise.resolve([])),
    });
    const { writer, write } = createStdout();

    await handleExplicitProject({
      config,
      stdout: writer,
      org: "my-org",
      project: "my-proj",
      flags: { limit: 10, json: false },
    });

    const output = write.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("No widgets found");
    expect(output).toContain("my-org/my-proj");
  });
});

// ---------------------------------------------------------------------------
// handleProjectSearch
// ---------------------------------------------------------------------------

describe("handleProjectSearch", () => {
  let findProjectsBySlugSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    findProjectsBySlugSpy = spyOn(apiClient, "findProjectsBySlug");
  });

  afterEach(() => {
    findProjectsBySlugSpy.mockRestore();
  });

  test("throws ContextError when no project found", async () => {
    findProjectsBySlugSpy.mockResolvedValue([]);
    const config = makeConfig();
    const { writer } = createStdout();

    await expect(
      handleProjectSearch(config, writer, "no-such-project", {
        limit: 10,
        json: false,
      })
    ).rejects.toThrow(ContextError);
  });

  test("returns empty JSON array when no project found with --json", async () => {
    findProjectsBySlugSpy.mockResolvedValue([]);
    const config = makeConfig();
    const { writer, write } = createStdout();

    await handleProjectSearch(config, writer, "no-such-project", {
      limit: 10,
      json: true,
    });

    const output = write.mock.calls.map((c) => c[0]).join("");
    expect(JSON.parse(output)).toEqual([]);
  });

  test("with listForProject: fetches project-scoped entities", async () => {
    findProjectsBySlugSpy.mockResolvedValue([
      { orgSlug: "org-a", slug: "my-proj", id: "1", name: "My Project" },
    ]);
    const listForProject = mock(() =>
      Promise.resolve([{ id: "1", name: "Team A" }])
    );
    const config = makeConfig({ listForProject });
    const { writer, write } = createStdout();

    await handleProjectSearch(config, writer, "my-proj", {
      limit: 10,
      json: true,
    });

    expect(listForProject).toHaveBeenCalledWith("org-a", "my-proj");
    const output = write.mock.calls.map((c) => c[0]).join("");
    const parsed = JSON.parse(output);
    expect(parsed[0].orgSlug).toBe("org-a");
  });

  test("without listForProject: fetches from parent org (entity is org-scoped)", async () => {
    findProjectsBySlugSpy.mockResolvedValue([
      { orgSlug: "org-a", slug: "my-proj", id: "1", name: "My Project" },
    ]);
    const listForOrg = mock(() =>
      Promise.resolve([{ id: "1", name: "Repo A" }])
    );
    const config = makeConfig({ listForOrg });
    const { writer, write } = createStdout();

    await handleProjectSearch(config, writer, "my-proj", {
      limit: 10,
      json: true,
    });

    expect(listForOrg).toHaveBeenCalledWith("org-a");
    const output = write.mock.calls.map((c) => c[0]).join("");
    const parsed = JSON.parse(output);
    expect(parsed[0].orgSlug).toBe("org-a");
  });

  test("deduplicates orgs when multiple projects share one org", async () => {
    findProjectsBySlugSpy.mockResolvedValue([
      { orgSlug: "org-a", slug: "proj-1", id: "1", name: "Proj 1" },
      { orgSlug: "org-a", slug: "proj-2", id: "2", name: "Proj 2" },
    ]);
    const listForOrg = mock(() =>
      Promise.resolve([{ id: "1", name: "Repo A" }])
    );
    const config = makeConfig({ listForOrg });
    const { writer } = createStdout();

    await handleProjectSearch(config, writer, "proj", {
      limit: 10,
      json: true,
    });

    // org-a should only be fetched once
    expect(listForOrg).toHaveBeenCalledTimes(1);
  });

  test("shows multi-org note when project found in multiple orgs", async () => {
    findProjectsBySlugSpy.mockResolvedValue([
      { orgSlug: "org-a", slug: "my-proj", id: "1", name: "My Project" },
      { orgSlug: "org-b", slug: "my-proj", id: "2", name: "My Project" },
    ]);
    const config = makeConfig({
      listForOrg: mock(() => Promise.resolve([{ id: "1", name: "Widget" }])),
    });
    const { writer, write } = createStdout();

    await handleProjectSearch(config, writer, "my-proj", {
      limit: 10,
      json: false,
    });

    const output = write.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("2 organizations");
  });
});

// ---------------------------------------------------------------------------
// dispatchOrgScopedList — cursor validation and handler map pattern
// ---------------------------------------------------------------------------

describe("dispatchOrgScopedList", () => {
  let getDefaultOrganizationSpy: ReturnType<typeof spyOn>;
  let resolveAllTargetsSpy: ReturnType<typeof spyOn>;
  let setPaginationCursorSpy: ReturnType<typeof spyOn>;
  let clearPaginationCursorSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    getDefaultOrganizationSpy = spyOn(defaults, "getDefaultOrganization");
    resolveAllTargetsSpy = spyOn(resolveTarget, "resolveAllTargets");
    setPaginationCursorSpy = spyOn(paginationDb, "setPaginationCursor");
    clearPaginationCursorSpy = spyOn(paginationDb, "clearPaginationCursor");

    getDefaultOrganizationSpy.mockResolvedValue(null);
    resolveAllTargetsSpy.mockResolvedValue({ targets: [] });
    setPaginationCursorSpy.mockReturnValue(undefined);
    clearPaginationCursorSpy.mockReturnValue(undefined);
  });

  afterEach(() => {
    getDefaultOrganizationSpy.mockRestore();
    resolveAllTargetsSpy.mockRestore();
    setPaginationCursorSpy.mockRestore();
    clearPaginationCursorSpy.mockRestore();
  });

  test("throws ValidationError when --cursor used outside org-all mode", async () => {
    const config = makeConfig();
    const { writer } = createStdout();

    await expect(
      dispatchOrgScopedList({
        config,
        stdout: writer,
        cwd: "/tmp",
        flags: { limit: 10, json: false, cursor: "some-cursor" },
        parsed: { type: "explicit", org: "my-org", project: "my-proj" },
      })
    ).rejects.toThrow(ValidationError);
  });

  test("error message includes entity plural name", async () => {
    const config = makeConfig();
    const { writer } = createStdout();

    try {
      await dispatchOrgScopedList({
        config,
        stdout: writer,
        cwd: "/tmp",
        flags: { limit: 10, json: false, cursor: "x" },
        parsed: { type: "auto-detect" },
      });
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ValidationError);
      expect((e as ValidationError).message).toContain("widgets");
    }
  });

  test("delegates to handleOrgAll for org-all mode", async () => {
    const items: FakeEntity[] = [{ id: "1", name: "A" }];
    const config = makeConfig({
      listPaginated: mock(() =>
        Promise.resolve({ data: items, nextCursor: undefined })
      ),
    });
    const { writer, write } = createStdout();

    await dispatchOrgScopedList({
      config,
      stdout: writer,
      cwd: "/tmp",
      flags: { limit: 10, json: true },
      parsed: { type: "org-all", org: "my-org" },
    });

    const output = write.mock.calls.map((c) => c[0]).join("");
    const parsed = JSON.parse(output);
    expect(parsed.hasMore).toBe(false);
    expect(parsed.data).toHaveLength(1);
  });

  test("explicit mode uses listForProject when available", async () => {
    const listForProject = mock(() =>
      Promise.resolve([{ id: "1", name: "T" }])
    );
    const config = makeConfig({ listForProject });
    const { writer, write } = createStdout();

    await dispatchOrgScopedList({
      config,
      stdout: writer,
      cwd: "/tmp",
      flags: { limit: 10, json: true },
      parsed: { type: "explicit", org: "my-org", project: "my-proj" },
    });

    expect(listForProject).toHaveBeenCalledWith("my-org", "my-proj");
    const output = write.mock.calls.map((c) => c[0]).join("");
    expect(Array.isArray(JSON.parse(output))).toBe(true);
  });

  test("explicit mode falls back to org-scoped with note when no listForProject", async () => {
    const listForOrg = mock(() => Promise.resolve([{ id: "1", name: "R" }]));
    const config = makeConfig({ listForOrg }); // no listForProject
    const { writer, write } = createStdout();

    await dispatchOrgScopedList({
      config,
      stdout: writer,
      cwd: "/tmp",
      flags: { limit: 10, json: false },
      parsed: { type: "explicit", org: "my-org", project: "my-proj" },
    });

    expect(listForOrg).toHaveBeenCalledWith("my-org");
    const output = write.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("org-scoped");
  });

  test("override replaces default handler for that mode", async () => {
    const config = makeConfig();
    const { writer } = createStdout();
    const overrideCalled = mock(() => Promise.resolve());

    await dispatchOrgScopedList({
      config,
      stdout: writer,
      cwd: "/tmp",
      flags: { limit: 10, json: false },
      parsed: { type: "auto-detect" },
      overrides: {
        "auto-detect": overrideCalled,
      },
    });

    expect(overrideCalled).toHaveBeenCalledTimes(1);
  });

  test("override does not affect other modes", async () => {
    const items: FakeEntity[] = [{ id: "1", name: "A" }];
    const config = makeConfig({
      listPaginated: mock(() =>
        Promise.resolve({ data: items, nextCursor: undefined })
      ),
    });
    const { writer, write } = createStdout();
    const autoDetectOverride = mock(() => Promise.resolve());

    await dispatchOrgScopedList({
      config,
      stdout: writer,
      cwd: "/tmp",
      flags: { limit: 10, json: true },
      parsed: { type: "org-all", org: "my-org" },
      overrides: {
        "auto-detect": autoDetectOverride, // overrides auto-detect, not org-all
      },
    });

    // org-all default handler ran, not the auto-detect override
    expect(autoDetectOverride).not.toHaveBeenCalled();
    const output = write.mock.calls.map((c) => c[0]).join("");
    expect(JSON.parse(output).hasMore).toBe(false);
  });

  test("metadata-only config with full overrides dispatches correctly", async () => {
    const { writer } = createStdout();
    const handler = mock(() => Promise.resolve());

    await dispatchOrgScopedList({
      config: META_ONLY,
      stdout: writer,
      cwd: "/tmp",
      flags: { limit: 10, json: false },
      parsed: { type: "explicit", org: "my-org", project: "my-proj" },
      overrides: {
        "auto-detect": handler,
        explicit: handler,
        "project-search": handler,
        "org-all": handler,
      },
    });

    expect(handler).toHaveBeenCalledTimes(1);
  });

  test("metadata-only config without override for invoked mode throws", async () => {
    const { writer } = createStdout();

    await expect(
      dispatchOrgScopedList({
        config: META_ONLY,
        stdout: writer,
        cwd: "/tmp",
        flags: { limit: 10, json: false },
        parsed: { type: "auto-detect" },
        overrides: {
          // missing auto-detect override — should throw
          explicit: mock(() => Promise.resolve()),
        },
      })
    ).rejects.toThrow("No handler for 'auto-detect' mode");
  });
});
