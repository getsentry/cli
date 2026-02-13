/**
 * Project Create Command Tests
 *
 * Tests for the project create command in src/commands/project/create.ts.
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
import { createCommand } from "../../../src/commands/project/create.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as apiClient from "../../../src/lib/api-client.js";
import { ApiError, CliError, ContextError } from "../../../src/lib/errors.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as resolveTarget from "../../../src/lib/resolve-target.js";
import type { SentryProject, SentryTeam } from "../../../src/types/sentry.js";

const sampleTeam: SentryTeam = {
  id: "1",
  slug: "engineering",
  name: "Engineering",
  memberCount: 5,
};

const sampleTeam2: SentryTeam = {
  id: "2",
  slug: "mobile",
  name: "Mobile Team",
  memberCount: 3,
};

const sampleProject: SentryProject = {
  id: "999",
  slug: "my-app",
  name: "my-app",
  platform: "python",
  dateCreated: "2026-02-12T10:00:00Z",
};

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

describe("project create", () => {
  let listTeamsSpy: ReturnType<typeof spyOn>;
  let createProjectSpy: ReturnType<typeof spyOn>;
  let tryGetPrimaryDsnSpy: ReturnType<typeof spyOn>;
  let listOrgsSpy: ReturnType<typeof spyOn>;
  let resolveOrgSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    listTeamsSpy = spyOn(apiClient, "listTeams");
    createProjectSpy = spyOn(apiClient, "createProject");
    tryGetPrimaryDsnSpy = spyOn(apiClient, "tryGetPrimaryDsn");
    listOrgsSpy = spyOn(apiClient, "listOrganizations");
    resolveOrgSpy = spyOn(resolveTarget, "resolveOrg");

    // Default mocks
    resolveOrgSpy.mockResolvedValue({ org: "acme-corp" });
    listTeamsSpy.mockResolvedValue([sampleTeam]);
    createProjectSpy.mockResolvedValue(sampleProject);
    tryGetPrimaryDsnSpy.mockResolvedValue(
      "https://abc@o123.ingest.us.sentry.io/999"
    );
    listOrgsSpy.mockResolvedValue([
      { slug: "acme-corp", name: "Acme Corp" },
      { slug: "other-org", name: "Other Org" },
    ]);
  });

  afterEach(() => {
    listTeamsSpy.mockRestore();
    createProjectSpy.mockRestore();
    tryGetPrimaryDsnSpy.mockRestore();
    listOrgsSpy.mockRestore();
    resolveOrgSpy.mockRestore();
  });

  test("creates project with auto-detected org and single team", async () => {
    const { context, stdoutWrite } = createMockContext();
    const func = await createCommand.loader();
    await func.call(context, { json: false }, "my-app", "node");

    expect(createProjectSpy).toHaveBeenCalledWith("acme-corp", "engineering", {
      name: "my-app",
      platform: "node",
    });

    const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("Created project 'my-app'");
    expect(output).toContain("acme-corp");
    expect(output).toContain("engineering");
    expect(output).toContain("https://abc@o123.ingest.us.sentry.io/999");
  });

  test("parses org/name positional syntax", async () => {
    const { context } = createMockContext();
    const func = await createCommand.loader();
    await func.call(context, { json: false }, "my-org/my-app", "python");

    // resolveOrg should receive the explicit org
    expect(resolveOrgSpy).toHaveBeenCalledWith({
      org: "my-org",
      cwd: "/tmp",
    });
  });

  test("passes platform positional to createProject", async () => {
    const { context } = createMockContext();
    const func = await createCommand.loader();
    await func.call(context, { json: false }, "my-app", "python-flask");

    expect(createProjectSpy).toHaveBeenCalledWith("acme-corp", "engineering", {
      name: "my-app",
      platform: "python-flask",
    });
  });

  test("passes --team to skip team auto-detection", async () => {
    listTeamsSpy.mockResolvedValue([sampleTeam, sampleTeam2]);

    const { context } = createMockContext();
    const func = await createCommand.loader();
    await func.call(context, { team: "mobile", json: false }, "my-app", "go");

    // listTeams should NOT be called when --team is explicit
    expect(listTeamsSpy).not.toHaveBeenCalled();
    expect(createProjectSpy).toHaveBeenCalledWith("acme-corp", "mobile", {
      name: "my-app",
      platform: "go",
    });
  });

  test("errors when multiple teams exist without --team", async () => {
    listTeamsSpy.mockResolvedValue([sampleTeam, sampleTeam2]);

    const { context } = createMockContext();
    const func = await createCommand.loader();

    await expect(
      func.call(context, { json: false }, "my-app", "node")
    ).rejects.toThrow(ContextError);

    // Should not call createProject
    expect(createProjectSpy).not.toHaveBeenCalled();
  });

  test("errors when no teams exist", async () => {
    listTeamsSpy.mockResolvedValue([]);

    const { context } = createMockContext();
    const func = await createCommand.loader();

    await expect(
      func.call(context, { json: false }, "my-app", "node")
    ).rejects.toThrow(ContextError);
  });

  test("errors when org cannot be resolved", async () => {
    resolveOrgSpy.mockResolvedValue(null);

    const { context } = createMockContext();
    const func = await createCommand.loader();

    await expect(
      func.call(context, { json: false }, "my-app", "node")
    ).rejects.toThrow(ContextError);
  });

  test("handles 409 conflict with friendly error", async () => {
    createProjectSpy.mockRejectedValue(
      new ApiError(
        "API request failed: 409 Conflict",
        409,
        "Project already exists"
      )
    );

    const { context } = createMockContext();
    const func = await createCommand.loader();

    const err = await func
      .call(context, { json: false }, "my-app", "node")
      .catch((e: Error) => e);
    expect(err).toBeInstanceOf(CliError);
    expect(err.message).toContain("already exists");
    expect(err.message).toContain("sentry project view");
  });

  test("handles 404 from createProject as team-not-found with available teams", async () => {
    createProjectSpy.mockRejectedValue(
      new ApiError("API request failed: 404 Not Found", 404)
    );

    const { context } = createMockContext();
    const func = await createCommand.loader();

    const err = await func
      .call(context, { json: false }, "my-app", "node")
      .catch((e: Error) => e);
    expect(err).toBeInstanceOf(CliError);
    expect(err.message).toContain("Team 'engineering' not found");
    expect(err.message).toContain("Available teams:");
    expect(err.message).toContain("engineering");
    expect(err.message).toContain("--team <team-slug>");
  });

  test("handles 404 from createProject with bad org — shows user's orgs", async () => {
    createProjectSpy.mockRejectedValue(
      new ApiError("API request failed: 404 Not Found", 404)
    );
    // listTeams also fails → org is bad
    listTeamsSpy.mockRejectedValue(
      new ApiError("API request failed: 404 Not Found", 404)
    );

    const { context } = createMockContext();
    const func = await createCommand.loader();

    const err = await func
      .call(context, { json: false, team: "backend" }, "my-app", "node")
      .catch((e: Error) => e);
    expect(err).toBeInstanceOf(CliError);
    expect(err.message).toContain("Organization 'acme-corp' not found");
    expect(err.message).toContain("Your organizations");
    expect(err.message).toContain("other-org");
  });

  test("handles 404 with non-404 listTeams failure — shows generic error", async () => {
    createProjectSpy.mockRejectedValue(
      new ApiError("API request failed: 404 Not Found", 404)
    );
    // listTeams returns 403 (not 404) — can't tell if org or team is wrong
    listTeamsSpy.mockRejectedValue(
      new ApiError("API request failed: 403 Forbidden", 403)
    );

    const { context } = createMockContext();
    const func = await createCommand.loader();

    const err = await func
      .call(context, { json: false, team: "backend" }, "my-app", "node")
      .catch((e: Error) => e);
    expect(err).toBeInstanceOf(CliError);
    expect(err.message).toContain("Failed to create project");
    expect(err.message).toContain("may not exist, or you may lack access");
    // Should NOT say "Organization not found" — we don't know that
    expect(err.message).not.toContain("not found");
  });

  test("handles 400 invalid platform with platform list", async () => {
    createProjectSpy.mockRejectedValue(
      new ApiError(
        "API request failed: 400 Bad Request",
        400,
        '{"platform":["Invalid platform"]}'
      )
    );

    const { context } = createMockContext();
    const func = await createCommand.loader();

    const err = await func
      .call(context, { json: false }, "my-app", "node")
      .catch((e: Error) => e);
    expect(err).toBeInstanceOf(CliError);
    expect(err.message).toContain("Invalid platform 'node'");
    expect(err.message).toContain("Available platforms:");
    expect(err.message).toContain("javascript-nextjs");
    expect(err.message).toContain("docs.sentry.io/platforms");
  });

  test("wraps other API errors with context", async () => {
    createProjectSpy.mockRejectedValue(
      new ApiError("API request failed: 403 Forbidden", 403, "No permission")
    );

    const { context } = createMockContext();
    const func = await createCommand.loader();

    const err = await func
      .call(context, { json: false }, "my-app", "node")
      .catch((e: Error) => e);
    expect(err).toBeInstanceOf(CliError);
    expect(err.message).toContain("Failed to create project");
    expect(err.message).toContain("403");
  });

  test("outputs JSON when --json flag is set", async () => {
    const { context, stdoutWrite } = createMockContext();
    const func = await createCommand.loader();
    await func.call(context, { json: true }, "my-app", "node");

    const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
    const parsed = JSON.parse(output);
    expect(parsed.slug).toBe("my-app");
    expect(parsed.dsn).toBe("https://abc@o123.ingest.us.sentry.io/999");
  });

  test("handles DSN fetch failure gracefully", async () => {
    tryGetPrimaryDsnSpy.mockResolvedValue(null);

    const { context, stdoutWrite } = createMockContext();
    const func = await createCommand.loader();
    await func.call(context, { json: false }, "my-app", "node");

    const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
    // Should still show project info without DSN
    expect(output).toContain("Created project 'my-app'");
    expect(output).not.toContain("ingest.us.sentry.io");
  });

  test("errors on invalid org/name syntax", async () => {
    const { context } = createMockContext();
    const func = await createCommand.loader();

    // Missing name after slash
    await expect(
      func.call(context, { json: false }, "acme-corp/", "node")
    ).rejects.toThrow(ContextError);
  });

  test("shows platform in human output", async () => {
    const { context, stdoutWrite } = createMockContext();
    const func = await createCommand.loader();
    await func.call(context, { json: false }, "my-app", "python-django");

    const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("python");
  });

  test("shows project URL in human output", async () => {
    const { context, stdoutWrite } = createMockContext();
    const func = await createCommand.loader();
    await func.call(context, { json: false }, "my-app", "node");

    const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("/settings/acme-corp/projects/my-app/");
  });

  test("shows helpful error when name is missing", async () => {
    const { context } = createMockContext();
    const func = await createCommand.loader();

    const err = await func
      .call(context, { json: false })
      .catch((e: Error) => e);
    expect(err).toBeInstanceOf(ContextError);
    expect(err.message).toContain("Project name is required");
    expect(err.message).toContain("sentry project create <name>");
  });

  test("shows helpful error when platform is missing", async () => {
    const { context } = createMockContext();
    const func = await createCommand.loader();

    const err = await func
      .call(context, { json: false }, "my-app")
      .catch((e: Error) => e);
    expect(err).toBeInstanceOf(CliError);
    expect(err.message).toContain("Platform is required");
    expect(err.message).toContain("Available platforms:");
    expect(err.message).toContain("javascript-nextjs");
    expect(err.message).toContain("python");
    expect(err.message).toContain("docs.sentry.io/platforms");
  });

  test("wraps listTeams API failure with org list", async () => {
    listTeamsSpy.mockRejectedValue(
      new ApiError("API request failed: 404 Not Found", 404)
    );

    const { context } = createMockContext();
    const func = await createCommand.loader();

    const err = await func
      .call(context, { json: false }, "my-app", "node")
      .catch((e: Error) => e);
    expect(err).toBeInstanceOf(ContextError);
    expect(err.message).toContain("acme-corp");
    expect(err.message).toContain("404");
    // Should show the user's actual orgs to help them pick the right one
    expect(err.message).toContain("Your organizations");
    expect(err.message).toContain("other-org");
  });

  test("shows auto-detected org source when listTeams fails", async () => {
    resolveOrgSpy.mockResolvedValue({
      org: "123",
      detectedFrom: "test/mocks/routes.ts",
    });
    listTeamsSpy.mockRejectedValue(
      new ApiError("API request failed: 404 Not Found", 404)
    );

    const { context } = createMockContext();
    const func = await createCommand.loader();

    const err = await func
      .call(context, { json: false }, "my-app", "node")
      .catch((e: Error) => e);
    expect(err).toBeInstanceOf(ContextError);
    expect(err.message).toContain("auto-detected from test/mocks/routes.ts");
    expect(err.message).toContain("123");
    expect(err.message).toContain("Your organizations");
  });
});
