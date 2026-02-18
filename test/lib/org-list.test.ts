/**
 * Tests for the shared org-scoped list infrastructure.
 *
 * Tests the core functions directly (fetchOrgSafe, fetchAllOrgs, handleOrgAll,
 * handleAutoDetect, handleExplicitOrg, dispatchOrgScopedList).
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
import { AuthError, ValidationError } from "../../src/lib/errors.js";
import {
  dispatchOrgScopedList,
  fetchAllOrgs,
  fetchOrgSafe,
  handleOrgAll,
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

function createStdout() {
  const write = mock((_chunk: string) => true);
  return { writer: { write }, write };
}

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
// dispatchOrgScopedList
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

  test("delegates to handleOrgAll for org-all parsed type", async () => {
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

  test("delegates to handleExplicitOrg for explicit parsed type", async () => {
    const items: FakeEntity[] = [{ id: "1", name: "A" }];
    const config = makeConfig({
      listForOrg: mock(() => Promise.resolve(items)),
    });
    const { writer, write } = createStdout();

    await dispatchOrgScopedList({
      config,
      stdout: writer,
      cwd: "/tmp",
      flags: { limit: 10, json: true },
      parsed: { type: "explicit", org: "my-org", project: "proj" },
    });

    const output = write.mock.calls.map((c) => c[0]).join("");
    const parsed = JSON.parse(output);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(1);
  });

  test("delegates to handleExplicitOrg for project-search parsed type", async () => {
    const items: FakeEntity[] = [{ id: "1", name: "A" }];
    const config = makeConfig({
      listForOrg: mock(() => Promise.resolve(items)),
    });
    const { writer, write } = createStdout();

    await dispatchOrgScopedList({
      config,
      stdout: writer,
      cwd: "/tmp",
      flags: { limit: 10, json: true },
      parsed: { type: "project-search", projectSlug: "my-proj" },
    });

    const output = write.mock.calls.map((c) => c[0]).join("");
    const parsed = JSON.parse(output);
    expect(Array.isArray(parsed)).toBe(true);
  });

  test("error message includes entity name", async () => {
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
});
