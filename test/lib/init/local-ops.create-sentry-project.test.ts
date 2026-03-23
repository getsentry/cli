/**
 * create-sentry-project local-op tests
 *
 * Uses spyOn on namespace imports so that the spies intercept calls
 * from within the local-ops module (live ESM bindings).
 */

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
// biome-ignore lint/performance/noNamespaceImport: spyOn requires object reference
import * as clack from "@clack/prompts";
// biome-ignore lint/performance/noNamespaceImport: spyOn requires object reference
import * as apiClient from "../../../src/lib/api-client.js";
// biome-ignore lint/performance/noNamespaceImport: spyOn requires object reference
import * as projectCache from "../../../src/lib/db/project-cache.js";
// biome-ignore lint/performance/noNamespaceImport: spyOn requires object reference
import * as dbRegions from "../../../src/lib/db/regions.js";
// biome-ignore lint/performance/noNamespaceImport: spyOn requires object reference
import * as dsnIndex from "../../../src/lib/dsn/index.js";
import { handleLocalOp } from "../../../src/lib/init/local-ops.js";
import type {
  CreateSentryProjectPayload,
  WizardOptions,
} from "../../../src/lib/init/types.js";
// biome-ignore lint/performance/noNamespaceImport: spyOn requires object reference
import * as resolveTarget from "../../../src/lib/resolve-target.js";
// biome-ignore lint/performance/noNamespaceImport: spyOn requires object reference
import * as resolveTeam from "../../../src/lib/resolve-team.js";
// biome-ignore lint/performance/noNamespaceImport: spyOn requires object reference
import * as sentryUrls from "../../../src/lib/sentry-urls.js";
import type { SentryProject } from "../../../src/types/index.js";

function makeOptions(overrides?: Partial<WizardOptions>): WizardOptions {
  return {
    directory: "/tmp/test",
    yes: false,
    dryRun: false,
    ...overrides,
  };
}

function makePayload(
  overrides?: Partial<CreateSentryProjectPayload["params"]>
): CreateSentryProjectPayload {
  return {
    type: "local-op",
    operation: "create-sentry-project",
    cwd: "/tmp/test",
    params: {
      name: "my-app",
      platform: "javascript-nextjs",
      ...overrides,
    },
  };
}

const sampleProject: SentryProject = {
  id: "42",
  slug: "my-app",
  name: "my-app",
  platform: "javascript-nextjs",
  dateCreated: "2026-03-04T00:00:00Z",
};

describe("create-sentry-project", () => {
  let resolveOrgSpy: ReturnType<typeof spyOn>;
  let listOrgsSpy: ReturnType<typeof spyOn>;
  let resolveOrCreateTeamSpy: ReturnType<typeof spyOn>;
  let createProjectSpy: ReturnType<typeof spyOn>;
  let tryGetPrimaryDsnSpy: ReturnType<typeof spyOn>;
  let buildProjectUrlSpy: ReturnType<typeof spyOn>;
  let selectSpy: ReturnType<typeof spyOn>;
  let isCancelSpy: ReturnType<typeof spyOn>;
  let getOrgByNumericIdSpy: ReturnType<typeof spyOn>;
  let detectDsnSpy: ReturnType<typeof spyOn>;
  let getCachedProjectByDsnKeySpy: ReturnType<typeof spyOn>;
  let setCachedProjectByDsnKeySpy: ReturnType<typeof spyOn>;
  let findProjectByDsnKeySpy: ReturnType<typeof spyOn>;
  let getProjectSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    resolveOrgSpy = spyOn(resolveTarget, "resolveOrg");
    listOrgsSpy = spyOn(apiClient, "listOrganizations");
    resolveOrCreateTeamSpy = spyOn(resolveTeam, "resolveOrCreateTeam");
    createProjectSpy = spyOn(apiClient, "createProject");
    tryGetPrimaryDsnSpy = spyOn(apiClient, "tryGetPrimaryDsn");
    buildProjectUrlSpy = spyOn(sentryUrls, "buildProjectUrl");
    selectSpy = spyOn(clack, "select");
    isCancelSpy = spyOn(clack, "isCancel").mockImplementation(
      (v: unknown) => v === Symbol.for("cancel")
    );
    // New spies — default to no-op so existing tests are unaffected
    getOrgByNumericIdSpy = spyOn(
      dbRegions,
      "getOrgByNumericId"
    ).mockResolvedValue(undefined);
    detectDsnSpy = spyOn(dsnIndex, "detectDsn").mockResolvedValue(null);
    getCachedProjectByDsnKeySpy = spyOn(
      projectCache,
      "getCachedProjectByDsnKey"
    ).mockResolvedValue(undefined);
    setCachedProjectByDsnKeySpy = spyOn(
      projectCache,
      "setCachedProjectByDsnKey"
    ).mockResolvedValue(undefined);
    findProjectByDsnKeySpy = spyOn(
      apiClient,
      "findProjectByDsnKey"
    ).mockResolvedValue(null);
    getProjectSpy = spyOn(apiClient, "getProject");
  });

  afterEach(() => {
    resolveOrgSpy.mockRestore();
    listOrgsSpy.mockRestore();
    resolveOrCreateTeamSpy.mockRestore();
    createProjectSpy.mockRestore();
    tryGetPrimaryDsnSpy.mockRestore();
    buildProjectUrlSpy.mockRestore();
    selectSpy.mockRestore();
    isCancelSpy.mockRestore();
    getOrgByNumericIdSpy.mockRestore();
    detectDsnSpy.mockRestore();
    getCachedProjectByDsnKeySpy.mockRestore();
    setCachedProjectByDsnKeySpy.mockRestore();
    findProjectByDsnKeySpy.mockRestore();
    getProjectSpy.mockRestore();
  });

  function mockDownstreamSuccess(orgSlug: string) {
    resolveOrCreateTeamSpy.mockResolvedValue({
      slug: "engineering",
      source: "auto-selected",
    });
    createProjectSpy.mockResolvedValue(sampleProject);
    tryGetPrimaryDsnSpy.mockResolvedValue("https://abc@o1.ingest.sentry.io/42");
    buildProjectUrlSpy.mockReturnValue(
      `https://sentry.io/settings/${orgSlug}/projects/my-app/`
    );
  }

  test("success path returns project details", async () => {
    resolveOrgSpy.mockResolvedValue({ org: "acme-corp" });
    mockDownstreamSuccess("acme-corp");

    const result = await handleLocalOp(makePayload(), makeOptions());

    expect(result.ok).toBe(true);
    const data = result.data as {
      orgSlug: string;
      projectSlug: string;
      projectId: string;
      dsn: string;
      url: string;
    };
    expect(data.orgSlug).toBe("acme-corp");
    expect(data.projectSlug).toBe("my-app");
    expect(data.projectId).toBe("42");
    expect(data.dsn).toBe("https://abc@o1.ingest.sentry.io/42");
    expect(data.url).toBe(
      "https://sentry.io/settings/acme-corp/projects/my-app/"
    );

    // Verify resolveOrCreateTeam was called with slugified name
    expect(resolveOrCreateTeamSpy).toHaveBeenCalledWith("acme-corp", {
      autoCreateSlug: "my-app",
      usageHint: "sentry init",
    });
  });

  test("single org fallback when resolveOrg returns null", async () => {
    resolveOrgSpy.mockResolvedValue(null);
    listOrgsSpy.mockResolvedValue([
      { id: "1", slug: "solo-org", name: "Solo Org" },
    ]);
    mockDownstreamSuccess("solo-org");

    const result = await handleLocalOp(makePayload(), makeOptions());

    expect(result.ok).toBe(true);
    const data = result.data as { orgSlug: string };
    expect(data.orgSlug).toBe("solo-org");
    expect(selectSpy).not.toHaveBeenCalled();
  });

  test("no orgs (not authenticated) returns ok:false", async () => {
    resolveOrgSpy.mockResolvedValue(null);
    listOrgsSpy.mockResolvedValue([]);

    const result = await handleLocalOp(makePayload(), makeOptions());

    expect(result.ok).toBe(false);
    expect(result.error).toContain("Not authenticated");
    expect(createProjectSpy).not.toHaveBeenCalled();
  });

  test("multiple orgs + --yes flag returns ok:false with slug list", async () => {
    resolveOrgSpy.mockResolvedValue(null);
    listOrgsSpy.mockResolvedValue([
      { id: "1", slug: "org-a", name: "Org A" },
      { id: "2", slug: "org-b", name: "Org B" },
    ]);

    const result = await handleLocalOp(
      makePayload(),
      makeOptions({ yes: true })
    );

    expect(result.ok).toBe(false);
    expect(result.error).toContain("Multiple organizations found");
    expect(result.error).toContain("org-a");
    expect(result.error).toContain("org-b");
    expect(createProjectSpy).not.toHaveBeenCalled();
  });

  test("multiple orgs + interactive select picks chosen org", async () => {
    resolveOrgSpy.mockResolvedValue(null);
    listOrgsSpy.mockResolvedValue([
      { id: "1", slug: "org-a", name: "Org A" },
      { id: "2", slug: "org-b", name: "Org B" },
    ]);
    selectSpy.mockResolvedValue("org-b");
    mockDownstreamSuccess("org-b");

    const result = await handleLocalOp(makePayload(), makeOptions());

    expect(result.ok).toBe(true);
    const data = result.data as { orgSlug: string };
    expect(data.orgSlug).toBe("org-b");
    expect(selectSpy).toHaveBeenCalledTimes(1);
  });

  test("multiple orgs + user cancels select returns ok:false", async () => {
    resolveOrgSpy.mockResolvedValue(null);
    listOrgsSpy.mockResolvedValue([
      { id: "1", slug: "org-a", name: "Org A" },
      { id: "2", slug: "org-b", name: "Org B" },
    ]);
    selectSpy.mockResolvedValue(Symbol.for("cancel"));

    const result = await handleLocalOp(makePayload(), makeOptions());

    expect(result.ok).toBe(false);
    expect(result.error).toContain("cancelled");
    expect(createProjectSpy).not.toHaveBeenCalled();
  });

  test("API error (e.g. 409 conflict) returns ok:false", async () => {
    resolveOrgSpy.mockResolvedValue({ org: "acme-corp" });
    resolveOrCreateTeamSpy.mockResolvedValue({
      slug: "engineering",
      source: "auto-selected",
    });
    createProjectSpy.mockRejectedValue(
      new Error("409: A project with this slug already exists")
    );

    const result = await handleLocalOp(makePayload(), makeOptions());

    expect(result.ok).toBe(false);
    expect(result.error).toContain("already exists");
  });

  test("DSN unavailable still returns ok:true with empty dsn", async () => {
    resolveOrgSpy.mockResolvedValue({ org: "acme-corp" });
    resolveOrCreateTeamSpy.mockResolvedValue({
      slug: "engineering",
      source: "auto-selected",
    });
    createProjectSpy.mockResolvedValue(sampleProject);
    tryGetPrimaryDsnSpy.mockResolvedValue(null);
    buildProjectUrlSpy.mockReturnValue(
      "https://sentry.io/settings/acme-corp/projects/my-app/"
    );

    const result = await handleLocalOp(makePayload(), makeOptions());

    expect(result.ok).toBe(true);
    const data = result.data as { dsn: string };
    expect(data.dsn).toBe("");
  });

  describe("resolveOrgSlug — numeric org ID from DSN", () => {
    test("numeric ID + cache hit → resolved to slug for project creation", async () => {
      resolveOrgSpy.mockResolvedValue({ org: "4507492088676352" });
      getOrgByNumericIdSpy.mockResolvedValue({
        slug: "acme-corp",
        regionUrl: "https://us.sentry.io",
      });
      mockDownstreamSuccess("acme-corp");

      const result = await handleLocalOp(makePayload(), makeOptions());

      expect(result.ok).toBe(true);
      const data = result.data as { orgSlug: string };
      expect(data.orgSlug).toBe("acme-corp");
      expect(getOrgByNumericIdSpy).toHaveBeenCalledWith("4507492088676352");
    });

    test("numeric ID + cache miss → falls through to single org in listOrganizations", async () => {
      resolveOrgSpy.mockResolvedValue({ org: "4507492088676352" });
      getOrgByNumericIdSpy.mockResolvedValue(undefined);
      listOrgsSpy.mockResolvedValue([
        { id: "1", slug: "solo-org", name: "Solo Org" },
      ]);
      mockDownstreamSuccess("solo-org");

      const result = await handleLocalOp(makePayload(), makeOptions());

      expect(result.ok).toBe(true);
      const data = result.data as { orgSlug: string };
      expect(data.orgSlug).toBe("solo-org");
    });

    test("numeric ID + cache miss + multiple orgs + --yes → error with org list", async () => {
      resolveOrgSpy.mockResolvedValue({ org: "4507492088676352" });
      getOrgByNumericIdSpy.mockResolvedValue(undefined);
      listOrgsSpy.mockResolvedValue([
        { id: "1", slug: "org-a", name: "Org A" },
        { id: "2", slug: "org-b", name: "Org B" },
      ]);

      const result = await handleLocalOp(
        makePayload(),
        makeOptions({ yes: true })
      );

      expect(result.ok).toBe(false);
      expect(result.error).toContain("Multiple organizations found");
      expect(createProjectSpy).not.toHaveBeenCalled();
    });
  });

  describe("detectExistingProject — existing DSN prompt", () => {
    function mockExistingProject(orgSlug: string, projectSlug: string) {
      detectDsnSpy.mockResolvedValue({
        publicKey: "test-key-abc",
        protocol: "https",
        host: "o123.ingest.sentry.io",
        projectId: "42",
        raw: "https://test-key-abc@o123.ingest.sentry.io/42",
        source: "env_file" as const,
      });
      getCachedProjectByDsnKeySpy.mockResolvedValue({
        orgSlug,
        orgName: orgSlug,
        projectSlug,
        projectName: projectSlug,
        projectId: "42",
        cachedAt: Date.now(),
      });
      getProjectSpy.mockResolvedValue({ ...sampleProject, slug: projectSlug });
      tryGetPrimaryDsnSpy.mockResolvedValue(
        "https://abc@o1.ingest.sentry.io/42"
      );
      buildProjectUrlSpy.mockReturnValue(
        `https://sentry.io/settings/${orgSlug}/projects/${projectSlug}/`
      );
    }

    test("no DSN found → no prompt, proceeds with normal creation", async () => {
      detectDsnSpy.mockResolvedValue(null);
      resolveOrgSpy.mockResolvedValue({ org: "acme-corp" });
      mockDownstreamSuccess("acme-corp");

      const result = await handleLocalOp(makePayload(), makeOptions());

      expect(result.ok).toBe(true);
      expect(selectSpy).not.toHaveBeenCalled();
      expect(createProjectSpy).toHaveBeenCalledTimes(1);
    });

    test("DSN found + --yes flag → auto-uses existing project without prompt", async () => {
      mockExistingProject("acme-corp", "my-app");

      const result = await handleLocalOp(
        makePayload(),
        makeOptions({ yes: true })
      );

      expect(result.ok).toBe(true);
      const data = result.data as { orgSlug: string; projectSlug: string };
      expect(data.orgSlug).toBe("acme-corp");
      expect(data.projectSlug).toBe("my-app");
      expect(selectSpy).not.toHaveBeenCalled();
      expect(createProjectSpy).not.toHaveBeenCalled();
    });

    test("DSN found + pick 'existing' → returns existing project details", async () => {
      mockExistingProject("acme-corp", "my-app");
      selectSpy.mockResolvedValue("existing");

      const result = await handleLocalOp(makePayload(), makeOptions());

      expect(result.ok).toBe(true);
      const data = result.data as { orgSlug: string; projectSlug: string };
      expect(data.orgSlug).toBe("acme-corp");
      expect(data.projectSlug).toBe("my-app");
      expect(createProjectSpy).not.toHaveBeenCalled();
    });

    test("DSN found + pick 'create' → proceeds with normal project creation", async () => {
      mockExistingProject("acme-corp", "my-app");
      selectSpy.mockResolvedValue("create");
      resolveOrgSpy.mockResolvedValue({ org: "acme-corp" });
      mockDownstreamSuccess("acme-corp");

      const result = await handleLocalOp(makePayload(), makeOptions());

      expect(result.ok).toBe(true);
      expect(createProjectSpy).toHaveBeenCalledTimes(1);
    });

    test("DSN found + cancel select → ok:false with cancelled error", async () => {
      mockExistingProject("acme-corp", "my-app");
      selectSpy.mockResolvedValue(Symbol.for("cancel"));

      const result = await handleLocalOp(makePayload(), makeOptions());

      expect(result.ok).toBe(false);
      expect(result.error).toContain("Cancelled");
      expect(createProjectSpy).not.toHaveBeenCalled();
    });

    test("DSN found + API lookup (cache miss) → caches project and prompts user", async () => {
      detectDsnSpy.mockResolvedValue({
        publicKey: "test-key-abc",
        protocol: "https",
        host: "o123.ingest.sentry.io",
        projectId: "42",
        raw: "https://test-key-abc@o123.ingest.sentry.io/42",
        source: "env_file" as const,
      });
      getCachedProjectByDsnKeySpy.mockResolvedValue(undefined); // cache miss
      findProjectByDsnKeySpy.mockResolvedValue({
        ...sampleProject,
        organization: { id: "1", slug: "acme-corp", name: "Acme Corp" },
      });
      setCachedProjectByDsnKeySpy.mockResolvedValue(undefined);
      selectSpy.mockResolvedValue("existing");
      getProjectSpy.mockResolvedValue(sampleProject);
      tryGetPrimaryDsnSpy.mockResolvedValue(
        "https://abc@o1.ingest.sentry.io/42"
      );
      buildProjectUrlSpy.mockReturnValue(
        "https://sentry.io/settings/acme-corp/projects/my-app/"
      );

      const result = await handleLocalOp(makePayload(), makeOptions());

      expect(result.ok).toBe(true);
      expect(setCachedProjectByDsnKeySpy).toHaveBeenCalledTimes(1);
      expect(createProjectSpy).not.toHaveBeenCalled();
    });

    test("DSN found + API throws (inaccessible org) → no prompt, normal creation", async () => {
      detectDsnSpy.mockResolvedValue({
        publicKey: "test-key-abc",
        protocol: "https",
        host: "o999.ingest.sentry.io",
        projectId: "99",
        raw: "https://test-key-abc@o999.ingest.sentry.io/99",
        source: "env_file" as const,
      });
      getCachedProjectByDsnKeySpy.mockResolvedValue(undefined);
      findProjectByDsnKeySpy.mockRejectedValue(new Error("403 Forbidden"));
      resolveOrgSpy.mockResolvedValue({ org: "acme-corp" });
      mockDownstreamSuccess("acme-corp");

      const result = await handleLocalOp(makePayload(), makeOptions());

      expect(result.ok).toBe(true);
      expect(selectSpy).not.toHaveBeenCalled();
      expect(createProjectSpy).toHaveBeenCalledTimes(1);
    });
  });
});
