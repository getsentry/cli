/**
 * Tests for init preflight project intent and organization resolution.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../../../src/lib/api-client.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../src/lib/api-client.js")>();
  return Object.fromEntries(
    Object.entries(actual).map(([key, value]) => [
      key,
      typeof value === "function" ? vi.fn(value) : value,
    ])
  );
});

vi.mock("../../../src/lib/db/auth.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../src/lib/db/auth.js")>();
  return Object.fromEntries(
    Object.entries(actual).map(([key, value]) => [
      key,
      typeof value === "function" ? vi.fn(value) : value,
    ])
  );
});

vi.mock("../../../src/lib/init/org-prefetch.js", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../../src/lib/init/org-prefetch.js")
    >();
  return Object.fromEntries(
    Object.entries(actual).map(([key, value]) => [
      key,
      typeof value === "function" ? vi.fn(value) : value,
    ])
  );
});

vi.mock("../../../src/lib/resolve-target.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../src/lib/resolve-target.js")>();
  return Object.fromEntries(
    Object.entries(actual).map(([key, value]) => [
      key,
      typeof value === "function" ? vi.fn(value) : value,
    ])
  );
});

// biome-ignore lint/performance/noNamespaceImport: spyOn requires object reference
import * as apiClient from "../../../src/lib/api-client.js";
// biome-ignore lint/performance/noNamespaceImport: spyOn requires object reference
import * as auth from "../../../src/lib/db/auth.js";
import { ApiError } from "../../../src/lib/errors.js";
// biome-ignore lint/performance/noNamespaceImport: spyOn requires object reference
import * as prefetch from "../../../src/lib/init/org-prefetch.js";
import { resolveInitContext } from "../../../src/lib/init/preflight.js";
import type { WizardOptions } from "../../../src/lib/init/types.js";
import { CANCELLED } from "../../../src/lib/init/ui/types.js";
// biome-ignore lint/performance/noNamespaceImport: spyOn requires object reference
import * as resolveTarget from "../../../src/lib/resolve-target.js";
import { createMockUI, type MockCall } from "./ui/mock-ui.js";

function makeOptions(overrides?: Partial<WizardOptions>): WizardOptions {
  return {
    directory: "/work/checkout",
    yes: true,
    dryRun: false,
    ...overrides,
  };
}

function makeProject(slug: string, name = slug) {
  return {
    id: `id-${slug}`,
    slug,
    name,
    platform: "javascript-react",
    dateCreated: "2026-04-16T00:00:00Z",
  } as any;
}

function feedbackOutcomes(calls: MockCall[]): string[] {
  return calls
    .filter(
      (call): call is Extract<MockCall, { kind: "feedback" }> =>
        call.kind === "feedback"
    )
    .map((call) => call.outcome);
}

let resolveOrgPrefetchedSpy: ReturnType<typeof spyOn>;
let listOrganizationsSpy: ReturnType<typeof spyOn>;
let listProjectsSpy: ReturnType<typeof spyOn>;
let getProjectSpy: ReturnType<typeof spyOn>;
let tryGetPrimaryDsnSpy: ReturnType<typeof spyOn>;
let getAuthTokenSpy: ReturnType<typeof spyOn>;
let resolveAllTargetsSpy: ReturnType<typeof spyOn>;

beforeEach(() => {
  resolveOrgPrefetchedSpy = vi
    .spyOn(prefetch, "resolveOrgPrefetched")
    .mockResolvedValue({ org: "acme" });
  listOrganizationsSpy = vi
    .spyOn(apiClient, "listOrganizations")
    .mockResolvedValue([{ id: "1", slug: "acme", name: "Acme" }]);
  listProjectsSpy = vi.spyOn(apiClient, "listProjects").mockResolvedValue([]);
  getProjectSpy = vi
    .spyOn(apiClient, "getProject")
    .mockImplementation(async (_org, slug) => {
      if (slug === "junior") {
        return makeProject("junior");
      }
      throw new ApiError("not found", 404);
    });
  tryGetPrimaryDsnSpy = vi
    .spyOn(apiClient, "tryGetPrimaryDsn")
    .mockResolvedValue("https://abc@o1.ingest.sentry.io/42");
  getAuthTokenSpy = vi
    .spyOn(auth, "getAuthToken")
    .mockReturnValue("sntrys_test");
  resolveAllTargetsSpy = vi
    .spyOn(resolveTarget, "resolveAllTargets")
    .mockResolvedValue({ targets: [] });
});

afterEach(() => {
  resolveOrgPrefetchedSpy.mockRestore();
  listOrganizationsSpy.mockRestore();
  listProjectsSpy.mockRestore();
  getProjectSpy.mockRestore();
  tryGetPrimaryDsnSpy.mockRestore();
  getAuthTokenSpy.mockRestore();
  resolveAllTargetsSpy.mockRestore();
  process.exitCode = 0;
});

describe("resolveInitContext", () => {
  test("automatically uses the shared resolver's concrete project", async () => {
    resolveAllTargetsSpy.mockResolvedValue({
      targets: [
        {
          org: "acme",
          project: "junior",
          projectId: 42,
          orgDisplay: "Acme",
          projectDisplay: "Junior",
          detectedFrom: 'git origin remote "getsentry/junior"',
        },
      ],
    });

    const { ui, calls } = createMockUI();
    const context = await resolveInitContext(makeOptions({ yes: false }), ui);

    expect(context).toEqual(
      expect.objectContaining({
        org: "acme",
        project: "junior",
        team: undefined,
        existingProject: expect.objectContaining({ projectSlug: "junior" }),
      })
    );
    expect(calls.filter((call) => call.kind === "select")).toHaveLength(0);
    expect(listProjectsSpy).not.toHaveBeenCalled();
    expect(resolveAllTargetsSpy).toHaveBeenCalledWith({
      cwd: "/work/checkout",
      resolutionMode: "codebase",
      organizationFilter: "acme",
    });
  });

  test("keeps a canonical DSN when metadata enrichment is unavailable", async () => {
    resolveAllTargetsSpy.mockResolvedValue({
      targets: [
        {
          org: "acme",
          project: "junior",
          projectId: 42,
          orgDisplay: "Acme",
          projectDisplay: "Junior",
          detectedDsn: {
            publicKey: "abc",
            protocol: "https",
            host: "o1.ingest.sentry.io",
            projectId: "42",
            raw: "https://abc@o1.ingest.sentry.io/42",
            source: "env_file" as const,
          },
        },
      ],
    });
    getProjectSpy.mockRejectedValue(new ApiError("temporary failure", 503));

    const { ui } = createMockUI();
    const context = await resolveInitContext(makeOptions(), ui);

    expect(context?.existingProject).toEqual(
      expect.objectContaining({
        projectSlug: "junior",
        projectId: "42",
        dsn: "https://abc@o1.ingest.sentry.io/42",
      })
    );
    expect(getProjectSpy).not.toHaveBeenCalled();
  });

  test("keeps target DSN provenance instead of correlating by array position", async () => {
    const correctDsn = {
      publicKey: "correct",
      protocol: "https",
      host: "o1.ingest.sentry.io",
      projectId: "42",
      raw: "https://correct@o1.ingest.sentry.io/42",
      source: "code" as const,
    };
    resolveAllTargetsSpy.mockResolvedValue({
      targets: [
        {
          org: "acme",
          project: "junior",
          orgDisplay: "Acme",
          projectDisplay: "Junior",
          detectedDsn: correctDsn,
        },
      ],
      detectedDsns: [
        {
          publicKey: "unresolved",
          protocol: "https",
          host: "self-hosted.example.com",
          projectId: "42",
          raw: "https://unresolved@self-hosted.example.com/42",
          source: "code" as const,
        },
        correctDsn,
      ],
    });

    const { ui } = createMockUI();
    const context = await resolveInitContext(makeOptions(), ui);

    expect(context?.existingProject?.dsn).toBe(correctDsn.raw);
    expect(context?.existingProject?.projectId).toBe("42");
  });

  test("does not auto-select a partial multi-DSN resolution", async () => {
    resolveAllTargetsSpy.mockResolvedValue({
      targets: [
        {
          org: "acme",
          project: "junior",
          orgDisplay: "Acme",
          projectDisplay: "Junior",
        },
      ],
      skippedSelfHosted: 1,
    });
    const { ui, respond } = createMockUI();
    respond.select("create");

    const context = await resolveInitContext(makeOptions({ yes: false }), ui);

    expect(context?.org).toBe("acme");
    expect(context?.project).toBeUndefined();
    expect(context?.existingProject).toBeUndefined();
  });

  test("resolves organization before filtering project candidates", async () => {
    resolveOrgPrefetchedSpy.mockResolvedValue({
      org: "acme",
      detectedFrom: "SENTRY_ORG env var",
    });
    resolveAllTargetsSpy.mockResolvedValue({
      targets: [
        {
          org: "other",
          project: "junior",
          orgDisplay: "Other",
          projectDisplay: "Junior",
        },
      ],
    });
    const { ui, respond } = createMockUI();
    respond.select("create");

    const context = await resolveInitContext(makeOptions({ yes: false }), ui);

    expect(resolveAllTargetsSpy).toHaveBeenCalledWith({
      cwd: "/work/checkout",
      resolutionMode: "codebase",
      organizationFilter: "acme",
    });
    expect(context?.org).toBe("acme");
    expect(context?.project).toBeUndefined();
  });

  test("filters shared resolver matches by an explicit organization", async () => {
    resolveAllTargetsSpy.mockResolvedValue({
      targets: [
        {
          org: "other",
          project: "junior",
          orgDisplay: "Other",
          projectDisplay: "Junior",
        },
        {
          org: "acme",
          project: "junior",
          orgDisplay: "Acme",
          projectDisplay: "Junior",
        },
      ],
    });

    const { ui } = createMockUI();
    const context = await resolveInitContext(makeOptions({ org: "acme" }), ui);

    expect(context?.existingProject?.projectSlug).toBe("junior");
  });

  test("filters ambiguous cross-org matches after organization resolution", async () => {
    resolveAllTargetsSpy.mockResolvedValue({
      targets: [
        {
          org: "other",
          project: "junior",
          orgDisplay: "Other",
          projectDisplay: "Junior",
        },
        {
          org: "acme",
          project: "junior",
          orgDisplay: "Acme",
          projectDisplay: "Junior",
        },
      ],
    });

    const { ui, calls } = createMockUI();
    const context = await resolveInitContext(makeOptions({ yes: false }), ui);

    expect(context?.org).toBe("acme");
    expect(context?.existingProject?.projectSlug).toBe("junior");
    expect(calls.filter((call) => call.kind === "select")).toHaveLength(0);
  });

  test("falls back to the only listed organization when detection misses", async () => {
    resolveOrgPrefetchedSpy.mockResolvedValue(null);
    listOrganizationsSpy.mockResolvedValue([
      { id: "1", slug: "solo-org", name: "Solo Org" },
    ]);

    const { ui, respond } = createMockUI();
    respond.select("create");
    const context = await resolveInitContext(
      makeOptions({ yes: false, directory: "/work/no-match" }),
      ui
    );

    expect(context?.org).toBe("solo-org");
  });

  test("uses an explicitly named existing project without prompting", async () => {
    const { ui, calls } = createMockUI();
    const context = await resolveInitContext(
      makeOptions({ yes: false, project: "junior" }),
      ui
    );

    expect(context?.existingProject?.projectSlug).toBe("junior");
    expect(calls.filter((call) => call.kind === "select")).toHaveLength(0);
  });

  test("keeps an explicitly named new project when no exact project exists", async () => {
    getProjectSpy.mockRejectedValueOnce(new ApiError("not found", 404));

    const { ui } = createMockUI();
    const context = await resolveInitContext(
      makeOptions({ project: "brand-new" }),
      ui
    );

    expect(context?.project).toBe("brand-new");
    expect(context?.existingProject).toBeUndefined();
  });

  test("surfaces transient failures while checking an explicitly named project", async () => {
    getProjectSpy.mockRejectedValueOnce(new ApiError("unavailable", 503));
    const { ui } = createMockUI();

    await expect(
      resolveInitContext(makeOptions({ project: "junior" }), ui)
    ).rejects.toThrow("unavailable");
  });

  test("continues create-first flow when shared resolution fails", async () => {
    resolveAllTargetsSpy.mockRejectedValue(new ApiError("unavailable", 503));
    const { ui, respond, calls } = createMockUI();
    respond.select("create");

    const context = await resolveInitContext(
      makeOptions({ yes: false, directory: "/work/local-checkout" }),
      ui
    );

    expect(context?.project).toBeUndefined();
    expect(calls.filter((call) => call.kind === "select")).toHaveLength(1);
  });

  test("does not auto-select an ambiguous shared resolution", async () => {
    resolveAllTargetsSpy.mockResolvedValue({
      targets: [
        {
          org: "acme",
          project: "junior",
          orgDisplay: "Acme",
          projectDisplay: "Junior",
        },
        {
          org: "acme",
          project: "backend",
          orgDisplay: "Acme",
          projectDisplay: "Backend",
        },
      ],
    });
    const { ui, respond } = createMockUI();
    respond.select("create");

    const context = await resolveInitContext(
      makeOptions({ yes: false, directory: "/work/local-checkout" }),
      ui
    );

    expect(context?.project).toBeUndefined();
    expect(context?.existingProject).toBeUndefined();
  });

  test("does not reuse a fuzzy-only project-root match", async () => {
    resolveAllTargetsSpy.mockResolvedValue({
      targets: [
        {
          org: "acme",
          project: "checkout-service",
          orgDisplay: "Acme",
          projectDisplay: "Checkout Service",
          matchStrength: "fuzzy",
        },
      ],
    });
    const { ui, respond } = createMockUI();
    respond.select("create");

    const context = await resolveInitContext(makeOptions({ yes: false }), ui);

    expect(context?.project).toBeUndefined();
    expect(context?.existingProject).toBeUndefined();
  });

  test("offers create first when no likely project matches", async () => {
    listProjectsSpy.mockResolvedValue([
      makeProject("backend"),
      makeProject("frontend"),
    ]);
    const { ui, calls, respond } = createMockUI();
    respond.select("create");

    const context = await resolveInitContext(makeOptions({ yes: false }), ui);

    expect(context?.project).toBeUndefined();
    expect(calls).toContainEqual({
      kind: "select",
      message: "How should Sentry be configured for this codebase?",
      options: ["create", "existing"],
    });
    expect(listProjectsSpy).not.toHaveBeenCalled();
  });

  test("opens the project list only after choosing the existing-project path", async () => {
    listProjectsSpy.mockResolvedValue([
      makeProject("backend", "Backend"),
      makeProject("frontend", "Frontend"),
    ]);
    getProjectSpy.mockImplementation(async (_org, slug) => {
      if (slug === "frontend") {
        return makeProject("frontend", "Frontend");
      }
      throw new ApiError("not found", 404);
    });
    const { ui, calls, respond } = createMockUI();
    respond.select("existing");
    respond.select("frontend");

    const context = await resolveInitContext(makeOptions({ yes: false }), ui);

    expect(context?.existingProject?.projectSlug).toBe("frontend");
    expect(calls.filter((call) => call.kind === "select")).toEqual([
      {
        kind: "select",
        message: "How should Sentry be configured for this codebase?",
        options: ["create", "existing"],
      },
      {
        kind: "select",
        message: "Which existing Sentry project should be used?",
        options: ["backend", "frontend"],
      },
    ]);
  });

  test("does not ask for a team and preserves an explicit --team", async () => {
    const { ui, calls } = createMockUI();
    const context = await resolveInitContext(
      makeOptions({ team: "backend" }),
      ui
    );

    expect(context?.team).toEqual({ slug: "backend", source: "explicit" });
    expect(calls.filter((call) => call.kind === "select")).toHaveLength(0);
  });

  test("does not list every project in non-interactive create mode", async () => {
    listProjectsSpy.mockRejectedValueOnce(new ApiError("unavailable", 503));
    const { ui } = createMockUI();

    const context = await resolveInitContext(makeOptions(), ui);

    expect(context?.project).toBeUndefined();
    expect(listProjectsSpy).not.toHaveBeenCalled();
  });

  test("surfaces project-list failures after the user chooses existing", async () => {
    listProjectsSpy.mockRejectedValueOnce(new ApiError("unavailable", 503));
    const { ui, respond } = createMockUI();
    respond.select("existing");

    await expect(
      resolveInitContext(makeOptions({ yes: false }), ui)
    ).rejects.toThrow("Could not list existing projects");
  });

  test("does not turn a stale existing-project selection into creation", async () => {
    listProjectsSpy.mockResolvedValue([makeProject("backend")]);
    const { ui, respond } = createMockUI();
    respond.select("existing");
    respond.select("backend");

    await expect(
      resolveInitContext(makeOptions({ yes: false }), ui)
    ).rejects.toThrow("Project 'acme/backend' is no longer available");
  });

  test("returns null when the user cancels project intent selection", async () => {
    listProjectsSpy.mockResolvedValue([makeProject("backend")]);
    const { ui, calls, respond } = createMockUI();
    respond.select(CANCELLED);

    const context = await resolveInitContext(makeOptions({ yes: false }), ui);

    expect(context).toBeNull();
    expect(feedbackOutcomes(calls)).toEqual(["cancelled"]);
  });

  test("surfaces 403 guidance when organizations cannot be listed", async () => {
    resolveOrgPrefetchedSpy.mockResolvedValue(null);
    listOrganizationsSpy.mockRejectedValueOnce(
      new ApiError("Failed to list organizations", 403, "Missing org:read")
    );
    const { ui, calls } = createMockUI();

    await expect(resolveInitContext(makeOptions(), ui)).rejects.toThrow(
      "403 Forbidden"
    );
    expect(calls.find((call) => call.kind === "log.error")).toEqual(
      expect.objectContaining({
        message: expect.stringContaining("sentry init <org-slug>/"),
      })
    );
  });

  test("includes the auth token in the resolved context", async () => {
    const { ui } = createMockUI();
    const context = await resolveInitContext(makeOptions(), ui);

    expect(context?.authToken).toBe("sntrys_test");
  });
});

