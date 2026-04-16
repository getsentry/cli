import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
// biome-ignore lint/performance/noNamespaceImport: spyOn requires object reference
import * as clack from "@clack/prompts";
// biome-ignore lint/performance/noNamespaceImport: spyOn requires object reference
import * as apiClient from "../../../src/lib/api-client.js";
// biome-ignore lint/performance/noNamespaceImport: spyOn requires object reference
import * as auth from "../../../src/lib/db/auth.js";
// biome-ignore lint/performance/noNamespaceImport: spyOn requires object reference
import * as dsnIndex from "../../../src/lib/dsn/index.js";
import { ApiError } from "../../../src/lib/errors.js";
// biome-ignore lint/performance/noNamespaceImport: spyOn requires object reference
import * as prefetch from "../../../src/lib/init/prefetch.js";
import { resolveInitContext } from "../../../src/lib/init/preflight.js";
import type { WizardOptions } from "../../../src/lib/init/types.js";
// biome-ignore lint/performance/noNamespaceImport: spyOn requires object reference
import * as resolveTarget from "../../../src/lib/resolve-target.js";
// biome-ignore lint/performance/noNamespaceImport: spyOn requires object reference
import * as resolveTeam from "../../../src/lib/resolve-team.js";

function makeOptions(overrides?: Partial<WizardOptions>): WizardOptions {
  return {
    directory: "/tmp/test",
    yes: true,
    dryRun: false,
    ...overrides,
  };
}

const noop = () => {
  /* suppress prompt output */
};

let selectSpy: ReturnType<typeof spyOn>;
let isCancelSpy: ReturnType<typeof spyOn>;
let cancelSpy: ReturnType<typeof spyOn>;
let logErrorSpy: ReturnType<typeof spyOn>;
let resolveOrgPrefetchedSpy: ReturnType<typeof spyOn>;
let listOrganizationsSpy: ReturnType<typeof spyOn>;
let getProjectSpy: ReturnType<typeof spyOn>;
let tryGetPrimaryDsnSpy: ReturnType<typeof spyOn>;
let getAuthTokenSpy: ReturnType<typeof spyOn>;
let resolveOrCreateTeamSpy: ReturnType<typeof spyOn>;
let detectDsnSpy: ReturnType<typeof spyOn>;
let resolveDsnByPublicKeySpy: ReturnType<typeof spyOn>;

beforeEach(() => {
  selectSpy = spyOn(clack, "select").mockResolvedValue("existing");
  isCancelSpy = spyOn(clack, "isCancel").mockImplementation(
    (value: unknown) => value === Symbol.for("cancel")
  );
  cancelSpy = spyOn(clack, "cancel").mockImplementation(noop);
  logErrorSpy = spyOn(clack.log, "error").mockImplementation(noop);

  resolveOrgPrefetchedSpy = spyOn(
    prefetch,
    "resolveOrgPrefetched"
  ).mockResolvedValue({ org: "acme" });
  listOrganizationsSpy = spyOn(
    apiClient,
    "listOrganizations"
  ).mockResolvedValue([{ id: "1", slug: "acme", name: "Acme" }]);
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
  getAuthTokenSpy = spyOn(auth, "getAuthToken").mockReturnValue("sntrys_test");
  resolveOrCreateTeamSpy = spyOn(
    resolveTeam,
    "resolveOrCreateTeam"
  ).mockResolvedValue({
    slug: "platform",
    source: "auto-selected",
  });
  detectDsnSpy = spyOn(dsnIndex, "detectDsn").mockResolvedValue(null);
  resolveDsnByPublicKeySpy = spyOn(
    resolveTarget,
    "resolveDsnByPublicKey"
  ).mockResolvedValue(null);
});

afterEach(() => {
  selectSpy.mockRestore();
  isCancelSpy.mockRestore();
  cancelSpy.mockRestore();
  logErrorSpy.mockRestore();
  resolveOrgPrefetchedSpy.mockRestore();
  listOrganizationsSpy.mockRestore();
  getProjectSpy.mockRestore();
  tryGetPrimaryDsnSpy.mockRestore();
  getAuthTokenSpy.mockRestore();
  resolveOrCreateTeamSpy.mockRestore();
  detectDsnSpy.mockRestore();
  resolveDsnByPublicKeySpy.mockRestore();
  process.exitCode = 0;
});

describe("resolveInitContext", () => {
  test("uses an existing detected project in --yes mode", async () => {
    detectDsnSpy.mockResolvedValue({
      publicKey: "abc",
      protocol: "https",
      host: "o1.ingest.sentry.io",
      projectId: "42",
      raw: "https://abc@o1.ingest.sentry.io/42",
      source: "env_file" as const,
    });
    resolveDsnByPublicKeySpy.mockResolvedValue({
      org: "acme",
      project: "my-app",
    });

    const context = await resolveInitContext(makeOptions());

    expect(context).toEqual(
      expect.objectContaining({
        org: "acme",
        project: "my-app",
        team: "platform",
        authToken: "sntrys_test",
        existingProject: expect.objectContaining({
          orgSlug: "acme",
          projectSlug: "my-app",
        }),
      })
    );
  });

  test("keeps a detected DSN project even when project enrichment fails", async () => {
    detectDsnSpy.mockResolvedValue({
      publicKey: "abc",
      protocol: "https",
      host: "o1.ingest.sentry.io",
      projectId: "42",
      raw: "https://abc@o1.ingest.sentry.io/42",
      source: "env_file" as const,
    });
    resolveDsnByPublicKeySpy.mockResolvedValue({
      org: "acme",
      project: "my-app",
    });
    getProjectSpy.mockRejectedValue(new ApiError("temporary failure", 503));

    const context = await resolveInitContext(makeOptions());

    expect(context).toEqual(
      expect.objectContaining({
        org: "acme",
        project: "my-app",
        team: "platform",
      })
    );
    expect(context?.existingProject).toBeUndefined();
  });

  test("falls back to listing organizations when prefetch misses", async () => {
    resolveOrgPrefetchedSpy.mockResolvedValue(null);
    listOrganizationsSpy.mockResolvedValue([
      { id: "1", slug: "solo-org", name: "Solo Org" },
    ]);

    const context = await resolveInitContext(makeOptions({ yes: false }));

    expect(context?.org).toBe("solo-org");
  });

  test("lets the user choose an existing bare-slug project", async () => {
    selectSpy.mockResolvedValue("existing");

    const context = await resolveInitContext(
      makeOptions({ yes: false, project: "my-app" })
    );

    expect(context?.project).toBe("my-app");
    expect(context?.existingProject?.projectSlug).toBe("my-app");
  });

  test("keeps the bare slug when the existence lookup fails", async () => {
    getProjectSpy.mockRejectedValue(new ApiError("temporary failure", 503));

    const context = await resolveInitContext(
      makeOptions({ yes: false, project: "my-app" })
    );

    expect(context?.project).toBe("my-app");
    expect(context?.existingProject).toBeUndefined();
  });

  test("clears the project when the user chooses to create new", async () => {
    selectSpy.mockResolvedValue("create");

    const context = await resolveInitContext(
      makeOptions({ yes: false, project: "my-app" })
    );

    expect(context?.project).toBeUndefined();
    expect(context?.existingProject).toBeUndefined();
  });

  test("uses the ambiguity callback when team selection requires it", async () => {
    selectSpy.mockResolvedValue("mobile");
    resolveOrCreateTeamSpy.mockImplementation(async (_org, options) => {
      const slug = await options.onAmbiguous?.([
        { slug: "mobile", name: "Mobile", isMember: true },
        { slug: "platform", name: "Platform", isMember: true },
      ] as any);
      return { slug, source: "auto-selected" };
    });

    const context = await resolveInitContext(makeOptions({ yes: false }));

    expect(context?.team).toBe("mobile");
  });

  test("returns null when the user cancels an org selection", async () => {
    resolveOrgPrefetchedSpy.mockResolvedValue(null);
    listOrganizationsSpy.mockResolvedValue([
      { id: "1", slug: "acme", name: "Acme" },
      { id: "2", slug: "beta", name: "Beta" },
    ]);
    selectSpy.mockResolvedValue(Symbol.for("cancel"));

    const context = await resolveInitContext(makeOptions({ yes: false }));

    expect(context).toBeNull();
    expect(cancelSpy).toHaveBeenCalledWith("Setup cancelled.");
  });

  test("includes the auth token in the resolved context", async () => {
    const context = await resolveInitContext(makeOptions());

    expect(context?.authToken).toBe("sntrys_test");
  });
});
