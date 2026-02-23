/**
 * Tests for resolve-target utilities
 *
 * Property-based and unit tests for pure functions in the resolve-target module.
 * Integration tests for async resolution functions are in e2e tests due to
 * the complexity of mocking module dependencies in Bun's test environment.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { array, constantFrom, assert as fcAssert, property } from "fast-check";

import {
  isValidDirNameForInference,
  resolveAllTargets,
  resolveOrg,
  resolveOrgAndProject,
  resolveOrgsForListing,
} from "../../src/lib/resolve-target.js";

// ============================================================================
// Arbitraries for Property-Based Testing
// ============================================================================

/** Characters valid in directory names (no leading dot) */
const dirNameChars = "abcdefghijklmnopqrstuvwxyz0123456789-_";

/** Generate valid directory names (2+ chars, alphanumeric with hyphens/underscores) */
const validDirNameArb = array(constantFrom(...dirNameChars.split("")), {
  minLength: 2,
  maxLength: 30,
}).map((chars) => chars.join(""));

/** Generate single characters */
const singleCharArb = constantFrom(...dirNameChars.split(""));

// ============================================================================
// Property Tests for isValidDirNameForInference
// ============================================================================

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

// ============================================================================
// Example-Based Tests for Edge Cases and Documentation
// ============================================================================

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
// Environment Variable Resolution (SENTRY_ORG / SENTRY_PROJECT)
//
// These tests call the REAL resolve functions with env vars set.
// When both SENTRY_ORG and SENTRY_PROJECT are provided, the resolve
// functions short-circuit at step 2 and never reach DB/DSN/API calls,
// so no mocking is needed.
// ============================================================================

describe("Environment variable resolution (SENTRY_ORG / SENTRY_PROJECT)", () => {
  beforeEach(() => {
    delete process.env.SENTRY_ORG;
    delete process.env.SENTRY_PROJECT;
  });

  afterEach(() => {
    delete process.env.SENTRY_ORG;
    delete process.env.SENTRY_PROJECT;
  });

  // --- resolveOrg ---

  test("resolveOrg: returns org from SENTRY_ORG", async () => {
    process.env.SENTRY_ORG = "test-org";
    const result = await resolveOrg({ cwd: "/tmp" });
    expect(result?.org).toBe("test-org");
  });

  test("resolveOrg: SENTRY_PROJECT=org/project combo extracts org", async () => {
    process.env.SENTRY_PROJECT = "combo-org/combo-project";
    const result = await resolveOrg({ cwd: "/tmp" });
    expect(result?.org).toBe("combo-org");
  });

  test("resolveOrg: CLI flag takes priority over env var", async () => {
    process.env.SENTRY_ORG = "env-org";
    const result = await resolveOrg({ org: "flag-org", cwd: "/tmp" });
    expect(result?.org).toBe("flag-org");
  });

  // --- resolveOrgAndProject ---

  test("resolveOrgAndProject: returns from SENTRY_ORG + SENTRY_PROJECT", async () => {
    process.env.SENTRY_ORG = "test-org";
    process.env.SENTRY_PROJECT = "test-project";
    const result = await resolveOrgAndProject({ cwd: "/tmp" });
    expect(result?.org).toBe("test-org");
    expect(result?.project).toBe("test-project");
    expect(result?.detectedFrom).toContain("env var");
  });

  test("resolveOrgAndProject: SENTRY_PROJECT combo notation", async () => {
    process.env.SENTRY_PROJECT = "my-org/my-project";
    const result = await resolveOrgAndProject({ cwd: "/tmp" });
    expect(result?.org).toBe("my-org");
    expect(result?.project).toBe("my-project");
    expect(result?.detectedFrom).toContain("SENTRY_PROJECT");
  });

  test("resolveOrgAndProject: env vars override config defaults", async () => {
    process.env.SENTRY_ORG = "env-org";
    process.env.SENTRY_PROJECT = "env-project";
    const result = await resolveOrgAndProject({ cwd: "/tmp" });
    expect(result?.org).toBe("env-org");
    expect(result?.project).toBe("env-project");
  });

  test("resolveOrgAndProject: CLI flags override env vars", async () => {
    process.env.SENTRY_ORG = "env-org";
    process.env.SENTRY_PROJECT = "env-project";
    const result = await resolveOrgAndProject({
      org: "flag-org",
      project: "flag-project",
      cwd: "/tmp",
    });
    expect(result?.org).toBe("flag-org");
    expect(result?.project).toBe("flag-project");
  });

  test("resolveOrgAndProject: ignores empty/whitespace-only values", async () => {
    process.env.SENTRY_ORG = "  ";
    process.env.SENTRY_PROJECT = "";
    // Both empty after trim — should not use env vars
    // This will fall through and return null since /tmp has no DSN
    const result = await resolveOrgAndProject({ cwd: "/tmp" });
    // Should return null or a result that's not from env vars
    if (result) {
      expect(result.detectedFrom ?? "").not.toContain("env var");
    }
  });

  test("resolveOrgAndProject: SENTRY_ORG alone not enough for org+project", async () => {
    process.env.SENTRY_ORG = "my-org";
    // No SENTRY_PROJECT — resolveFromEnvVars returns org-only
    // resolveOrgAndProject needs project, so env vars don't satisfy it
    const result = await resolveOrgAndProject({ cwd: "/tmp" });
    // If result exists (from DSN or dir inference), it should not claim env var source
    if (result) {
      expect(result.detectedFrom ?? "").not.toContain("SENTRY_ORG env var");
    }
  });

  test("resolveOrgAndProject: trailing slash in combo is ignored (no project)", async () => {
    process.env.SENTRY_PROJECT = "my-org/";
    process.env.SENTRY_ORG = "other-org";
    // Malformed combo — slash present but empty project
    // Should fall through; SENTRY_ORG provides org-only
    const result = await resolveOrgAndProject({ cwd: "/tmp" });
    // No project from env vars, so result should not have env-var detectedFrom
    if (result) {
      expect(result.project).not.toContain("/");
    }
  });

  // --- resolveAllTargets ---

  test("resolveAllTargets: returns target from SENTRY_ORG + SENTRY_PROJECT", async () => {
    process.env.SENTRY_ORG = "test-org";
    process.env.SENTRY_PROJECT = "test-project";
    const result = await resolveAllTargets({ cwd: "/tmp" });
    expect(result.targets).toHaveLength(1);
    expect(result.targets[0]?.org).toBe("test-org");
    expect(result.targets[0]?.project).toBe("test-project");
  });

  test("resolveAllTargets: env vars override config defaults", async () => {
    process.env.SENTRY_ORG = "env-org";
    process.env.SENTRY_PROJECT = "env-project";
    const result = await resolveAllTargets({ cwd: "/tmp" });
    expect(result.targets[0]?.org).toBe("env-org");
  });

  test("resolveAllTargets: CLI flags override env vars", async () => {
    process.env.SENTRY_ORG = "env-org";
    process.env.SENTRY_PROJECT = "env-project";
    const result = await resolveAllTargets({
      org: "flag-org",
      project: "flag-project",
      cwd: "/tmp",
    });
    expect(result.targets[0]?.org).toBe("flag-org");
  });

  // --- resolveOrgsForListing ---

  test("resolveOrgsForListing: returns org from env vars when no flag/defaults", async () => {
    process.env.SENTRY_ORG = "env-org";
    const result = await resolveOrgsForListing(undefined, "/tmp");
    expect(result.orgs).toContain("env-org");
  });
});
