/**
 * Tests for the shared list-command building blocks.
 *
 * Verifies that the shared flag/parameter constants have the correct shape
 * and that `buildOrgListCommand` produces a working command that delegates
 * to `dispatchOrgScopedList`.
 */

import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import {
  buildListLimitFlag,
  buildOrgListCommand,
  LIST_BASE_ALIASES,
  LIST_CURSOR_FLAG,
  LIST_JSON_FLAG,
  LIST_TARGET_POSITIONAL,
  type OrgListCommandDocs,
} from "../../src/lib/list-command.js";
import type { OrgListConfig } from "../../src/lib/org-list.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as orgListModule from "../../src/lib/org-list.js";

// ---------------------------------------------------------------------------
// Shared constants: shape / value assertions
// ---------------------------------------------------------------------------

describe("LIST_TARGET_POSITIONAL", () => {
  test("is a tuple with one optional string parameter", () => {
    expect(LIST_TARGET_POSITIONAL.kind).toBe("tuple");
    expect(LIST_TARGET_POSITIONAL.parameters).toHaveLength(1);
    const param = LIST_TARGET_POSITIONAL.parameters[0];
    expect(param.placeholder).toBe("org/project");
    expect(param.optional).toBe(true);
    expect(param.parse).toBe(String);
  });
});

describe("LIST_JSON_FLAG", () => {
  test("is a boolean flag defaulting to false", () => {
    expect(LIST_JSON_FLAG.kind).toBe("boolean");
    expect(LIST_JSON_FLAG.default).toBe(false);
  });
});

describe("LIST_CURSOR_FLAG", () => {
  test("is an optional parsed string flag", () => {
    expect(LIST_CURSOR_FLAG.kind).toBe("parsed");
    expect(LIST_CURSOR_FLAG.optional).toBe(true);
    expect(LIST_CURSOR_FLAG.parse).toBe(String);
    expect(LIST_CURSOR_FLAG.brief).toContain('"last"');
  });
});

describe("buildListLimitFlag", () => {
  test("uses provided entity plural in brief", () => {
    const flag = buildListLimitFlag("widgets");
    expect(flag.brief).toContain("widgets");
    expect(flag.kind).toBe("parsed");
  });

  test("defaults to '30' when no default provided", () => {
    const flag = buildListLimitFlag("teams");
    expect(flag.default).toBe("30");
  });

  test("uses provided default value", () => {
    const flag = buildListLimitFlag("issues", "10");
    expect(flag.default).toBe("10");
  });
});

describe("LIST_BASE_ALIASES", () => {
  test("maps n to limit and c to cursor", () => {
    expect(LIST_BASE_ALIASES.n).toBe("limit");
    expect(LIST_BASE_ALIASES.c).toBe("cursor");
  });

  test("can be spread with additional aliases", () => {
    const extended = { ...LIST_BASE_ALIASES, p: "platform" };
    expect(extended.n).toBe("limit");
    expect(extended.c).toBe("cursor");
    expect(extended.p).toBe("platform");
  });
});

// ---------------------------------------------------------------------------
// buildOrgListCommand: integration with dispatchOrgScopedList
// ---------------------------------------------------------------------------

type FakeEntity = { id: string; name: string };
type FakeWithOrg = FakeEntity & { orgSlug: string };

function makeFakeConfig(
  overrides?: Partial<OrgListConfig<FakeEntity, FakeWithOrg>>
): OrgListConfig<FakeEntity, FakeWithOrg> {
  return {
    paginationKey: "fake-list",
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

function createContext() {
  const write = mock((_chunk: string) => true);
  return {
    context: {
      stdout: { write },
      stderr: { write: mock((_chunk: string) => true) },
      cwd: "/tmp",
      setContext: mock(() => {
        // no-op for test
      }),
    },
    write,
  };
}

describe("buildOrgListCommand", () => {
  let dispatchSpy: ReturnType<typeof spyOn>;

  afterEach(() => {
    dispatchSpy?.mockRestore();
  });

  test("returns a command object with a loader", () => {
    const config = makeFakeConfig();
    const docs: OrgListCommandDocs = { brief: "List widgets" };
    const cmd = buildOrgListCommand(config, docs);
    expect(typeof cmd.loader).toBe("function");
  });

  test("calls dispatchOrgScopedList with correct config and flags", async () => {
    dispatchSpy = spyOn(
      orgListModule,
      "dispatchOrgScopedList"
    ).mockResolvedValue(undefined);

    const config = makeFakeConfig();
    const docs: OrgListCommandDocs = { brief: "List widgets" };
    const cmd = buildOrgListCommand(config, docs);
    const func = await cmd.loader();
    const { context } = createContext();

    await func.call(context, { limit: 5, json: true, cursor: undefined });

    expect(dispatchSpy).toHaveBeenCalledTimes(1);
    const callArgs = dispatchSpy.mock.calls[0]?.[0];
    expect(callArgs?.config).toBe(config);
    expect(callArgs?.flags).toEqual({
      limit: 5,
      json: true,
      cursor: undefined,
    });
  });

  test("passes parsed target to dispatchOrgScopedList", async () => {
    dispatchSpy = spyOn(
      orgListModule,
      "dispatchOrgScopedList"
    ).mockResolvedValue(undefined);

    const config = makeFakeConfig();
    const cmd = buildOrgListCommand(config, { brief: "List widgets" });
    const func = await cmd.loader();
    const { context } = createContext();

    await func.call(context, { limit: 30, json: false }, "my-org/");

    const callArgs = dispatchSpy.mock.calls[0]?.[0];
    expect(callArgs?.parsed).toMatchObject({ type: "org-all", org: "my-org" });
  });

  test("passes undefined parsed target when no positional arg given", async () => {
    dispatchSpy = spyOn(
      orgListModule,
      "dispatchOrgScopedList"
    ).mockResolvedValue(undefined);

    const config = makeFakeConfig();
    const cmd = buildOrgListCommand(config, { brief: "List widgets" });
    const func = await cmd.loader();
    const { context } = createContext();

    await func.call(context, { limit: 30, json: false });

    const callArgs = dispatchSpy.mock.calls[0]?.[0];
    expect(callArgs?.parsed).toMatchObject({ type: "auto-detect" });
  });
});
