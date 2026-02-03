/**
 * Argument Parsing Tests
 *
 * Tests for shared parsing utilities in src/lib/arg-parsing.ts
 */

import { describe, expect, test } from "bun:test";
import {
  parseIssueArg,
  parseOrgProjectArg,
} from "../../src/lib/arg-parsing.js";

describe("parseOrgProjectArg", () => {
  test("undefined returns auto-detect", () => {
    expect(parseOrgProjectArg(undefined)).toEqual({ type: "auto-detect" });
  });

  test("empty string returns auto-detect", () => {
    expect(parseOrgProjectArg("")).toEqual({ type: "auto-detect" });
  });

  test("org/project returns explicit", () => {
    expect(parseOrgProjectArg("sentry/cli")).toEqual({
      type: "explicit",
      org: "sentry",
      project: "cli",
    });
  });

  test("org/ returns org-all", () => {
    expect(parseOrgProjectArg("sentry/")).toEqual({
      type: "org-all",
      org: "sentry",
    });
  });

  test("/project returns project-search", () => {
    expect(parseOrgProjectArg("/cli")).toEqual({
      type: "project-search",
      projectSlug: "cli",
    });
  });

  test("project returns project-search", () => {
    expect(parseOrgProjectArg("cli")).toEqual({
      type: "project-search",
      projectSlug: "cli",
    });
  });

  test("handles multi-part project slugs", () => {
    expect(parseOrgProjectArg("sentry/spotlight-electron")).toEqual({
      type: "explicit",
      org: "sentry",
      project: "spotlight-electron",
    });
  });
});

describe("parseIssueArg", () => {
  describe("numeric type", () => {
    test("pure digits returns numeric", () => {
      expect(parseIssueArg("123456789")).toEqual({
        type: "numeric",
        id: "123456789",
      });
    });
  });

  describe("explicit type (org/project-suffix)", () => {
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

    test("normalizes suffix to uppercase", () => {
      expect(parseIssueArg("sentry/cli-g")).toEqual({
        type: "explicit",
        org: "sentry",
        project: "cli",
        suffix: "G",
      });
    });
  });

  describe("explicit-org-suffix type (org/suffix)", () => {
    test("org/suffix returns explicit-org-suffix", () => {
      expect(parseIssueArg("sentry/G")).toEqual({
        type: "explicit-org-suffix",
        org: "sentry",
        suffix: "G",
      });
    });

    test("normalizes suffix to uppercase", () => {
      expect(parseIssueArg("sentry/g")).toEqual({
        type: "explicit-org-suffix",
        org: "sentry",
        suffix: "G",
      });
    });
  });

  describe("explicit-org-numeric type (org/numeric)", () => {
    test("org/numeric returns explicit-org-numeric", () => {
      expect(parseIssueArg("sentry/123456789")).toEqual({
        type: "explicit-org-numeric",
        org: "sentry",
        numericId: "123456789",
      });
    });
  });

  describe("project-search type (project-suffix)", () => {
    test("project-suffix returns project-search", () => {
      expect(parseIssueArg("cli-G")).toEqual({
        type: "project-search",
        projectSlug: "cli",
        suffix: "G",
      });
    });

    test("handles multi-part project slugs", () => {
      expect(parseIssueArg("spotlight-electron-4Y")).toEqual({
        type: "project-search",
        projectSlug: "spotlight-electron",
        suffix: "4Y",
      });
    });

    test("normalizes suffix to uppercase", () => {
      expect(parseIssueArg("cli-g")).toEqual({
        type: "project-search",
        projectSlug: "cli",
        suffix: "G",
      });
    });
  });

  describe("suffix-only type", () => {
    test("single letter returns suffix-only", () => {
      expect(parseIssueArg("G")).toEqual({
        type: "suffix-only",
        suffix: "G",
      });
    });

    test("alphanumeric suffix returns suffix-only", () => {
      expect(parseIssueArg("4Y")).toEqual({
        type: "suffix-only",
        suffix: "4Y",
      });
    });

    test("normalizes suffix to uppercase", () => {
      expect(parseIssueArg("g")).toEqual({
        type: "suffix-only",
        suffix: "G",
      });
    });
  });

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

  describe("edge cases", () => {
    test("/suffix returns suffix-only", () => {
      // Leading slash with no org - treat as suffix
      expect(parseIssueArg("/G")).toEqual({
        type: "suffix-only",
        suffix: "G",
      });
    });
  });
});
