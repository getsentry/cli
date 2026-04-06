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
import { ApiError } from "../../../src/lib/errors.js";
import { WizardCancelledError } from "../../../src/lib/init/clack-utils.js";
import {
  detectExistingProject,
  handleLocalOp,
  resolveOrgSlug,
} from "../../../src/lib/init/local-ops.js";
// biome-ignore lint/performance/noNamespaceImport: spyOn requires object reference
import * as prefetch from "../../../src/lib/init/prefetch.js";
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
    org: "acme-corp",
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

let savedAuthToken: string | undefined;
beforeEach(() => {
  savedAuthToken = process.env.SENTRY_AUTH_TOKEN;
  delete process.env.SENTRY_AUTH_TOKEN;
});
afterEach(() => {
  if (savedAuthToken !== undefined) {
    process.env.SENTRY_AUTH_TOKEN = savedAuthToken;
  }
});

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
  let resolveOrgPrefetchedSpy: ReturnType<typeof spyOn>;
  let resolveDsnByPublicKeySpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    resolveOrgSpy = spyOn(resolveTarget, "resolveOrg");
    resolveOrgPrefetchedSpy = spyOn(prefetch, "resolveOrgPrefetched");
    resolveDsnByPublicKeySpy = spyOn(resolveTarget, "resolveDsnByPublicKey");
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
    resolveOrgPrefetchedSpy.mockRestore();
    resolveDsnByPublicKeySpy.mockRestore();
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

  describe("resolveOrgSlug (called directly)", () => {
    test("single org fallback when resolveOrg returns null", async () => {
      resolveOrgPrefetchedSpy.mockResolvedValue(null);
      listOrgsSpy.mockResolvedValue([
        { id: "1", slug: "solo-org", name: "Solo Org" },
      ]);

      const result = await resolveOrgSlug("/tmp/test", false);

      expect(result).toBe("solo-org");
      expect(selectSpy).not.toHaveBeenCalled();
    });

    test("no orgs (not authenticated) returns error result", async () => {
      resolveOrgPrefetchedSpy.mockResolvedValue(null);
      listOrgsSpy.mockResolvedValue([]);

      const result = await resolveOrgSlug("/tmp/test", false);

      expect(typeof result).toBe("object");
      const err = result as { ok: boolean; error: string };
      expect(err.ok).toBe(false);
      expect(err.error).toContain("Not authenticated");
    });

    test("multiple orgs + yes flag returns error with slug list", async () => {
      resolveOrgPrefetchedSpy.mockResolvedValue(null);
      listOrgsSpy.mockResolvedValue([
        { id: "1", slug: "org-a", name: "Org A" },
        { id: "2", slug: "org-b", name: "Org B" },
      ]);

      const result = await resolveOrgSlug("/tmp/test", true);

      expect(typeof result).toBe("object");
      const err = result as { ok: boolean; error: string };
      expect(err.ok).toBe(false);
      expect(err.error).toContain("Multiple organizations found");
      expect(err.error).toContain("org-a");
      expect(err.error).toContain("org-b");
    });

    test("multiple orgs + interactive select picks chosen org", async () => {
      resolveOrgPrefetchedSpy.mockResolvedValue(null);
      listOrgsSpy.mockResolvedValue([
        { id: "1", slug: "org-a", name: "Org A" },
        { id: "2", slug: "org-b", name: "Org B" },
      ]);
      selectSpy.mockResolvedValue("org-b");

      const result = await resolveOrgSlug("/tmp/test", false);

      expect(result).toBe("org-b");
      expect(selectSpy).toHaveBeenCalledTimes(1);
    });

    test("multiple orgs + user cancels select throws WizardCancelledError", async () => {
      resolveOrgPrefetchedSpy.mockResolvedValue(null);
      listOrgsSpy.mockResolvedValue([
        { id: "1", slug: "org-a", name: "Org A" },
        { id: "2", slug: "org-b", name: "Org B" },
      ]);
      selectSpy.mockResolvedValue(Symbol.for("cancel"));

      await expect(resolveOrgSlug("/tmp/test", false)).rejects.toThrow(
        WizardCancelledError
      );
    });
  });

  test("API error (e.g. 409 conflict) returns ok:false", async () => {
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
    test("numeric ID + cache hit → resolved to slug", async () => {
      resolveOrgPrefetchedSpy.mockResolvedValue({ org: "4507492088676352" });
      getOrgByNumericIdSpy.mockReturnValue({
        slug: "acme-corp",
        regionUrl: "https://us.sentry.io",
      });

      const result = await resolveOrgSlug("/tmp/test", false);

      expect(result).toBe("acme-corp");
      expect(getOrgByNumericIdSpy).toHaveBeenCalledWith("4507492088676352");
    });

    test("numeric ID + cache miss → falls through to single org in listOrganizations", async () => {
      resolveOrgPrefetchedSpy.mockResolvedValue({ org: "4507492088676352" });
      getOrgByNumericIdSpy.mockReturnValue(undefined);
      listOrgsSpy.mockResolvedValue([
        { id: "1", slug: "solo-org", name: "Solo Org" },
      ]);

      const result = await resolveOrgSlug("/tmp/test", false);

      expect(result).toBe("solo-org");
    });

    test("numeric ID + cache miss + multiple orgs + --yes → error with org list", async () => {
      resolveOrgPrefetchedSpy.mockResolvedValue({ org: "4507492088676352" });
      getOrgByNumericIdSpy.mockReturnValue(undefined);
      listOrgsSpy.mockResolvedValue([
        { id: "1", slug: "org-a", name: "Org A" },
        { id: "2", slug: "org-b", name: "Org B" },
      ]);

      const result = await resolveOrgSlug("/tmp/test", true);

      expect(typeof result).toBe("object");
      const err = result as { ok: boolean; error: string };
      expect(err.ok).toBe(false);
      expect(err.error).toContain("Multiple organizations found");
    });
  });

  describe("detectExistingProject (called directly)", () => {
    test("no DSN found → returns null", async () => {
      detectDsnSpy.mockResolvedValue(null);

      const result = await detectExistingProject("/tmp/test");

      expect(result).toBeNull();
    });

    test("DSN found + resolved via resolveDsnByPublicKey → returns org and project", async () => {
      detectDsnSpy.mockResolvedValue({
        publicKey: "test-key-abc",
        protocol: "https",
        host: "o123.ingest.sentry.io",
        projectId: "42",
        raw: "https://test-key-abc@o123.ingest.sentry.io/42",
        source: "env_file" as const,
      });
      resolveDsnByPublicKeySpy.mockResolvedValue({
        org: "acme-corp",
        project: "my-app",
      });

      const result = await detectExistingProject("/tmp/test");

      expect(result).toEqual({
        orgSlug: "acme-corp",
        projectSlug: "my-app",
      });
    });

    test("DSN found + resolveDsnByPublicKey returns null → returns null", async () => {
      detectDsnSpy.mockResolvedValue({
        publicKey: "test-key-abc",
        protocol: "https",
        host: "o123.ingest.sentry.io",
        projectId: "42",
        raw: "https://test-key-abc@o123.ingest.sentry.io/42",
        source: "env_file" as const,
      });
      resolveDsnByPublicKeySpy.mockResolvedValue(null);

      const result = await detectExistingProject("/tmp/test");

      expect(result).toBeNull();
    });

    test("DSN found + API throws (inaccessible org) → returns null", async () => {
      detectDsnSpy.mockResolvedValue({
        publicKey: "test-key-abc",
        protocol: "https",
        host: "o999.ingest.sentry.io",
        projectId: "99",
        raw: "https://test-key-abc@o999.ingest.sentry.io/99",
        source: "env_file" as const,
      });
      resolveDsnByPublicKeySpy.mockRejectedValue(new Error("403 Forbidden"));

      const result = await detectExistingProject("/tmp/test");

      expect(result).toBeNull();
    });

    test("DSN without publicKey → returns null", async () => {
      detectDsnSpy.mockResolvedValue({
        publicKey: "",
        protocol: "https",
        host: "o123.ingest.sentry.io",
        projectId: "42",
        raw: "https://@o123.ingest.sentry.io/42",
        source: "env_file" as const,
      });

      const result = await detectExistingProject("/tmp/test");

      expect(result).toBeNull();
    });
  });

  describe("createSentryProject with org+project set — existing project check", () => {
    test("existing project found → returns it without creating", async () => {
      getProjectSpy.mockResolvedValue(sampleProject);
      tryGetPrimaryDsnSpy.mockResolvedValue(
        "https://abc@o1.ingest.sentry.io/42"
      );
      buildProjectUrlSpy.mockReturnValue(
        "https://sentry.io/settings/acme-corp/projects/my-app/"
      );

      const result = await handleLocalOp(
        makePayload(),
        makeOptions({ org: "acme-corp", project: "my-app" })
      );

      expect(result.ok).toBe(true);
      expect(result.message).toBe(
        'Using existing project "my-app" in acme-corp'
      );
      const data = result.data as { orgSlug: string; projectSlug: string };
      expect(data.orgSlug).toBe("acme-corp");
      expect(data.projectSlug).toBe("my-app");
      expect(createProjectSpy).not.toHaveBeenCalled();
    });

    test("no existing project → creates new one", async () => {
      getProjectSpy.mockRejectedValue(new ApiError("Not Found", 404));
      mockDownstreamSuccess("acme-corp");

      const result = await handleLocalOp(
        makePayload(),
        makeOptions({ org: "acme-corp", project: "my-app" })
      );

      expect(result.ok).toBe(true);
      expect(createProjectSpy).toHaveBeenCalledTimes(1);
    });
  });
});
