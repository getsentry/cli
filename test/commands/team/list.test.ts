/**
 * Team List Command Tests
 *
 * Tests for the team list command in src/commands/team/list.ts.
 * Uses spyOn to mock api-client and resolve-target to test
 * the func() body without real HTTP calls or database access.
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
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as defaults from "../../../src/lib/db/defaults.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as resolveTarget from "../../../src/lib/resolve-target.js";
import type { SentryTeam } from "../../../src/types/sentry.js";

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

function createMockContext() {
  const stdoutWrite = mock(() => true);
  return {
    context: {
      stdout: { write: stdoutWrite },
      stderr: { write: mock(() => true) },
      cwd: "/tmp",
      setContext: mock(() => {
        // no-op for test
      }),
    },
    stdoutWrite,
  };
}

describe("listCommand.func", () => {
  let listTeamsSpy: ReturnType<typeof spyOn>;
  let listOrganizationsSpy: ReturnType<typeof spyOn>;
  let getDefaultOrganizationSpy: ReturnType<typeof spyOn>;
  let resolveAllTargetsSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    listTeamsSpy = spyOn(apiClient, "listTeams");
    listOrganizationsSpy = spyOn(apiClient, "listOrganizations");
    getDefaultOrganizationSpy = spyOn(defaults, "getDefaultOrganization");
    resolveAllTargetsSpy = spyOn(resolveTarget, "resolveAllTargets");

    // Default: no default org, no DSN detection
    getDefaultOrganizationSpy.mockResolvedValue(null);
    resolveAllTargetsSpy.mockResolvedValue({ targets: [] });
  });

  afterEach(() => {
    listTeamsSpy.mockRestore();
    listOrganizationsSpy.mockRestore();
    getDefaultOrganizationSpy.mockRestore();
    resolveAllTargetsSpy.mockRestore();
  });

  test("outputs JSON array when --json flag is set", async () => {
    listTeamsSpy.mockResolvedValue(sampleTeams);

    const { context, stdoutWrite } = createMockContext();
    const func = await listCommand.loader();
    await func.call(context, { limit: 30, json: true }, "test-org");

    const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
    const parsed = JSON.parse(output);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].slug).toBe("backend");
    expect(parsed[1].slug).toBe("frontend");
  });

  test("outputs empty JSON array when no teams found with --json", async () => {
    listTeamsSpy.mockResolvedValue([]);

    const { context, stdoutWrite } = createMockContext();
    const func = await listCommand.loader();
    await func.call(context, { limit: 30, json: true }, "test-org");

    const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
    expect(JSON.parse(output)).toEqual([]);
  });

  test("writes 'No teams found' when empty without --json", async () => {
    listTeamsSpy.mockResolvedValue([]);

    const { context, stdoutWrite } = createMockContext();
    const func = await listCommand.loader();
    await func.call(context, { limit: 30, json: false }, "test-org");

    const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("No teams found");
  });

  test("writes header, rows, and footer for human output", async () => {
    listTeamsSpy.mockResolvedValue(sampleTeams);

    const { context, stdoutWrite } = createMockContext();
    const func = await listCommand.loader();
    await func.call(context, { limit: 30, json: false }, "test-org");

    const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
    // Check header
    expect(output).toContain("ORG");
    expect(output).toContain("SLUG");
    expect(output).toContain("NAME");
    expect(output).toContain("MEMBERS");
    // Check data
    expect(output).toContain("backend");
    expect(output).toContain("Backend Team");
    expect(output).toContain("8");
    expect(output).toContain("frontend");
    expect(output).toContain("Frontend Team");
    expect(output).toContain("5");
    // Check footer
    expect(output).toContain("sentry team list");
  });

  test("shows count when results exceed limit", async () => {
    const manyTeams = Array.from({ length: 10 }, (_, i) => ({
      ...sampleTeams[0],
      id: String(i),
      slug: `team-${i}`,
      name: `Team ${i}`,
    }));
    listTeamsSpy.mockResolvedValue(manyTeams);

    const { context, stdoutWrite } = createMockContext();
    const func = await listCommand.loader();
    await func.call(context, { limit: 5, json: false }, "test-org");

    const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("Showing 5 of 10 teams");
  });

  test("uses default organization when no org provided", async () => {
    getDefaultOrganizationSpy.mockResolvedValue("default-org");
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

    // Should have called listOrganizations and then listTeams for each
    expect(listOrganizationsSpy).toHaveBeenCalled();
  });
});
