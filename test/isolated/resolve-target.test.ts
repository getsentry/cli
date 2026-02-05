/**
 * Integration tests for resolve-target utilities
 *
 * These tests use mock.module() which affects global module state.
 * They are isolated in a separate directory to run independently
 * and avoid interfering with other test files.
 *
 * Run with: bun test test/isolated
 */

import { beforeEach, describe, expect, mock, test } from "bun:test";

// ============================================================================
// Mock Setup - All dependency modules mocked before importing resolve-target
// ============================================================================

// Mock functions we'll control in tests
const mockGetDefaultOrganization = mock(() => Promise.resolve(null));
const mockGetDefaultProject = mock(() => Promise.resolve(null));
const mockDetectDsn = mock(() => Promise.resolve(null));
const mockDetectAllDsns = mock(() =>
  Promise.resolve({
    primary: null,
    all: [],
    hasMultiple: false,
    fingerprint: "",
  })
);
const mockFindProjectRoot = mock(() =>
  Promise.resolve({
    projectRoot: "/test/project",
    detectedFrom: "package.json",
  })
);
const mockGetDsnSourceDescription = mock(
  () => "SENTRY_DSN environment variable"
);
const mockGetCachedProject = mock(() => Promise.resolve(null));
const mockSetCachedProject = mock(() => Promise.resolve());
const mockGetCachedProjectByDsnKey = mock(() => Promise.resolve(null));
const mockSetCachedProjectByDsnKey = mock(() => Promise.resolve());
const mockGetCachedDsn = mock(() => Promise.resolve(null));
const mockSetCachedDsn = mock(() => Promise.resolve());
const mockGetProject = mock(() =>
  Promise.resolve({ slug: "test", name: "Test" })
);
const mockFindProjectByDsnKey = mock(() => Promise.resolve(null));
const mockFindProjectsByPattern = mock(() => Promise.resolve([]));

// Mock all dependency modules
mock.module("../../src/lib/db/defaults.js", () => ({
  getDefaultOrganization: mockGetDefaultOrganization,
  getDefaultProject: mockGetDefaultProject,
}));

mock.module("../../src/lib/dsn/index.js", () => ({
  detectDsn: mockDetectDsn,
  detectAllDsns: mockDetectAllDsns,
  findProjectRoot: mockFindProjectRoot,
  getDsnSourceDescription: mockGetDsnSourceDescription,
  formatMultipleProjectsFooter: (projects: unknown[]) =>
    (projects as { orgDisplay: string; projectDisplay: string }[]).length > 1
      ? `Found ${(projects as unknown[]).length} projects`
      : "",
}));

mock.module("../../src/lib/db/project-cache.js", () => ({
  getCachedProject: mockGetCachedProject,
  setCachedProject: mockSetCachedProject,
  getCachedProjectByDsnKey: mockGetCachedProjectByDsnKey,
  setCachedProjectByDsnKey: mockSetCachedProjectByDsnKey,
}));

mock.module("../../src/lib/db/dsn-cache.js", () => ({
  getCachedDsn: mockGetCachedDsn,
  setCachedDsn: mockSetCachedDsn,
}));

mock.module("../../src/lib/api-client.js", () => ({
  getProject: mockGetProject,
  findProjectByDsnKey: mockFindProjectByDsnKey,
  findProjectsByPattern: mockFindProjectsByPattern,
}));

import { ContextError } from "../../src/lib/errors.js";
// Now import the module under test (after mocks are set up)
import {
  resolveAllTargets,
  resolveFromDsn,
  resolveOrg,
  resolveOrgAndProject,
} from "../../src/lib/resolve-target.js";

/** Reset all mocks between tests */
function resetAllMocks() {
  mockGetDefaultOrganization.mockReset();
  mockGetDefaultProject.mockReset();
  mockDetectDsn.mockReset();
  mockDetectAllDsns.mockReset();
  mockFindProjectRoot.mockReset();
  mockGetDsnSourceDescription.mockReset();
  mockGetCachedProject.mockReset();
  mockSetCachedProject.mockReset();
  mockGetCachedProjectByDsnKey.mockReset();
  mockSetCachedProjectByDsnKey.mockReset();
  mockGetCachedDsn.mockReset();
  mockSetCachedDsn.mockReset();
  mockGetProject.mockReset();
  mockFindProjectByDsnKey.mockReset();
  mockFindProjectsByPattern.mockReset();

  // Set sensible defaults
  mockGetDefaultOrganization.mockResolvedValue(null);
  mockGetDefaultProject.mockResolvedValue(null);
  mockDetectDsn.mockResolvedValue(null);
  mockDetectAllDsns.mockResolvedValue({
    primary: null,
    all: [],
    hasMultiple: false,
    fingerprint: "",
  });
  mockFindProjectRoot.mockResolvedValue({
    projectRoot: "/test/project",
    detectedFrom: "package.json",
  });
  mockGetDsnSourceDescription.mockReturnValue(
    "SENTRY_DSN environment variable"
  );
  mockGetCachedProject.mockResolvedValue(null);
  mockGetCachedProjectByDsnKey.mockResolvedValue(null);
  mockGetCachedDsn.mockResolvedValue(null);
  mockFindProjectsByPattern.mockResolvedValue([]);
}

// ============================================================================
// resolveOrg Tests
// ============================================================================

describe("resolveOrg", () => {
  beforeEach(() => {
    resetAllMocks();
  });

  test("returns org from CLI flag when provided", async () => {
    const result = await resolveOrg({ org: "my-org", cwd: "/test" });

    expect(result).not.toBeNull();
    expect(result?.org).toBe("my-org");
    // Should not call any other resolution methods
    expect(mockGetDefaultOrganization).not.toHaveBeenCalled();
    expect(mockDetectDsn).not.toHaveBeenCalled();
  });

  test("returns org from config defaults when no CLI flag", async () => {
    mockGetDefaultOrganization.mockResolvedValue("default-org");

    const result = await resolveOrg({ cwd: "/test" });

    expect(result).not.toBeNull();
    expect(result?.org).toBe("default-org");
    expect(mockGetDefaultOrganization).toHaveBeenCalled();
    expect(mockDetectDsn).not.toHaveBeenCalled();
  });

  test("falls back to DSN detection when no flag or defaults", async () => {
    mockGetDefaultOrganization.mockResolvedValue(null);
    mockDetectDsn.mockResolvedValue({
      raw: "https://abc@o123.ingest.sentry.io/456",
      protocol: "https",
      publicKey: "abc",
      host: "o123.ingest.sentry.io",
      projectId: "456",
      orgId: "123",
      source: "env",
    });
    mockGetCachedProject.mockResolvedValue({
      orgSlug: "cached-org",
      orgName: "Cached Organization",
      projectSlug: "project",
      projectName: "Project",
    });

    const result = await resolveOrg({ cwd: "/test" });

    expect(result).not.toBeNull();
    expect(result?.org).toBe("cached-org");
    expect(mockGetDefaultOrganization).toHaveBeenCalled();
    expect(mockDetectDsn).toHaveBeenCalled();
  });

  test("returns numeric orgId when DSN detected but no cache", async () => {
    mockGetDefaultOrganization.mockResolvedValue(null);
    mockDetectDsn.mockResolvedValue({
      raw: "https://abc@o123.ingest.sentry.io/456",
      protocol: "https",
      publicKey: "abc",
      host: "o123.ingest.sentry.io",
      projectId: "456",
      orgId: "123",
      source: "env",
    });
    mockGetCachedProject.mockResolvedValue(null);

    const result = await resolveOrg({ cwd: "/test" });

    expect(result).not.toBeNull();
    expect(result?.org).toBe("123");
  });

  test("returns null when no org found from any source", async () => {
    mockGetDefaultOrganization.mockResolvedValue(null);
    mockDetectDsn.mockResolvedValue(null);

    const result = await resolveOrg({ cwd: "/test" });

    expect(result).toBeNull();
  });

  test("returns null when DSN has no orgId", async () => {
    mockGetDefaultOrganization.mockResolvedValue(null);
    mockDetectDsn.mockResolvedValue({
      raw: "https://abc@sentry.io/456",
      protocol: "https",
      publicKey: "abc",
      host: "sentry.io",
      projectId: "456",
      // No orgId - self-hosted DSN
      source: "env",
    });

    const result = await resolveOrg({ cwd: "/test" });

    expect(result).toBeNull();
  });

  test("returns null when DSN detection throws", async () => {
    mockGetDefaultOrganization.mockResolvedValue(null);
    mockDetectDsn.mockRejectedValue(new Error("Detection failed"));

    const result = await resolveOrg({ cwd: "/test" });

    expect(result).toBeNull();
  });
});

// ============================================================================
// resolveFromDsn Tests
// ============================================================================

describe("resolveFromDsn", () => {
  beforeEach(() => {
    resetAllMocks();
  });

  test("returns null when no DSN detected", async () => {
    mockDetectDsn.mockResolvedValue(null);

    const result = await resolveFromDsn("/test");

    expect(result).toBeNull();
  });

  test("returns null when DSN has no orgId", async () => {
    mockDetectDsn.mockResolvedValue({
      raw: "https://abc@sentry.io/456",
      protocol: "https",
      publicKey: "abc",
      host: "sentry.io",
      projectId: "456",
      source: "env",
    });

    const result = await resolveFromDsn("/test");

    expect(result).toBeNull();
  });

  test("returns null when DSN has no projectId", async () => {
    mockDetectDsn.mockResolvedValue({
      raw: "https://abc@o123.ingest.sentry.io/",
      protocol: "https",
      publicKey: "abc",
      host: "o123.ingest.sentry.io",
      orgId: "123",
      source: "env",
    });

    const result = await resolveFromDsn("/test");

    expect(result).toBeNull();
  });

  test("returns cached project info when available", async () => {
    mockDetectDsn.mockResolvedValue({
      raw: "https://abc@o123.ingest.sentry.io/456",
      protocol: "https",
      publicKey: "abc",
      host: "o123.ingest.sentry.io",
      projectId: "456",
      orgId: "123",
      source: "env",
      sourcePath: "/test/.env",
    });
    mockGetCachedProject.mockResolvedValue({
      orgSlug: "cached-org",
      orgName: "Cached Organization",
      projectSlug: "cached-project",
      projectName: "Cached Project",
    });

    const result = await resolveFromDsn("/test");

    expect(result).not.toBeNull();
    expect(result?.org).toBe("cached-org");
    expect(result?.project).toBe("cached-project");
    expect(result?.orgDisplay).toBe("Cached Organization");
    expect(result?.projectDisplay).toBe("Cached Project");
    expect(mockGetCachedProject).toHaveBeenCalledWith("123", "456");
  });

  test("fetches and caches project info on cache miss", async () => {
    mockDetectDsn.mockResolvedValue({
      raw: "https://abc@o123.ingest.sentry.io/456",
      protocol: "https",
      publicKey: "abc",
      host: "o123.ingest.sentry.io",
      projectId: "456",
      orgId: "123",
      source: "env",
      sourcePath: "/test/.env",
    });
    mockGetCachedProject.mockResolvedValue(null);
    mockGetProject.mockResolvedValue({
      id: "456",
      slug: "fetched-project",
      name: "Fetched Project",
      organization: {
        id: "123",
        slug: "fetched-org",
        name: "Fetched Organization",
      },
    });

    const result = await resolveFromDsn("/test");

    expect(result).not.toBeNull();
    expect(result?.org).toBe("fetched-org");
    expect(result?.project).toBe("fetched-project");
    expect(result?.orgDisplay).toBe("Fetched Organization");
    expect(result?.projectDisplay).toBe("Fetched Project");
    expect(mockSetCachedProject).toHaveBeenCalled();
  });

  test("falls back to numeric IDs when project has no org info", async () => {
    mockDetectDsn.mockResolvedValue({
      raw: "https://abc@o123.ingest.sentry.io/456",
      protocol: "https",
      publicKey: "abc",
      host: "o123.ingest.sentry.io",
      projectId: "456",
      orgId: "123",
      source: "env",
    });
    mockGetCachedProject.mockResolvedValue(null);
    mockGetProject.mockResolvedValue({
      id: "456",
      slug: "project",
      name: "Project Name",
      // No organization field
    });

    const result = await resolveFromDsn("/test");

    // Falls back to using numeric IDs (both org and project)
    expect(result).not.toBeNull();
    expect(result?.org).toBe("123");
    expect(result?.project).toBe("456"); // Uses dsn.projectId, not projectInfo.slug
    expect(result?.projectDisplay).toBe("Project Name");
  });
});

// ============================================================================
// resolveOrgAndProject Tests
// ============================================================================

describe("resolveOrgAndProject", () => {
  beforeEach(() => {
    resetAllMocks();
  });

  test("returns target from CLI flags when both provided", async () => {
    const result = await resolveOrgAndProject({
      org: "my-org",
      project: "my-project",
      cwd: "/test",
    });

    expect(result).not.toBeNull();
    expect(result?.org).toBe("my-org");
    expect(result?.project).toBe("my-project");
    expect(result?.orgDisplay).toBe("my-org");
    expect(result?.projectDisplay).toBe("my-project");
    // Should not call any detection methods
    expect(mockGetDefaultOrganization).not.toHaveBeenCalled();
    expect(mockDetectDsn).not.toHaveBeenCalled();
  });

  test("throws ContextError when only org flag provided", async () => {
    await expect(
      resolveOrgAndProject({ org: "my-org", cwd: "/test" })
    ).rejects.toThrow(ContextError);
  });

  test("throws ContextError when only project flag provided", async () => {
    await expect(
      resolveOrgAndProject({ project: "my-project", cwd: "/test" })
    ).rejects.toThrow(ContextError);
  });

  test("returns target from config defaults when no flags", async () => {
    mockGetDefaultOrganization.mockResolvedValue("default-org");
    mockGetDefaultProject.mockResolvedValue("default-project");

    const result = await resolveOrgAndProject({ cwd: "/test" });

    expect(result).not.toBeNull();
    expect(result?.org).toBe("default-org");
    expect(result?.project).toBe("default-project");
    expect(mockGetDefaultOrganization).toHaveBeenCalled();
    expect(mockGetDefaultProject).toHaveBeenCalled();
  });

  test("falls back to DSN detection when no flags or defaults", async () => {
    mockGetDefaultOrganization.mockResolvedValue(null);
    mockGetDefaultProject.mockResolvedValue(null);
    mockDetectDsn.mockResolvedValue({
      raw: "https://abc@o123.ingest.sentry.io/456",
      protocol: "https",
      publicKey: "abc",
      host: "o123.ingest.sentry.io",
      projectId: "456",
      orgId: "123",
      source: "env",
    });
    mockGetCachedProject.mockResolvedValue({
      orgSlug: "dsn-org",
      orgName: "DSN Org",
      projectSlug: "dsn-project",
      projectName: "DSN Project",
    });

    const result = await resolveOrgAndProject({ cwd: "/test" });

    expect(result).not.toBeNull();
    expect(result?.org).toBe("dsn-org");
    expect(result?.project).toBe("dsn-project");
  });

  test("falls back to directory inference when DSN detection fails", async () => {
    mockGetDefaultOrganization.mockResolvedValue(null);
    mockGetDefaultProject.mockResolvedValue(null);
    mockDetectDsn.mockResolvedValue(null);
    mockFindProjectRoot.mockResolvedValue({
      projectRoot: "/home/user/my-project",
      detectedFrom: "package.json",
    });
    mockFindProjectsByPattern.mockResolvedValue([
      {
        id: "789",
        slug: "my-project",
        name: "My Project",
        orgSlug: "inferred-org",
        organization: { id: "1", slug: "inferred-org", name: "Inferred Org" },
      },
    ]);

    const result = await resolveOrgAndProject({ cwd: "/home/user/my-project" });

    expect(result).not.toBeNull();
    expect(result?.org).toBe("inferred-org");
    expect(result?.project).toBe("my-project");
  });

  test("returns null when no resolution method succeeds", async () => {
    mockGetDefaultOrganization.mockResolvedValue(null);
    mockGetDefaultProject.mockResolvedValue(null);
    mockDetectDsn.mockResolvedValue(null);
    // Short directory name that won't match
    mockFindProjectRoot.mockResolvedValue({
      projectRoot: "/home/user/ab",
      detectedFrom: "package.json",
    });
    mockFindProjectsByPattern.mockResolvedValue([]);

    const result = await resolveOrgAndProject({ cwd: "/home/user/ab" });

    expect(result).toBeNull();
  });
});

// ============================================================================
// resolveAllTargets Tests
// ============================================================================

describe("resolveAllTargets", () => {
  beforeEach(() => {
    resetAllMocks();
  });

  test("returns single target from CLI flags", async () => {
    const result = await resolveAllTargets({
      org: "my-org",
      project: "my-project",
      cwd: "/test",
    });

    expect(result.targets).toHaveLength(1);
    expect(result.targets[0].org).toBe("my-org");
    expect(result.targets[0].project).toBe("my-project");
  });

  test("throws ContextError when only org flag provided", async () => {
    await expect(
      resolveAllTargets({ org: "my-org", cwd: "/test" })
    ).rejects.toThrow(ContextError);
  });

  test("returns single target from config defaults", async () => {
    mockGetDefaultOrganization.mockResolvedValue("default-org");
    mockGetDefaultProject.mockResolvedValue("default-project");

    const result = await resolveAllTargets({ cwd: "/test" });

    expect(result.targets).toHaveLength(1);
    expect(result.targets[0].org).toBe("default-org");
    expect(result.targets[0].project).toBe("default-project");
  });

  test("resolves multiple DSNs in monorepo", async () => {
    mockGetDefaultOrganization.mockResolvedValue(null);
    mockGetDefaultProject.mockResolvedValue(null);
    mockDetectAllDsns.mockResolvedValue({
      primary: {
        raw: "https://abc@o123.ingest.sentry.io/456",
        protocol: "https",
        publicKey: "abc",
        host: "o123.ingest.sentry.io",
        projectId: "456",
        orgId: "123",
        source: "env-file",
        sourcePath: "/test/monorepo/packages/frontend/.env",
      },
      all: [
        {
          raw: "https://abc@o123.ingest.sentry.io/456",
          protocol: "https",
          publicKey: "abc",
          host: "o123.ingest.sentry.io",
          projectId: "456",
          orgId: "123",
          source: "env-file",
          sourcePath: "/test/monorepo/packages/frontend/.env",
        },
        {
          raw: "https://def@o123.ingest.sentry.io/789",
          protocol: "https",
          publicKey: "def",
          host: "o123.ingest.sentry.io",
          projectId: "789",
          orgId: "123",
          source: "env-file",
          sourcePath: "/test/monorepo/packages/backend/.env",
        },
      ],
      hasMultiple: true,
      fingerprint: "abc-def",
    });
    mockGetCachedProject
      .mockResolvedValueOnce({
        orgSlug: "my-org",
        orgName: "My Org",
        projectSlug: "frontend",
        projectName: "Frontend",
      })
      .mockResolvedValueOnce({
        orgSlug: "my-org",
        orgName: "My Org",
        projectSlug: "backend",
        projectName: "Backend",
      });
    mockGetDsnSourceDescription
      .mockReturnValueOnce("packages/frontend/.env")
      .mockReturnValueOnce("packages/backend/.env");

    const result = await resolveAllTargets({ cwd: "/test/monorepo" });

    expect(result.targets).toHaveLength(2);
    expect(result.targets[0].org).toBe("my-org");
    expect(result.targets[0].project).toBe("frontend");
    expect(result.targets[1].org).toBe("my-org");
    expect(result.targets[1].project).toBe("backend");
  });

  test("deduplicates targets with same org+project", async () => {
    mockGetDefaultOrganization.mockResolvedValue(null);
    mockGetDefaultProject.mockResolvedValue(null);
    mockDetectAllDsns.mockResolvedValue({
      primary: {
        raw: "https://abc@o123.ingest.sentry.io/456",
        protocol: "https",
        publicKey: "abc",
        host: "o123.ingest.sentry.io",
        projectId: "456",
        orgId: "123",
        source: "env-file",
        sourcePath: "/test/.env",
      },
      all: [
        {
          raw: "https://abc@o123.ingest.sentry.io/456",
          protocol: "https",
          publicKey: "abc",
          host: "o123.ingest.sentry.io",
          projectId: "456",
          orgId: "123",
          source: "env-file",
          sourcePath: "/test/.env",
        },
        {
          raw: "https://abc@o123.ingest.sentry.io/456",
          protocol: "https",
          publicKey: "abc",
          host: "o123.ingest.sentry.io",
          projectId: "456",
          orgId: "123",
          source: "env",
          // Same DSN from different source
        },
      ],
      hasMultiple: true,
      fingerprint: "abc-abc",
    });
    mockGetCachedProject.mockResolvedValue({
      orgSlug: "my-org",
      orgName: "My Org",
      projectSlug: "my-project",
      projectName: "My Project",
    });

    const result = await resolveAllTargets({ cwd: "/test" });

    // Should be deduplicated to single target
    expect(result.targets).toHaveLength(1);
  });

  test("falls back to directory inference when no DSNs detected", async () => {
    mockGetDefaultOrganization.mockResolvedValue(null);
    mockGetDefaultProject.mockResolvedValue(null);
    mockDetectAllDsns.mockResolvedValue({
      primary: null,
      all: [],
      hasMultiple: false,
      fingerprint: "",
    });
    mockFindProjectRoot.mockResolvedValue({
      projectRoot: "/home/user/my-app",
      detectedFrom: "package.json",
    });
    mockFindProjectsByPattern.mockResolvedValue([
      {
        id: "789",
        slug: "my-app",
        name: "My App",
        orgSlug: "inferred-org",
        organization: { id: "1", slug: "inferred-org", name: "Inferred Org" },
      },
    ]);

    const result = await resolveAllTargets({ cwd: "/home/user/my-app" });

    expect(result.targets).toHaveLength(1);
    expect(result.targets[0].org).toBe("inferred-org");
    expect(result.targets[0].project).toBe("my-app");
  });

  test("returns empty targets when all DSN resolutions fail", async () => {
    mockGetDefaultOrganization.mockResolvedValue(null);
    mockGetDefaultProject.mockResolvedValue(null);
    mockDetectAllDsns.mockResolvedValue({
      primary: {
        raw: "https://abc@o123.ingest.sentry.io/456",
        protocol: "https",
        publicKey: "abc",
        host: "o123.ingest.sentry.io",
        projectId: "456",
        orgId: "123",
        source: "env",
      },
      all: [
        {
          raw: "https://abc@o123.ingest.sentry.io/456",
          protocol: "https",
          publicKey: "abc",
          host: "o123.ingest.sentry.io",
          projectId: "456",
          orgId: "123",
          source: "env",
        },
      ],
      hasMultiple: false,
      fingerprint: "",
    });
    mockGetCachedProject.mockResolvedValue(null);
    // getProject returns null (project not found)
    mockGetProject.mockResolvedValue(null);
    mockFindProjectRoot.mockResolvedValue({
      projectRoot: "/a",
      detectedFrom: "package.json",
    });

    const result = await resolveAllTargets({ cwd: "/test" });

    expect(result.targets).toHaveLength(0);
  });
});
