/**
 * Tests for `resolveInitContext`. Stubs API and DSN-detection layers
 * with `spyOn` and uses `MockUI` to drive prompts deterministically.
 */

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
// biome-ignore lint/performance/noNamespaceImport: spyOn requires object reference
import * as apiClient from "../../../src/lib/api-client.js";
// biome-ignore lint/performance/noNamespaceImport: spyOn requires object reference
import * as auth from "../../../src/lib/db/auth.js";
// biome-ignore lint/performance/noNamespaceImport: spyOn requires object reference
import * as dsnIndex from "../../../src/lib/dsn/index.js";
import { ApiError } from "../../../src/lib/errors.js";
// biome-ignore lint/performance/noNamespaceImport: spyOn requires object reference
import * as prefetch from "../../../src/lib/init/org-prefetch.js";
import { resolveInitContext } from "../../../src/lib/init/preflight.js";
import type { WizardOptions } from "../../../src/lib/init/types.js";
import { CANCELLED } from "../../../src/lib/init/ui/types.js";
// biome-ignore lint/performance/noNamespaceImport: spyOn requires object reference
import * as resolveTarget from "../../../src/lib/resolve-target.js";
// biome-ignore lint/performance/noNamespaceImport: spyOn requires object reference
import * as resolveTeam from "../../../src/lib/resolve-team.js";
import { createMockUI, type MockCall } from "./ui/mock-ui.js";

function makeOptions(overrides?: Partial<WizardOptions>): WizardOptions {
  return {
    directory: "/tmp/test",
    yes: true,
    dryRun: false,
    ...overrides,
  };
}

function feedbackOutcomes(calls: MockCall[]): string[] {
  return calls
    .filter(
      (c): c is Extract<MockCall, { kind: "feedback" }> => c.kind === "feedback"
    )
    .map((c) => c.outcome);
}

let resolveOrgPrefetchedSpy: ReturnType<typeof spyOn>;
let listOrganizationsSpy: ReturnType<typeof spyOn>;
let getProjectSpy: ReturnType<typeof spyOn>;
let tryGetPrimaryDsnSpy: ReturnType<typeof spyOn>;
let getAuthTokenSpy: ReturnType<typeof spyOn>;
let resolveOrCreateTeamSpy: ReturnType<typeof spyOn>;
let detectDsnSpy: ReturnType<typeof spyOn>;
let resolveDsnByPublicKeySpy: ReturnType<typeof spyOn>;

beforeEach(() => {
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

    const { ui } = createMockUI();
    const context = await resolveInitContext(makeOptions(), ui);

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
    expect(getProjectSpy).toHaveBeenCalledTimes(1);
    expect(tryGetPrimaryDsnSpy).toHaveBeenCalledTimes(1);
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

    const { ui } = createMockUI();
    const context = await resolveInitContext(makeOptions(), ui);

    expect(context).toEqual(
      expect.objectContaining({
        org: "acme",
        project: "my-app",
        team: "platform",
      })
    );
    expect(context?.existingProject).toBeUndefined();
  });

  test("retries detected project enrichment during project selection when the first lookup yields no metadata", async () => {
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
    getProjectSpy
      .mockRejectedValueOnce(new ApiError("not found", 404))
      .mockResolvedValue({
        id: "42",
        slug: "my-app",
        name: "my-app",
        platform: "javascript-react",
        dateCreated: "2026-04-16T00:00:00Z",
      } as any);

    const { ui } = createMockUI();
    const context = await resolveInitContext(makeOptions(), ui);

    expect(context?.existingProject).toEqual(
      expect.objectContaining({
        orgSlug: "acme",
        projectSlug: "my-app",
      })
    );
    expect(getProjectSpy).toHaveBeenCalledTimes(2);
    expect(tryGetPrimaryDsnSpy).toHaveBeenCalledTimes(1);
  });

  test("falls back to listing organizations when prefetch misses", async () => {
    resolveOrgPrefetchedSpy.mockResolvedValue(null);
    listOrganizationsSpy.mockResolvedValue([
      { id: "1", slug: "solo-org", name: "Solo Org" },
    ]);

    const { ui } = createMockUI();
    const context = await resolveInitContext(makeOptions({ yes: false }), ui);

    expect(context?.org).toBe("solo-org");
  });

  test("lets the user choose an existing bare-slug project", async () => {
    const { ui, respond } = createMockUI();
    respond.select("existing");

    const context = await resolveInitContext(
      makeOptions({ yes: false, project: "my-app" }),
      ui
    );

    expect(context?.project).toBe("my-app");
    expect(context?.existingProject?.projectSlug).toBe("my-app");
  });

  test("keeps the bare slug when the existence lookup fails", async () => {
    getProjectSpy.mockRejectedValue(new ApiError("temporary failure", 503));

    const { ui } = createMockUI();
    const context = await resolveInitContext(
      makeOptions({ yes: false, project: "my-app" }),
      ui
    );

    expect(context?.project).toBe("my-app");
    expect(context?.existingProject).toBeUndefined();
  });

  test("defers empty-org team creation until project creation", async () => {
    resolveOrCreateTeamSpy.mockResolvedValue({ source: "deferred" } as any);

    const { ui } = createMockUI();
    const context = await resolveInitContext(makeOptions(), ui);

    expect(context?.team).toBeUndefined();
    expect(resolveOrCreateTeamSpy).toHaveBeenCalledWith(
      "acme",
      expect.objectContaining({
        team: undefined,
        deferAutoCreateOnEmptyOrg: true,
      })
    );
  });

  test("clears the project when the user chooses to create new", async () => {
    const { ui, respond } = createMockUI();
    respond.select("create");

    const context = await resolveInitContext(
      makeOptions({ yes: false, project: "my-app" }),
      ui
    );

    expect(context?.project).toBeUndefined();
    expect(context?.existingProject).toBeUndefined();
  });

  test("resolves an explicit team during preflight", async () => {
    resolveOrCreateTeamSpy.mockImplementation(async (_org, options) => ({
      slug: options.team ?? "platform",
      source: options.team ? "explicit" : "auto-selected",
    }));

    const { ui } = createMockUI();
    const context = await resolveInitContext(
      makeOptions({ team: "backend", yes: false }),
      ui
    );

    expect(context?.team).toBe("backend");
    expect(resolveOrCreateTeamSpy).toHaveBeenCalledWith(
      "acme",
      expect.objectContaining({
        team: "backend",
        deferAutoCreateOnEmptyOrg: true,
      })
    );
  });

  test("uses the ambiguity callback when team selection requires it", async () => {
    const { ui, respond } = createMockUI();
    respond.select("mobile");
    resolveOrCreateTeamSpy.mockImplementation(async (_org, options) => {
      const slug = await options.onAmbiguous?.([
        { slug: "mobile", name: "Mobile", isMember: true },
        { slug: "platform", name: "Platform", isMember: true },
      ] as any);
      return { slug, source: "auto-selected" };
    });

    const context = await resolveInitContext(makeOptions({ yes: false }), ui);

    expect(context?.team).toBe("mobile");
  });

  test("returns null when the user cancels an org selection", async () => {
    resolveOrgPrefetchedSpy.mockResolvedValue(null);
    listOrganizationsSpy.mockResolvedValue([
      { id: "1", slug: "acme", name: "Acme" },
      { id: "2", slug: "beta", name: "Beta" },
    ]);

    const { ui, calls, respond } = createMockUI();
    respond.select(CANCELLED);

    const context = await resolveInitContext(makeOptions({ yes: false }), ui);

    expect(context).toBeNull();
    const cancelCall = calls.find((c) => c.kind === "cancel");
    expect(cancelCall?.kind === "cancel" && cancelCall.message).toBe(
      "Setup cancelled."
    );
    expect(feedbackOutcomes(calls)).toEqual(["cancelled"]);
  });

  test("includes the auth token in the resolved context", async () => {
    const { ui } = createMockUI();
    const context = await resolveInitContext(makeOptions(), ui);

    expect(context?.authToken).toBe("sntrys_test");
  });
});
