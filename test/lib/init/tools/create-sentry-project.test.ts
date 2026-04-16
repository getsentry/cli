import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
// biome-ignore lint/performance/noNamespaceImport: spyOn requires object reference
import * as apiClient from "../../../../src/lib/api-client.js";
import { createSentryProject } from "../../../../src/lib/init/tools/create-sentry-project.js";
import type { CreateSentryProjectPayload } from "../../../../src/lib/init/types.js";

function makePayload(
  overrides?: Partial<CreateSentryProjectPayload["params"]>
): CreateSentryProjectPayload {
  return {
    type: "tool",
    operation: "create-sentry-project",
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
  tryGetPrimaryDsnSpy = spyOn(
    apiClient,
    "tryGetPrimaryDsn"
  ).mockResolvedValue("https://abc@o1.ingest.sentry.io/42");
});

afterEach(() => {
  createProjectWithDsnSpy.mockRestore();
  getProjectSpy.mockRestore();
  tryGetPrimaryDsnSpy.mockRestore();
});

describe("createSentryProject", () => {
  test("returns the pre-resolved existing project without creating", async () => {
    const result = await createSentryProject(makePayload(), {
      dryRun: false,
      org: "acme",
      team: "platform",
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
  });

  test("creates a new project with the pre-resolved org and team", async () => {
    getProjectSpy.mockResolvedValueOnce({
      id: "42",
      slug: "different-project",
      name: "different-project",
      platform: "javascript-react",
      dateCreated: "2026-04-16T00:00:00Z",
    } as any);

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
      project: "my-app",
    });

    expect(result.ok).toBe(true);
    expect(result.message).toContain("Using existing project");
    expect(createProjectWithDsnSpy).not.toHaveBeenCalled();
  });

  test("returns dry-run placeholder project data", async () => {
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
});
