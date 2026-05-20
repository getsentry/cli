/**
 * Tests for new resolve-target listing functions
 *
 * Tests for resolveOrgsForListing, resolveOrgProjectTarget, and
 * resolveOrgProjectFromArg added in the pagination PR.
 * Uses spyOn to mock dependencies without real HTTP calls.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../../src/lib/api-client.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/lib/api-client.js")>();
  return Object.fromEntries(
    Object.entries(actual).map(([k, v]) => [
      k,
      typeof v === "function" ? vi.fn(v) : v,
    ])
  );
});

// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as apiClient from "../../src/lib/api-client.js";
import { DEFAULT_SENTRY_URL } from "../../src/lib/constants.js";

vi.mock("../../src/lib/db/defaults.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/lib/db/defaults.js")>();
  return Object.fromEntries(
    Object.entries(actual).map(([k, v]) => [
      k,
      typeof v === "function" ? vi.fn(v) : v,
    ])
  );
});

// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as defaults from "../../src/lib/db/defaults.js";
import { setOrgRegion } from "../../src/lib/db/regions.js";
import { ContextError, ResolutionError } from "../../src/lib/errors.js";

vi.mock("../../src/lib/resolve-target.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/lib/resolve-target.js")>();
  return Object.fromEntries(
    Object.entries(actual).map(([k, v]) => [
      k,
      typeof v === "function" ? vi.fn(v) : v,
    ])
  );
});

// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as resolveTargetModule from "../../src/lib/resolve-target.js";
import {
  resolveOrgProjectFromArg,
  resolveOrgProjectTarget,
  resolveOrgsForListing,
} from "../../src/lib/resolve-target.js";

const CWD = "/tmp/test-project";

// ---------------------------------------------------------------------------
// resolveOrgsForListing
// ---------------------------------------------------------------------------

describe("resolveOrgsForListing", () => {
  let getDefaultOrganizationSpy: ReturnType<typeof spyOn>;
  let resolveAllTargetsSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    getDefaultOrganizationSpy = vi.spyOn(defaults, "getDefaultOrganization");
    resolveAllTargetsSpy = vi.spyOn(resolveTargetModule, "resolveAllTargets");

    getDefaultOrganizationSpy.mockReturnValue(null);
    resolveAllTargetsSpy.mockResolvedValue({ targets: [] });
  });

  afterEach(() => {
    getDefaultOrganizationSpy.mockRestore();
    resolveAllTargetsSpy.mockRestore();
  });

  test("returns explicit org when orgFlag is provided", async () => {
    const result = await resolveOrgsForListing("my-org", CWD);
    expect(result.orgs).toEqual(["my-org"]);
    // Should not consult defaults or DSN when explicit org given
    expect(getDefaultOrganizationSpy).not.toHaveBeenCalled();
  });

  test("returns default org when no orgFlag and default exists", async () => {
    getDefaultOrganizationSpy.mockReturnValue("default-org");

    const result = await resolveOrgsForListing(undefined, CWD);
    expect(result.orgs).toEqual(["default-org"]);
  });

  // Skip: resolveOrgsForListing calls resolveAllTargets internally (same-file).
  // vi.spyOn on the export doesn't intercept same-file calls in vitest.
  // These tests are covered by the Bun test suite.
  // biome-ignore lint/suspicious/noSkippedTests: vitest can't intercept same-file internal calls
  test.skip("returns unique orgs from DSN detection when no default", async () => {
    resolveAllTargetsSpy.mockResolvedValue({
      targets: [
        { org: "org-a", project: "proj-1" },
        { org: "org-a", project: "proj-2" }, // same org, different project
        { org: "org-b", project: "proj-3" },
      ],
    });

    const result = await resolveOrgsForListing(undefined, CWD);
    // Should deduplicate orgs
    expect(result.orgs).toEqual(["org-a", "org-b"]);
  });

  test("returns empty orgs when no detection results", async () => {
    resolveAllTargetsSpy.mockResolvedValue({ targets: [] });

    const result = await resolveOrgsForListing(undefined, CWD);
    expect(result.orgs).toEqual([]);
  });

  // biome-ignore lint/suspicious/noSkippedTests: vitest can't intercept same-file internal calls
  test.skip("propagates footer from DSN detection", async () => {
    resolveAllTargetsSpy.mockResolvedValue({
      targets: [
        { org: "org-a", project: "proj-1" },
        { org: "org-b", project: "proj-2" },
      ],
      footer: "Found 2 projects",
    });

    const result = await resolveOrgsForListing(undefined, CWD);
    expect(result.footer).toBe("Found 2 projects");
  });

  // biome-ignore lint/suspicious/noSkippedTests: vitest can't intercept same-file internal calls
  test.skip("propagates skippedSelfHosted from DSN detection", async () => {
    resolveAllTargetsSpy.mockResolvedValue({
      targets: [{ org: "org-a", project: "proj-1" }],
      skippedSelfHosted: 2,
    });

    const result = await resolveOrgsForListing(undefined, CWD);
    expect(result.skippedSelfHosted).toBe(2);
  });

  // biome-ignore lint/suspicious/noSkippedTests: vitest can't intercept same-file internal calls
  test.skip("returns empty orgs and propagates skippedSelfHosted when targets empty but DSNs found", async () => {
    resolveAllTargetsSpy.mockResolvedValue({
      targets: [],
      skippedSelfHosted: 3,
    });

    const result = await resolveOrgsForListing(undefined, CWD);
    expect(result.orgs).toEqual([]);
    expect(result.skippedSelfHosted).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// resolveOrgProjectTarget
// ---------------------------------------------------------------------------

describe("resolveOrgProjectTarget", () => {
  let findProjectsBySlugSpy: ReturnType<typeof spyOn>;
  let resolveOrgAndProjectSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    findProjectsBySlugSpy = vi.spyOn(apiClient, "findProjectsBySlug");
    resolveOrgAndProjectSpy = vi.spyOn(
      resolveTargetModule,
      "resolveOrgAndProject"
    );
    // Pre-populate org region cache so resolveEffectiveOrg doesn't fetch
    setOrgRegion("my-org", DEFAULT_SENTRY_URL);
  });

  afterEach(() => {
    findProjectsBySlugSpy.mockRestore();
    resolveOrgAndProjectSpy.mockRestore();
  });

  test("returns org and project for explicit type", async () => {
    const parsed = {
      type: "explicit" as const,
      org: "my-org",
      project: "my-proj",
    };

    const result = await resolveOrgProjectTarget(parsed, CWD, "trace list");
    expect(result).toEqual({ org: "my-org", project: "my-proj" });
    expect(findProjectsBySlugSpy).not.toHaveBeenCalled();
  });

  test("throws ContextError for org-all type", async () => {
    const parsed = { type: "org-all" as const, org: "my-org" };

    await expect(
      resolveOrgProjectTarget(parsed, CWD, "trace list")
    ).rejects.toThrow(ContextError);
  });

  test("resolves project-search when single match found", async () => {
    findProjectsBySlugSpy.mockResolvedValue({
      projects: [{ orgSlug: "found-org", slug: "my-proj", name: "My Project" }],
      orgs: [],
    });

    const parsed = { type: "project-search" as const, projectSlug: "my-proj" };

    const result = await resolveOrgProjectTarget(parsed, CWD, "trace list");
    expect(result).toMatchObject({ org: "found-org", project: "my-proj" });
    expect(result.projectData).toBeDefined();
  });

  test("throws ResolutionError for project-search when no match", async () => {
    findProjectsBySlugSpy.mockResolvedValue({ projects: [], orgs: [] });

    const parsed = {
      type: "project-search" as const,
      projectSlug: "nonexistent",
    };

    await expect(
      resolveOrgProjectTarget(parsed, CWD, "trace list")
    ).rejects.toThrow(ResolutionError);
  });

  test("throws ResolutionError for project-search when multiple matches", async () => {
    findProjectsBySlugSpy.mockResolvedValue({
      projects: [
        { orgSlug: "org-a", slug: "my-proj", name: "My Project" },
        { orgSlug: "org-b", slug: "my-proj", name: "My Project" },
      ],
      orgs: [],
    });

    const parsed = { type: "project-search" as const, projectSlug: "my-proj" };

    await expect(
      resolveOrgProjectTarget(parsed, CWD, "trace list")
    ).rejects.toThrow(ResolutionError);
  });

  // Skip: same-file internal call — resolveOrgProjectTarget → resolveAllTargets
  // biome-ignore lint/suspicious/noSkippedTests: vitest can't intercept same-file internal calls
  test.skip("resolves auto-detect when DSN detection succeeds", async () => {
    resolveOrgAndProjectSpy.mockResolvedValue({
      org: "detected-org",
      project: "detected-proj",
      orgDisplay: "Detected Org",
      projectDisplay: "Detected Project",
    });

    const parsed = { type: "auto-detect" as const };

    const result = await resolveOrgProjectTarget(parsed, CWD, "log list");
    expect(result).toEqual({ org: "detected-org", project: "detected-proj" });
  });

  test("throws ContextError for auto-detect when no target found", async () => {
    resolveOrgAndProjectSpy.mockResolvedValue(null);

    const parsed = { type: "auto-detect" as const };

    await expect(
      resolveOrgProjectTarget(parsed, CWD, "log list")
    ).rejects.toThrow(ContextError);
  });

  test("error message for org-all includes command name and project hint", async () => {
    const parsed = { type: "org-all" as const, org: "sentry" };

    try {
      await resolveOrgProjectTarget(parsed, CWD, "trace list");
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ContextError);
      expect((err as Error).message).toContain("trace list");
      expect((err as Error).message).toContain("sentry");
    }
  });

  test("throws ResolutionError when project-search slug matches an organization", async () => {
    // Lines 1017-1023: slug matches an org but no project → org-as-project error
    findProjectsBySlugSpy.mockResolvedValue({
      projects: [],
      orgs: [{ slug: "acme-corp", name: "Acme Corp" }],
    });

    const parsed = {
      type: "project-search" as const,
      projectSlug: "acme-corp",
    };

    try {
      await resolveOrgProjectTarget(parsed, CWD, "trace list");
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ResolutionError);
      const msg = (err as ResolutionError).message;
      expect(msg).toContain("is an organization, not a project");
      expect(msg).toContain("acme-corp/<project>");
      expect(msg).toContain("sentry project list acme-corp/");
    }
  });
});

// ---------------------------------------------------------------------------
// resolveOrgProjectFromArg
// ---------------------------------------------------------------------------

describe("resolveOrgProjectFromArg", () => {
  let findProjectsBySlugSpy: ReturnType<typeof spyOn>;
  let resolveOrgAndProjectSpy: ReturnType<typeof spyOn>;

  beforeEach(async () => {
    findProjectsBySlugSpy = vi.spyOn(apiClient, "findProjectsBySlug");
    resolveOrgAndProjectSpy = vi.spyOn(
      resolveTargetModule,
      "resolveOrgAndProject"
    );
    setOrgRegion("my-org", DEFAULT_SENTRY_URL);
  });

  afterEach(() => {
    findProjectsBySlugSpy.mockRestore();
    resolveOrgAndProjectSpy.mockRestore();
  });

  test("resolves 'org/project' string to explicit target", async () => {
    const result = await resolveOrgProjectFromArg(
      "my-org/my-proj",
      CWD,
      "trace list"
    );
    expect(result).toEqual({ org: "my-org", project: "my-proj" });
  });

  test("resolves bare project slug string via project-search", async () => {
    findProjectsBySlugSpy.mockResolvedValue({
      projects: [{ orgSlug: "found-org", slug: "my-proj", name: "My Project" }],
      orgs: [],
    });

    const result = await resolveOrgProjectFromArg("my-proj", CWD, "log list");
    expect(result).toMatchObject({ org: "found-org", project: "my-proj" });
    expect(result.projectData).toBeDefined();
  });

  test("throws ContextError for 'org/' (org-all) string", async () => {
    await expect(
      resolveOrgProjectFromArg("sentry/", CWD, "trace list")
    ).rejects.toThrow(ContextError);
  });

  // Skip: same-file internal call — resolveOrgProjectFromArg → resolveAllTargets
  // biome-ignore lint/suspicious/noSkippedTests: vitest can't intercept same-file internal calls
  test.skip("resolves undefined to auto-detect", async () => {
    resolveOrgAndProjectSpy.mockResolvedValue({
      org: "auto-org",
      project: "auto-proj",
      orgDisplay: "Auto Org",
      projectDisplay: "Auto Project",
    });

    const result = await resolveOrgProjectFromArg(undefined, CWD, "trace list");
    expect(result).toEqual({ org: "auto-org", project: "auto-proj" });
  });
});
