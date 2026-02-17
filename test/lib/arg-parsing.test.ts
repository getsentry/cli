/**
 * Argument Parsing Tests
 *
 * Note: Core invariants (return type determination, suffix normalization) are tested
 * via property-based tests in arg-parsing.property.test.ts. These tests focus on
 * error messages and edge cases.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  parseIssueArg,
  parseOrgProjectArg,
} from "../../src/lib/arg-parsing.js";
import { ValidationError } from "../../src/lib/errors.js";

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
