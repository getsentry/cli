import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
// biome-ignore lint/performance/noNamespaceImport: spyOn requires object reference
import * as apiClient from "../../../../src/lib/api-client.js";
import { ApiError } from "../../../../src/lib/errors.js";
import { createSentryProject } from "../../../../src/lib/init/tools/create-sentry-project.js";
import type { EnsureSentryProjectPayload } from "../../../../src/lib/init/types.js";
// biome-ignore lint/performance/noNamespaceImport: spyOn requires object reference
import * as resolveTeam from "../../../../src/lib/resolve-team.js";

function makePayload(
  overrides?: Partial<EnsureSentryProjectPayload["params"]>
): EnsureSentryProjectPayload {
  return {
    type: "tool",
    operation: "ensure-sentry-project",
    cwd: "/tmp/test",
    params: {
      name: "my-app",
      platform: "javascript-react",
      ...overrides,
    },
  };
}

let createProjectWithDsnSpy: ReturnType<typeof spyOn>;
let getProjectSpy: ReturnType<typeof spyOn>;
let tryGetPrimaryDsnSpy: ReturnType<typeof spyOn>;
let resolveOrCreateTeamSpy: ReturnType<typeof spyOn>;

beforeEach(() => {
  createProjectWithDsnSpy = spyOn(
    apiClient,
    "createProjectWithDsn"
  ).mockResolvedValue({
    project: {
      id: "42",
      slug: "my-app",
      name: "my-app",
      platform: "javascript-react",
      dateCreated: "2026-04-16T00:00:00Z",
    } as any,
    dsn: "https://abc@o1.ingest.sentry.io/42",
    url: "https://sentry.io/settings/acme/projects/my-app/",
  });
  getProjectSpy = spyOn(apiClient, "getProject").mockResolvedValue({
    id: "42",
    slug: "my-app",
    name: "my-app",
    platform: "javascript-react",
    dateCreated: "2026-04-16T00:00:00Z",
  } as any);
  tryGetPrimaryDsnSpy = spyOn(apiClient, "tryGetPrimaryDsn").mockResolvedValue(
    "https://abc@o1.ingest.sentry.io/42"
  );
  resolveOrCreateTeamSpy = spyOn(
    resolveTeam,
    "resolveOrCreateTeam"
  ).mockResolvedValue({
    slug: "generated-team",
    source: "auto-created",
  } as any);
});

afterEach(() => {
  createProjectWithDsnSpy.mockRestore();
  getProjectSpy.mockRestore();
  tryGetPrimaryDsnSpy.mockRestore();
  resolveOrCreateTeamSpy.mockRestore();
});

describe("createSentryProject", () => {
  test("returns the pre-resolved existing project without creating", async () => {
    const result = await createSentryProject(makePayload(), {
      dryRun: false,
      org: "acme",
      team: undefined,
      project: "my-app",
      existingProject: {
        orgSlug: "acme",
        projectSlug: "my-app",
        projectId: "42",
        dsn: "https://abc@o1.ingest.sentry.io/42",
        url: "https://sentry.io/settings/acme/projects/my-app/",
      },
    });

    expect(result.ok).toBe(true);
    expect(result.message).toContain("Using existing project");
    expect(createProjectWithDsnSpy).not.toHaveBeenCalled();
    expect(resolveOrCreateTeamSpy).not.toHaveBeenCalled();
  });

  test("creates a new project with the pre-resolved org and team", async () => {
    getProjectSpy.mockRejectedValueOnce(new ApiError("Not found", 404));

    const result = await createSentryProject(makePayload(), {
      dryRun: false,
      org: "acme",
      team: "platform",
      project: undefined,
    });

    expect(result.ok).toBe(true);
    expect(createProjectWithDsnSpy).toHaveBeenCalledWith(
      "acme",
      "platform",
      expect.objectContaining({
        name: "my-app",
        platform: "javascript-react",
      })
    );
  });

  test("re-checks for an existing project before creating when the slug is known", async () => {
    const result = await createSentryProject(makePayload(), {
      dryRun: false,
      org: "acme",
      team: "platform",
      project: undefined,
    });

    expect(result.ok).toBe(true);
    expect(result.message).toContain("Using existing project");
    expect(createProjectWithDsnSpy).not.toHaveBeenCalled();
    expect(resolveOrCreateTeamSpy).not.toHaveBeenCalled();
  });

  test("surfaces lookup failures before creating when a known slug cannot be verified", async () => {
    getProjectSpy.mockRejectedValueOnce(new Error("temporary failure"));

    const result = await createSentryProject(makePayload(), {
      dryRun: false,
      org: "acme",
      team: "platform",
      project: undefined,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("temporary failure");
    expect(createProjectWithDsnSpy).not.toHaveBeenCalled();
  });

  test("returns dry-run placeholder project data", async () => {
    getProjectSpy.mockRejectedValueOnce(new ApiError("Not found", 404));

    const result = await createSentryProject(makePayload(), {
      dryRun: true,
      org: "acme",
      team: "platform",
      project: undefined,
    });

    expect(result.ok).toBe(true);
    expect(result.data).toEqual(
      expect.objectContaining({
        orgSlug: "acme",
        projectId: "(dry-run)",
      })
    );
    expect(createProjectWithDsnSpy).not.toHaveBeenCalled();
  });

  test("resolves the team at project creation time when preflight deferred it", async () => {
    getProjectSpy.mockRejectedValueOnce(new ApiError("Not found", 404));

    const result = await createSentryProject(makePayload(), {
      dryRun: false,
      org: "acme",
      team: undefined,
      project: undefined,
    });

    expect(result.ok).toBe(true);
    expect(resolveOrCreateTeamSpy).toHaveBeenCalledWith(
      "acme",
      expect.objectContaining({
        autoCreateSlug: "my-app",
        usageHint: "sentry init",
        dryRun: false,
      })
    );
    expect(createProjectWithDsnSpy).toHaveBeenCalledWith(
      "acme",
      "generated-team",
      expect.objectContaining({
        name: "my-app",
        platform: "javascript-react",
      })
    );
  });

  test("uses the final project slug for deferred team resolution in dry-run mode", async () => {
    getProjectSpy.mockRejectedValueOnce(new ApiError("Not found", 404));

    const result = await createSentryProject(makePayload(), {
      dryRun: true,
      org: "acme",
      team: undefined,
      project: undefined,
    });

    expect(result.ok).toBe(true);
    expect(resolveOrCreateTeamSpy).toHaveBeenCalledWith(
      "acme",
      expect.objectContaining({
        autoCreateSlug: "my-app",
        usageHint: "sentry init",
        dryRun: true,
      })
    );
    expect(createProjectWithDsnSpy).not.toHaveBeenCalled();
  });
});
