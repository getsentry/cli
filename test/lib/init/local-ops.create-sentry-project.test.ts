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
});
