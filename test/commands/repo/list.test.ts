/**
 * Repository List Command Tests
 *
 * Tests for the repo list command in src/commands/repo/list.ts.
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
import { listCommand } from "../../../src/commands/repo/list.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as apiClient from "../../../src/lib/api-client.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as defaults from "../../../src/lib/db/defaults.js";
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
  let listRepositoriesSpy: ReturnType<typeof spyOn>;
  let listOrganizationsSpy: ReturnType<typeof spyOn>;
  let getDefaultOrganizationSpy: ReturnType<typeof spyOn>;
  let resolveAllTargetsSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    listRepositoriesSpy = spyOn(apiClient, "listRepositories");
    listOrganizationsSpy = spyOn(apiClient, "listOrganizations");
    getDefaultOrganizationSpy = spyOn(defaults, "getDefaultOrganization");
    resolveAllTargetsSpy = spyOn(resolveTarget, "resolveAllTargets");

    // Default: no default org, no DSN detection
    getDefaultOrganizationSpy.mockResolvedValue(null);
    resolveAllTargetsSpy.mockResolvedValue({ targets: [] });
  });

  afterEach(() => {
    listRepositoriesSpy.mockRestore();
    listOrganizationsSpy.mockRestore();
    getDefaultOrganizationSpy.mockRestore();
    resolveAllTargetsSpy.mockRestore();
  });

  test("outputs JSON array when --json flag is set", async () => {
    listRepositoriesSpy.mockResolvedValue(sampleRepos);

    const { context, stdoutWrite } = createMockContext();
    const func = await listCommand.loader();
    await func.call(context, { limit: 30, json: true }, "test-org");

    const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
    const parsed = JSON.parse(output);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].name).toBe("getsentry/sentry");
  });

  test("outputs empty JSON array when no repos found with --json", async () => {
    listRepositoriesSpy.mockResolvedValue([]);

    const { context, stdoutWrite } = createMockContext();
    const func = await listCommand.loader();
    await func.call(context, { limit: 30, json: true }, "test-org");

    const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
    expect(JSON.parse(output)).toEqual([]);
  });

  test("writes 'No repositories found' when empty without --json", async () => {
    listRepositoriesSpy.mockResolvedValue([]);

    const { context, stdoutWrite } = createMockContext();
    const func = await listCommand.loader();
    await func.call(context, { limit: 30, json: false }, "test-org");

    const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("No repositories found");
  });

  test("writes header, rows, and footer for human output", async () => {
    listRepositoriesSpy.mockResolvedValue(sampleRepos);

    const { context, stdoutWrite } = createMockContext();
    const func = await listCommand.loader();
    await func.call(context, { limit: 30, json: false }, "test-org");

    const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
    // Check header
    expect(output).toContain("ORG");
    expect(output).toContain("NAME");
    expect(output).toContain("PROVIDER");
    expect(output).toContain("STATUS");
    expect(output).toContain("URL");
    // Check data
    expect(output).toContain("getsentry/sentry");
    expect(output).toContain("getsentry/sentry-javascript");
    expect(output).toContain("GitHub");
    expect(output).toContain("active");
    // Check footer
    expect(output).toContain("sentry repo list");
  });

  test("shows count when results exceed limit", async () => {
    // Create more repos than the limit
    const manyRepos = Array.from({ length: 10 }, (_, i) => ({
      ...sampleRepos[0],
      id: String(i),
      name: `repo-${i}`,
    }));
    listRepositoriesSpy.mockResolvedValue(manyRepos);

    const { context, stdoutWrite } = createMockContext();
    const func = await listCommand.loader();
    await func.call(context, { limit: 5, json: false }, "test-org");

    const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("Showing 5 of 10 repositories");
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

    // Should have called listOrganizations and then listRepositories for each
    expect(listOrganizationsSpy).toHaveBeenCalled();
  });
});
