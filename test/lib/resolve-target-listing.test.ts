/**
 * Tests for new resolve-target listing functions
 *
 * Tests for resolveOrgsForListing, resolveOrgProjectTarget, and
 * resolveOrgProjectFromArg added in the pagination PR.
 * Uses spyOn to mock dependencies without real HTTP calls.
 */

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as apiClient from "../../src/lib/api-client.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as defaults from "../../src/lib/db/defaults.js";
import { ContextError } from "../../src/lib/errors.js";
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
    getDefaultOrganizationSpy = spyOn(defaults, "getDefaultOrganization");
    resolveAllTargetsSpy = spyOn(resolveTargetModule, "resolveAllTargets");

    getDefaultOrganizationSpy.mockResolvedValue(null);
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
    getDefaultOrganizationSpy.mockResolvedValue("default-org");

    const result = await resolveOrgsForListing(undefined, CWD);
    expect(result.orgs).toEqual(["default-org"]);
  });

  test("returns unique orgs from DSN detection when no default", async () => {
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

  test("propagates footer from DSN detection", async () => {
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

  test("propagates skippedSelfHosted from DSN detection", async () => {
    resolveAllTargetsSpy.mockResolvedValue({
      targets: [{ org: "org-a", project: "proj-1" }],
      skippedSelfHosted: 2,
    });

    const result = await resolveOrgsForListing(undefined, CWD);
    expect(result.skippedSelfHosted).toBe(2);
  });

  test("returns empty orgs and propagates skippedSelfHosted when targets empty but DSNs found", async () => {
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
    findProjectsBySlugSpy = spyOn(apiClient, "findProjectsBySlug");
    resolveOrgAndProjectSpy = spyOn(
      resolveTargetModule,
      "resolveOrgAndProject"
    );
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
    findProjectsBySlugSpy.mockResolvedValue([
      { orgSlug: "found-org", slug: "my-proj", name: "My Project" },
    ]);

    const parsed = { type: "project-search" as const, projectSlug: "my-proj" };

    const result = await resolveOrgProjectTarget(parsed, CWD, "trace list");
    expect(result).toEqual({ org: "found-org", project: "my-proj" });
  });

  test("throws ContextError for project-search when no match", async () => {
    findProjectsBySlugSpy.mockResolvedValue([]);

    const parsed = {
      type: "project-search" as const,
      projectSlug: "nonexistent",
    };

    await expect(
      resolveOrgProjectTarget(parsed, CWD, "trace list")
    ).rejects.toThrow(ContextError);
  });

  test("throws ContextError for project-search when multiple matches", async () => {
    findProjectsBySlugSpy.mockResolvedValue([
      { orgSlug: "org-a", slug: "my-proj", name: "My Project" },
      { orgSlug: "org-b", slug: "my-proj", name: "My Project" },
    ]);

    const parsed = { type: "project-search" as const, projectSlug: "my-proj" };

    await expect(
      resolveOrgProjectTarget(parsed, CWD, "trace list")
    ).rejects.toThrow(ContextError);
  });

  test("resolves auto-detect when DSN detection succeeds", async () => {
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
});

// ---------------------------------------------------------------------------
// resolveOrgProjectFromArg
// ---------------------------------------------------------------------------

describe("resolveOrgProjectFromArg", () => {
  let findProjectsBySlugSpy: ReturnType<typeof spyOn>;
  let resolveOrgAndProjectSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    findProjectsBySlugSpy = spyOn(apiClient, "findProjectsBySlug");
    resolveOrgAndProjectSpy = spyOn(
      resolveTargetModule,
      "resolveOrgAndProject"
    );
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
    findProjectsBySlugSpy.mockResolvedValue([
      { orgSlug: "found-org", slug: "my-proj", name: "My Project" },
    ]);

    const result = await resolveOrgProjectFromArg("my-proj", CWD, "log list");
    expect(result).toEqual({ org: "found-org", project: "my-proj" });
  });

  test("throws ContextError for 'org/' (org-all) string", async () => {
    await expect(
      resolveOrgProjectFromArg("sentry/", CWD, "trace list")
    ).rejects.toThrow(ContextError);
  });

  test("resolves undefined to auto-detect", async () => {
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
