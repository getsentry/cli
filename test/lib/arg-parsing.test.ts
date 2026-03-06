/**
 * Argument Parsing Tests
 *
 * Note: Core invariants (return type determination, suffix normalization) are tested
 * via property-based tests in arg-parsing.property.test.ts. These tests focus on
 * error messages and edge cases.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  detectSwappedViewArgs,
  looksLikeIssueShortId,
  normalizeSlug,
  parseIssueArg,
  parseOrgProjectArg,
} from "../../src/lib/arg-parsing.js";
import { stripDsnOrgPrefix } from "../../src/lib/dsn/index.js";
import { ValidationError } from "../../src/lib/errors.js";

describe("stripDsnOrgPrefix", () => {
  test("strips 'o' prefix from DSN-style org IDs", () => {
    expect(stripDsnOrgPrefix("o1081365")).toBe("1081365");
    expect(stripDsnOrgPrefix("o123")).toBe("123");
    expect(stripDsnOrgPrefix("o0")).toBe("0");
    expect(stripDsnOrgPrefix("o9999999999")).toBe("9999999999");
  });

  test("preserves normal org slugs", () => {
    expect(stripDsnOrgPrefix("sentry")).toBe("sentry");
    expect(stripDsnOrgPrefix("my-org")).toBe("my-org");
    expect(stripDsnOrgPrefix("acme-corp")).toBe("acme-corp");
  });

  test("preserves slugs starting with 'o' that have non-digit chars", () => {
    expect(stripDsnOrgPrefix("organic")).toBe("organic");
    expect(stripDsnOrgPrefix("org-name")).toBe("org-name");
    expect(stripDsnOrgPrefix("o1abc")).toBe("o1abc");
    expect(stripDsnOrgPrefix("open123")).toBe("open123");
  });

  test("preserves pure numeric strings (no 'o' prefix)", () => {
    expect(stripDsnOrgPrefix("1081365")).toBe("1081365");
    expect(stripDsnOrgPrefix("123")).toBe("123");
  });

  test("preserves empty string and 'o' alone", () => {
    expect(stripDsnOrgPrefix("")).toBe("");
    expect(stripDsnOrgPrefix("o")).toBe("o");
  });
});

describe("parseOrgProjectArg", () => {
  // Representative examples for documentation (invariants covered by property tests)
  test("org/project returns explicit", () => {
    expect(parseOrgProjectArg("sentry/cli")).toEqual({
      type: "explicit",
      org: "sentry",
      project: "cli",
    });
  });

  test("handles multi-part project slugs", () => {
    expect(parseOrgProjectArg("sentry/spotlight-electron")).toEqual({
      type: "explicit",
      org: "sentry",
      project: "spotlight-electron",
    });
  });

  // Error case - verify specific message
  test("just slash throws error", () => {
    expect(() => parseOrgProjectArg("/")).toThrow(
      'Invalid format: "/" requires a project slug'
    );
  });

  // Parser preserves DSN-style org identifiers (normalization moved to resolution layer)
  describe("DSN-style org identifiers are preserved", () => {
    test("preserves 'o' prefix in org-all mode", () => {
      expect(parseOrgProjectArg("o1081365/")).toEqual({
        type: "org-all",
        org: "o1081365",
      });
    });

    test("preserves 'o' prefix in explicit mode", () => {
      expect(parseOrgProjectArg("o1081365/myproject")).toEqual({
        type: "explicit",
        org: "o1081365",
        project: "myproject",
      });
    });

    test("preserves normal org slugs", () => {
      expect(parseOrgProjectArg("organic/cli")).toEqual({
        type: "explicit",
        org: "organic",
        project: "cli",
      });
    });

    test("preserves slugs with mixed chars after 'o'", () => {
      expect(parseOrgProjectArg("o1abc/cli")).toEqual({
        type: "explicit",
        org: "o1abc",
        project: "cli",
      });
    });
  });

  // URL integration tests — applySentryUrlContext may set SENTRY_URL as a side effect
  describe("Sentry URL inputs", () => {
    let savedSentryUrl: string | undefined;

    beforeEach(() => {
      savedSentryUrl = process.env.SENTRY_URL;
      delete process.env.SENTRY_URL;
    });

    afterEach(() => {
      if (savedSentryUrl !== undefined) {
        process.env.SENTRY_URL = savedSentryUrl;
      } else {
        delete process.env.SENTRY_URL;
      }
    });

    test("issue URL returns org-all", () => {
      expect(
        parseOrgProjectArg(
          "https://sentry.io/organizations/my-org/issues/12345/"
        )
      ).toEqual({
        type: "org-all",
        org: "my-org",
      });
    });

    test("project settings URL returns explicit", () => {
      expect(
        parseOrgProjectArg(
          "https://sentry.io/settings/my-org/projects/backend/"
        )
      ).toEqual({
        type: "explicit",
        org: "my-org",
        project: "backend",
      });
    });

    test("org-only URL returns org-all", () => {
      expect(
        parseOrgProjectArg("https://sentry.io/organizations/my-org/")
      ).toEqual({
        type: "org-all",
        org: "my-org",
      });
    });

    test("self-hosted URL extracts org", () => {
      expect(
        parseOrgProjectArg(
          "https://sentry.example.com/organizations/acme-corp/issues/99/"
        )
      ).toEqual({
        type: "org-all",
        org: "acme-corp",
      });
    });
  });
});

describe("parseIssueArg", () => {
  // Representative examples for documentation (invariants covered by property tests)
  describe("representative examples", () => {
    test("org/project-suffix returns explicit", () => {
      expect(parseIssueArg("sentry/cli-G")).toEqual({
        type: "explicit",
        org: "sentry",
        project: "cli",
        suffix: "G",
      });
    });

    test("handles multi-part project slugs", () => {
      expect(parseIssueArg("sentry/spotlight-electron-4Y")).toEqual({
        type: "explicit",
        org: "sentry",
        project: "spotlight-electron",
        suffix: "4Y",
      });
    });
  });

  // Error cases - verify specific error messages
  describe("error cases", () => {
    test("org/-suffix throws error", () => {
      expect(() => parseIssueArg("sentry/-G")).toThrow(
        "Cannot use trailing slash before suffix"
      );
    });

    test("-suffix (empty left) throws error", () => {
      expect(() => parseIssueArg("-G")).toThrow(
        "Missing project before suffix"
      );
    });

    test("trailing dash (empty suffix) throws error", () => {
      expect(() => parseIssueArg("cli-")).toThrow("Missing suffix after dash");
    });

    test("org/project with trailing dash (empty suffix) throws error", () => {
      expect(() => parseIssueArg("sentry/cli-")).toThrow(
        "Missing suffix after dash"
      );
    });

    test("org with trailing slash (empty issue ID) throws error", () => {
      expect(() => parseIssueArg("sentry/")).toThrow(
        "Missing issue ID after slash"
      );
    });

    test("just slash throws error", () => {
      expect(() => parseIssueArg("/")).toThrow("Missing issue ID after slash");
    });
  });

  // URL integration tests — applySentryUrlContext may set SENTRY_URL as a side effect
  describe("Sentry URL inputs", () => {
    let savedSentryUrl: string | undefined;

    beforeEach(() => {
      savedSentryUrl = process.env.SENTRY_URL;
      delete process.env.SENTRY_URL;
    });

    afterEach(() => {
      if (savedSentryUrl !== undefined) {
        process.env.SENTRY_URL = savedSentryUrl;
      } else {
        delete process.env.SENTRY_URL;
      }
    });

    test("issue URL with numeric ID returns explicit-org-numeric", () => {
      expect(
        parseIssueArg("https://sentry.io/organizations/my-org/issues/32886/")
      ).toEqual({
        type: "explicit-org-numeric",
        org: "my-org",
        numericId: "32886",
      });
    });

    test("issue URL with short ID returns explicit", () => {
      expect(
        parseIssueArg("https://sentry.io/organizations/my-org/issues/CLI-G/")
      ).toEqual({
        type: "explicit",
        org: "my-org",
        project: "CLI",
        suffix: "G",
      });
    });

    test("issue URL with multi-part short ID returns explicit", () => {
      expect(
        parseIssueArg(
          "https://sentry.io/organizations/my-org/issues/SPOTLIGHT-ELECTRON-4Y/"
        )
      ).toEqual({
        type: "explicit",
        org: "my-org",
        project: "SPOTLIGHT-ELECTRON",
        suffix: "4Y",
      });
    });

    test("self-hosted issue URL with query params", () => {
      expect(
        parseIssueArg(
          "https://sentry.example.com/organizations/acme/issues/32886/?project=2"
        )
      ).toEqual({
        type: "explicit-org-numeric",
        org: "acme",
        numericId: "32886",
      });
    });

    test("event URL extracts issue ID (ignores event part)", () => {
      const result = parseIssueArg(
        "https://sentry.io/organizations/my-org/issues/32886/events/abc123/"
      );
      expect(result).toEqual({
        type: "explicit-org-numeric",
        org: "my-org",
        numericId: "32886",
      });
    });

    test("trace URL throws ValidationError (no issue ID in URL)", () => {
      expect(() =>
        parseIssueArg(
          "https://sentry.io/organizations/my-org/traces/a4d1aae7216b47ff/"
        )
      ).toThrow(ValidationError);
    });

    test("org-only URL throws ValidationError (no issue ID in URL)", () => {
      expect(() =>
        parseIssueArg("https://sentry.io/organizations/my-org/")
      ).toThrow(ValidationError);
    });

    test("project settings URL throws ValidationError (no issue ID in URL)", () => {
      expect(() =>
        parseIssueArg("https://sentry.io/settings/my-org/projects/backend/")
      ).toThrow(ValidationError);
    });

    test("non-issue URL error mentions issue URL format", () => {
      try {
        parseIssueArg("https://sentry.io/organizations/my-org/traces/abc/");
        expect.unreachable("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationError);
        expect((error as ValidationError).message).toContain(
          "does not contain an issue ID"
        );
      }
    });
  });

  // Parser preserves DSN-style org identifiers (normalization moved to resolution layer)
  describe("DSN-style org identifiers are preserved", () => {
    test("preserves 'o' prefix in explicit", () => {
      expect(parseIssueArg("o1081365/CLI-G")).toEqual({
        type: "explicit",
        org: "o1081365",
        project: "CLI",
        suffix: "G",
      });
    });

    test("preserves 'o' prefix in explicit-org-numeric", () => {
      expect(parseIssueArg("o999/123456789")).toEqual({
        type: "explicit-org-numeric",
        org: "o999",
        numericId: "123456789",
      });
    });

    test("preserves 'o' prefix in explicit-org-suffix", () => {
      expect(parseIssueArg("o1081365/G")).toEqual({
        type: "explicit-org-suffix",
        org: "o1081365",
        suffix: "G",
      });
    });

    test("preserves normal org slugs in issue args", () => {
      expect(parseIssueArg("organic/cli-G")).toEqual({
        type: "explicit",
        org: "organic",
        project: "cli",
        suffix: "G",
      });
    });
  });

  // Multi-slash issue args (org/project/suffix)
  describe("multi-slash issue args", () => {
    test("org/project/suffix returns explicit with project and suffix", () => {
      expect(parseIssueArg("org/project/101149101")).toEqual({
        type: "explicit",
        org: "org",
        project: "project",
        suffix: "101149101",
      });
    });

    test("org/project/numeric returns explicit with numeric suffix", () => {
      expect(parseIssueArg("org/project/123456")).toEqual({
        type: "explicit",
        org: "org",
        project: "project",
        suffix: "123456",
      });
    });

    test("org/project/PROJ-G returns explicit with combined suffix", () => {
      expect(parseIssueArg("org/project/PROJ-G")).toEqual({
        type: "explicit",
        org: "org",
        project: "project",
        suffix: "PROJ-G",
      });
    });

    test("org/project/ (trailing slash, empty suffix) throws error", () => {
      expect(() => parseIssueArg("org/project/")).toThrow(
        "Missing project or issue ID segment"
      );
    });

    test("org//suffix (empty project) throws error", () => {
      expect(() => parseIssueArg("org//suffix")).toThrow(
        "Missing project or issue ID segment"
      );
    });
  });

  // Edge cases - document tricky behaviors
  describe("edge cases", () => {
    test("/suffix returns suffix-only", () => {
      // Leading slash with no org - treat as suffix
      expect(parseIssueArg("/G")).toEqual({
        type: "suffix-only",
        suffix: "G",
      });
    });

    test("/project-suffix returns project-search", () => {
      // Leading slash with project and suffix
      expect(parseIssueArg("/cli-G")).toEqual({
        type: "project-search",
        projectSlug: "cli",
        suffix: "G",
      });
    });

    test("/multi-part-project-suffix returns project-search", () => {
      // Leading slash with multi-part project slug
      expect(parseIssueArg("/spotlight-electron-4Y")).toEqual({
        type: "project-search",
        projectSlug: "spotlight-electron",
        suffix: "4Y",
      });
    });
  });
});

describe("normalizeSlug", () => {
  test("replaces underscores with dashes", () => {
    expect(normalizeSlug("selfbase_admin_backend")).toEqual({
      slug: "selfbase-admin-backend",
      normalized: true,
    });
  });

  test("preserves normal slugs (no underscores)", () => {
    expect(normalizeSlug("my-project")).toEqual({
      slug: "my-project",
      normalized: false,
    });
  });

  test("handles multiple underscores", () => {
    expect(normalizeSlug("a_b_c_d")).toEqual({
      slug: "a-b-c-d",
      normalized: true,
    });
  });

  test("handles leading underscore", () => {
    expect(normalizeSlug("_leading")).toEqual({
      slug: "-leading",
      normalized: true,
    });
  });

  test("handles trailing underscore", () => {
    expect(normalizeSlug("trailing_")).toEqual({
      slug: "trailing-",
      normalized: true,
    });
  });

  test("handles empty string", () => {
    expect(normalizeSlug("")).toEqual({
      slug: "",
      normalized: false,
    });
  });
});

describe("looksLikeIssueShortId", () => {
  describe("matches valid issue short IDs", () => {
    test("CAM-82X", () => {
      expect(looksLikeIssueShortId("CAM-82X")).toBe(true);
    });

    test("CLI-G", () => {
      expect(looksLikeIssueShortId("CLI-G")).toBe(true);
    });

    test("SPOTLIGHT-ELECTRON-4Y", () => {
      expect(looksLikeIssueShortId("SPOTLIGHT-ELECTRON-4Y")).toBe(true);
    });

    test("A-1", () => {
      expect(looksLikeIssueShortId("A-1")).toBe(true);
    });

    test("CLI-123", () => {
      expect(looksLikeIssueShortId("CLI-123")).toBe(true);
    });
  });

  describe("rejects non-issue strings", () => {
    test("my-project (lowercase)", () => {
      expect(looksLikeIssueShortId("my-project")).toBe(false);
    });

    test("a9b4ad2c (no dash)", () => {
      expect(looksLikeIssueShortId("a9b4ad2c")).toBe(false);
    });

    test("org/project (has slash)", () => {
      expect(looksLikeIssueShortId("org/project")).toBe(false);
    });

    test("CAM- (trailing dash, empty suffix)", () => {
      expect(looksLikeIssueShortId("CAM-")).toBe(false);
    });

    test("-82X (leading dash)", () => {
      expect(looksLikeIssueShortId("-82X")).toBe(false);
    });

    test("G (single char, no dash)", () => {
      expect(looksLikeIssueShortId("G")).toBe(false);
    });

    test("cam-82x (all lowercase)", () => {
      expect(looksLikeIssueShortId("cam-82x")).toBe(false);
    });

    test("123 (pure numeric)", () => {
      expect(looksLikeIssueShortId("123")).toBe(false);
    });
  });
});

describe("detectSwappedViewArgs", () => {
  test("returns warning when second has slash but first does not (swapped)", () => {
    const result = detectSwappedViewArgs("a9b4ad2c", "mv-software/mvsoftware");
    expect(result).not.toBeNull();
    expect(result).toContain("mv-software/mvsoftware");
    expect(result).toContain("a9b4ad2c");
  });

  test("returns null when first has slash (correct order)", () => {
    expect(
      detectSwappedViewArgs("mv-software/mvsoftware", "a9b4ad2c")
    ).toBeNull();
  });

  test("returns null when neither has slash", () => {
    expect(detectSwappedViewArgs("a9b4ad2c", "deadbeef")).toBeNull();
  });

  test("returns null when both have slashes", () => {
    expect(detectSwappedViewArgs("org/project", "other/thing")).toBeNull();
  });
});

describe("parseOrgProjectArg underscore normalization", () => {
  test("normalizes org slug underscores in explicit mode", () => {
    expect(parseOrgProjectArg("org_name/project")).toEqual({
      type: "explicit",
      org: "org-name",
      project: "project",
      normalized: true,
    });
  });

  test("normalizes project slug underscores in explicit mode", () => {
    expect(parseOrgProjectArg("org/project_name")).toEqual({
      type: "explicit",
      org: "org",
      project: "project-name",
      normalized: true,
    });
  });

  test("normalizes both org and project underscores", () => {
    expect(parseOrgProjectArg("org_name/project_name")).toEqual({
      type: "explicit",
      org: "org-name",
      project: "project-name",
      normalized: true,
    });
  });

  test("normalizes project-search underscores", () => {
    expect(parseOrgProjectArg("selfbase_admin_backend")).toEqual({
      type: "project-search",
      projectSlug: "selfbase-admin-backend",
      normalized: true,
    });
  });

  test("normalized is absent for normal slugs (explicit)", () => {
    const result = parseOrgProjectArg("sentry/cli");
    expect(result.type).toBe("explicit");
    expect(result).not.toHaveProperty("normalized");
  });

  test("normalized is absent for normal slugs (project-search)", () => {
    const result = parseOrgProjectArg("my-project");
    expect(result.type).toBe("project-search");
    expect(result).not.toHaveProperty("normalized");
  });

  test("normalizes org slug underscores in org-all mode", () => {
    expect(parseOrgProjectArg("org_name/")).toEqual({
      type: "org-all",
      org: "org-name",
      normalized: true,
    });
  });
});
