/**
 * Tests for resolve-target utilities
 *
 * Includes property-based tests for pure functions and unit tests for
 * async resolution functions with mocked dependencies.
 */

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { array, constantFrom, assert as fcAssert, property } from "fast-check";

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

import { AuthError, ContextError } from "../../src/lib/errors.js";
// Now import the module under test (after mocks are set up)
import {
  isValidDirNameForInference,
  resolveAllTargets,
  resolveFromDsn,
  resolveOrg,
  resolveOrgAndProject,
} from "../../src/lib/resolve-target.js";

// Helper to reset all mocks between tests
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

// Arbitraries

/** Characters valid in directory names (no leading dot) */
const dirNameChars = "abcdefghijklmnopqrstuvwxyz0123456789-_";

/** Generate valid directory names (2+ chars, alphanumeric with hyphens/underscores) */
const validDirNameArb = array(constantFrom(...dirNameChars.split("")), {
  minLength: 2,
  maxLength: 30,
}).map((chars) => chars.join(""));

/** Generate single characters */
const singleCharArb = constantFrom(...dirNameChars.split(""));

// Property tests

describe("property: isValidDirNameForInference", () => {
  test("rejects empty string", () => {
    expect(isValidDirNameForInference("")).toBe(false);
  });

  test("rejects single characters", () => {
    fcAssert(
      property(singleCharArb, (char) => {
        expect(isValidDirNameForInference(char)).toBe(false);
      }),
      { numRuns: 50 }
    );
  });

  test("rejects names starting with dot (hidden directories)", () => {
    fcAssert(
      property(validDirNameArb, (suffix) => {
        // .anything should be rejected - hidden directories are not valid
        const name = `.${suffix}`;
        expect(isValidDirNameForInference(name)).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  test("accepts valid directory names (2+ chars, not starting with dot)", () => {
    fcAssert(
      property(validDirNameArb, (name) => {
        // Valid names with 2+ chars that don't start with dot should be accepted
        expect(isValidDirNameForInference(name)).toBe(true);
      }),
      { numRuns: 100 }
    );
  });
});

// Example-based tests for edge cases and documentation

describe("isValidDirNameForInference edge cases", () => {
  test("real-world valid names", () => {
    expect(isValidDirNameForInference("cli")).toBe(true);
    expect(isValidDirNameForInference("my-project")).toBe(true);
    expect(isValidDirNameForInference("sentry-cli")).toBe(true);
    expect(isValidDirNameForInference("frontend")).toBe(true);
    expect(isValidDirNameForInference("my_app")).toBe(true);
  });

  test("hidden directories are rejected", () => {
    expect(isValidDirNameForInference(".env")).toBe(false);
    expect(isValidDirNameForInference(".git")).toBe(false);
    expect(isValidDirNameForInference(".config")).toBe(false);
    expect(isValidDirNameForInference(".")).toBe(false);
    expect(isValidDirNameForInference("..")).toBe(false);
  });

  test("two-character names are the minimum", () => {
    expect(isValidDirNameForInference("ab")).toBe(true);
    expect(isValidDirNameForInference("a1")).toBe(true);
    expect(isValidDirNameForInference("--")).toBe(true);
  });
});

// ============================================================================
// Phase 1: Simple Functions (resolveOrg, resolveFromDsn)
// ============================================================================

describe("resolveOrg", () => {
  beforeEach(() => {
    resetAllMocks();
  });

  test("returns org from CLI flag when provided", async () => {
    const result = await resolveOrg({ org: "my-org", cwd: "/test" });

    expect(result).toEqual({ org: "my-org" });
    // Should not call any other resolution methods
    expect(mockGetDefaultOrganization).not.toHaveBeenCalled();
    expect(mockDetectDsn).not.toHaveBeenCalled();
  });

  test("returns org from config defaults when no CLI flag", async () => {
    mockGetDefaultOrganization.mockResolvedValue("default-org");

    const result = await resolveOrg({ cwd: "/test" });

    expect(result).toEqual({ org: "default-org" });
    expect(mockGetDefaultOrganization).toHaveBeenCalled();
    expect(mockDetectDsn).not.toHaveBeenCalled();
  });

  test("falls back to DSN detection when no flag or defaults", async () => {
    mockGetDefaultOrganization.mockResolvedValue(null);
    mockDetectDsn.mockResolvedValue({
      raw: "https://key@o123.ingest.sentry.io/456",
      protocol: "https",
      publicKey: "key",
      host: "o123.ingest.sentry.io",
      projectId: "456",
      orgId: "123",
      source: "env",
    });
    mockGetCachedProject.mockResolvedValue({
      orgSlug: "detected-org",
      orgName: "Detected Org",
      projectSlug: "project",
      projectName: "Project",
    });

    const result = await resolveOrg({ cwd: "/test" });

    expect(result).toEqual({
      org: "detected-org",
      detectedFrom: "SENTRY_DSN environment variable",
    });
  });

  test("returns numeric orgId when DSN detected but no cache", async () => {
    mockGetDefaultOrganization.mockResolvedValue(null);
    mockDetectDsn.mockResolvedValue({
      raw: "https://key@o123.ingest.sentry.io/456",
      protocol: "https",
      publicKey: "key",
      host: "o123.ingest.sentry.io",
      projectId: "456",
      orgId: "123",
      source: "env",
    });
    mockGetCachedProject.mockResolvedValue(null);

    const result = await resolveOrg({ cwd: "/test" });

    expect(result).toEqual({
      org: "123",
      detectedFrom: "SENTRY_DSN environment variable",
    });
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
      raw: "https://key@sentry.io/456",
      protocol: "https",
      publicKey: "key",
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
      raw: "https://key@sentry.io/456",
      protocol: "https",
      publicKey: "key",
      host: "sentry.io",
      projectId: "456",
      source: "env",
    });

    const result = await resolveFromDsn("/test");

    expect(result).toBeNull();
  });

  test("returns null when DSN has no projectId", async () => {
    mockDetectDsn.mockResolvedValue({
      raw: "https://key@o123.ingest.sentry.io/",
      protocol: "https",
      publicKey: "key",
      host: "o123.ingest.sentry.io",
      orgId: "123",
      source: "env",
    });

    const result = await resolveFromDsn("/test");

    expect(result).toBeNull();
  });

  test("returns cached project info when available", async () => {
    mockDetectDsn.mockResolvedValue({
      raw: "https://key@o123.ingest.sentry.io/456",
      protocol: "https",
      publicKey: "key",
      host: "o123.ingest.sentry.io",
      projectId: "456",
      orgId: "123",
      source: "env_file",
      sourcePath: ".env.local",
    });
    mockGetDsnSourceDescription.mockReturnValue(".env.local");
    mockGetCachedProject.mockResolvedValue({
      orgSlug: "cached-org",
      orgName: "Cached Organization",
      projectSlug: "cached-project",
      projectName: "Cached Project",
    });

    const result = await resolveFromDsn("/test");

    expect(result).toEqual({
      org: "cached-org",
      project: "cached-project",
      orgDisplay: "Cached Organization",
      projectDisplay: "Cached Project",
      detectedFrom: ".env.local",
    });
    // Should not call API when cache hit
    expect(mockGetProject).not.toHaveBeenCalled();
  });

  test("fetches and caches project info on cache miss", async () => {
    mockDetectDsn.mockResolvedValue({
      raw: "https://key@o123.ingest.sentry.io/456",
      protocol: "https",
      publicKey: "key",
      host: "o123.ingest.sentry.io",
      projectId: "456",
      orgId: "123",
      source: "code",
      sourcePath: "src/sentry.ts",
    });
    mockGetDsnSourceDescription.mockReturnValue("src/sentry.ts");
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

    expect(result).toEqual({
      org: "fetched-org",
      project: "fetched-project",
      orgDisplay: "Fetched Organization",
      projectDisplay: "Fetched Project",
      detectedFrom: "src/sentry.ts",
    });
    // Should cache the fetched data
    expect(mockSetCachedProject).toHaveBeenCalledWith("123", "456", {
      orgSlug: "fetched-org",
      orgName: "Fetched Organization",
      projectSlug: "fetched-project",
      projectName: "Fetched Project",
    });
  });

  test("falls back to numeric IDs when project has no org info", async () => {
    mockDetectDsn.mockResolvedValue({
      raw: "https://key@o123.ingest.sentry.io/456",
      protocol: "https",
      publicKey: "key",
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

    expect(result).toEqual({
      org: "123",
      project: "456",
      orgDisplay: "123",
      projectDisplay: "Project Name",
      detectedFrom: "SENTRY_DSN environment variable",
    });
  });
});

// ============================================================================
// Phase 2: Core Resolution (resolveOrgAndProject)
// ============================================================================

describe("resolveOrgAndProject", () => {
  beforeEach(() => {
    resetAllMocks();
  });

  test("returns target from CLI flags when both provided", async () => {
    const result = await resolveOrgAndProject({
      org: "cli-org",
      project: "cli-project",
      cwd: "/test",
    });

    expect(result).toEqual({
      org: "cli-org",
      project: "cli-project",
      orgDisplay: "cli-org",
      projectDisplay: "cli-project",
    });
    // Should not call any resolution methods
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

    expect(result).toEqual({
      org: "default-org",
      project: "default-project",
      orgDisplay: "default-org",
      projectDisplay: "default-project",
    });
  });

  test("falls back to DSN detection when no flags or defaults", async () => {
    mockGetDefaultOrganization.mockResolvedValue(null);
    mockGetDefaultProject.mockResolvedValue(null);
    mockDetectDsn.mockResolvedValue({
      raw: "https://key@o123.ingest.sentry.io/456",
      protocol: "https",
      publicKey: "key",
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

    expect(result).toEqual({
      org: "dsn-org",
      project: "dsn-project",
      orgDisplay: "DSN Org",
      projectDisplay: "DSN Project",
      detectedFrom: "SENTRY_DSN environment variable",
    });
  });

  test("falls back to directory inference when DSN detection fails", async () => {
    mockGetDefaultOrganization.mockResolvedValue(null);
    mockGetDefaultProject.mockResolvedValue(null);
    mockDetectDsn.mockResolvedValue(null);
    mockFindProjectRoot.mockResolvedValue({
      projectRoot: "/home/user/my-project",
      detectedFrom: "package.json",
    });
    mockGetCachedDsn.mockResolvedValue(null);
    mockFindProjectsByPattern.mockResolvedValue([
      {
        id: "100",
        slug: "my-project",
        name: "My Project",
        orgSlug: "inferred-org",
        organization: { id: "1", slug: "inferred-org", name: "Inferred Org" },
      },
    ]);

    const result = await resolveOrgAndProject({ cwd: "/home/user/my-project" });

    expect(result).toEqual({
      org: "inferred-org",
      project: "my-project",
      orgDisplay: "Inferred Org",
      projectDisplay: "My Project",
      detectedFrom: 'directory name "my-project"',
    });
  });

  test("returns null when no resolution method succeeds", async () => {
    mockGetDefaultOrganization.mockResolvedValue(null);
    mockGetDefaultProject.mockResolvedValue(null);
    mockDetectDsn.mockResolvedValue(null);
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
// Phase 3: Complex Multi-Path (resolveAllTargets)
// ============================================================================

describe("resolveAllTargets", () => {
  beforeEach(() => {
    resetAllMocks();
  });

  test("returns single target from CLI flags", async () => {
    const result = await resolveAllTargets({
      org: "cli-org",
      project: "cli-project",
      cwd: "/test",
    });

    expect(result).toEqual({
      targets: [
        {
          org: "cli-org",
          project: "cli-project",
          orgDisplay: "cli-org",
          projectDisplay: "cli-project",
        },
      ],
    });
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

    expect(result).toEqual({
      targets: [
        {
          org: "default-org",
          project: "default-project",
          orgDisplay: "default-org",
          projectDisplay: "default-project",
        },
      ],
    });
  });

  test("resolves multiple DSNs in monorepo", async () => {
    mockGetDefaultOrganization.mockResolvedValue(null);
    mockGetDefaultProject.mockResolvedValue(null);
    mockDetectAllDsns.mockResolvedValue({
      primary: {
        raw: "https://key1@o123.ingest.sentry.io/100",
        publicKey: "key1",
        host: "o123.ingest.sentry.io",
        projectId: "100",
        orgId: "123",
        source: "env_file",
        sourcePath: "packages/frontend/.env",
        packagePath: "packages/frontend",
      },
      all: [
        {
          raw: "https://key1@o123.ingest.sentry.io/100",
          publicKey: "key1",
          host: "o123.ingest.sentry.io",
          projectId: "100",
          orgId: "123",
          source: "env_file",
          sourcePath: "packages/frontend/.env",
          packagePath: "packages/frontend",
        },
        {
          raw: "https://key2@o123.ingest.sentry.io/200",
          publicKey: "key2",
          host: "o123.ingest.sentry.io",
          projectId: "200",
          orgId: "123",
          source: "env_file",
          sourcePath: "packages/backend/.env",
          packagePath: "packages/backend",
        },
      ],
      hasMultiple: true,
      fingerprint: "123:100,123:200",
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
    expect(result.targets[0]).toEqual({
      org: "my-org",
      project: "frontend",
      orgDisplay: "My Org",
      projectDisplay: "Frontend",
      detectedFrom: "packages/frontend/.env",
      packagePath: "packages/frontend",
    });
    expect(result.targets[1]).toEqual({
      org: "my-org",
      project: "backend",
      orgDisplay: "My Org",
      projectDisplay: "Backend",
      detectedFrom: "packages/backend/.env",
      packagePath: "packages/backend",
    });
    expect(result.footer).toContain("Found 2 projects");
  });

  test("deduplicates targets with same org+project", async () => {
    mockGetDefaultOrganization.mockResolvedValue(null);
    mockGetDefaultProject.mockResolvedValue(null);
    mockDetectAllDsns.mockResolvedValue({
      primary: null,
      all: [
        {
          raw: "https://key1@o123.ingest.sentry.io/100",
          publicKey: "key1",
          host: "o123.ingest.sentry.io",
          projectId: "100",
          orgId: "123",
          source: "env",
        },
        {
          raw: "https://key2@o123.ingest.sentry.io/100", // Same project, different key
          publicKey: "key2",
          host: "o123.ingest.sentry.io",
          projectId: "100",
          orgId: "123",
          source: "code",
        },
      ],
      hasMultiple: true,
      fingerprint: "",
    });
    mockGetCachedProject.mockResolvedValue({
      orgSlug: "my-org",
      orgName: "My Org",
      projectSlug: "my-project",
      projectName: "My Project",
    });

    const result = await resolveAllTargets({ cwd: "/test" });

    // Should only have one target due to deduplication
    expect(result.targets).toHaveLength(1);
    expect(result.footer).toBeUndefined(); // No footer for single target
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
    mockGetCachedDsn.mockResolvedValue(null);
    mockFindProjectsByPattern.mockResolvedValue([
      {
        id: "100",
        slug: "my-app",
        name: "My App",
        orgSlug: "inferred-org",
        organization: { id: "1", slug: "inferred-org", name: "Inferred Org" },
      },
    ]);

    const result = await resolveAllTargets({ cwd: "/home/user/my-app" });

    expect(result.targets).toHaveLength(1);
    expect(result.targets[0]).toMatchObject({
      org: "inferred-org",
      project: "my-app",
    });
  });

  test("returns empty targets when all DSN resolutions fail", async () => {
    mockGetDefaultOrganization.mockResolvedValue(null);
    mockGetDefaultProject.mockResolvedValue(null);
    mockDetectAllDsns.mockResolvedValue({
      primary: null,
      all: [
        {
          raw: "https://key@sentry.io/456", // Self-hosted, no orgId
          publicKey: "key",
          host: "sentry.io",
          projectId: "456",
          source: "env",
        },
      ],
      hasMultiple: false,
      fingerprint: "",
    });
    mockFindProjectByDsnKey.mockResolvedValue(null);

    const result = await resolveAllTargets({ cwd: "/test" });

    expect(result.targets).toEqual([]);
    expect(result.skippedSelfHosted).toBe(1);
  });

  test("propagates AuthError from DSN resolution", async () => {
    mockGetDefaultOrganization.mockResolvedValue(null);
    mockGetDefaultProject.mockResolvedValue(null);
    mockDetectAllDsns.mockResolvedValue({
      primary: null,
      all: [
        {
          raw: "https://key@o123.ingest.sentry.io/456",
          publicKey: "key",
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
    mockGetProject.mockRejectedValue(new AuthError("not_authenticated"));

    await expect(resolveAllTargets({ cwd: "/test" })).rejects.toThrow(
      AuthError
    );
  });
});
