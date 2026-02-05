/**
 * Tests for resolve-target utilities
 */

import { describe, expect, test } from "bun:test";
import { parseOrgProjectArg } from "../../src/lib/arg-parsing.js";

describe("parseOrgProjectArg", () => {
  test("returns auto-detect for undefined", () => {
    const result = parseOrgProjectArg(undefined);
    expect(result).toEqual({ type: "auto-detect" });
  });

  test("returns auto-detect for empty string", () => {
    const result = parseOrgProjectArg("");
    expect(result).toEqual({ type: "auto-detect" });
  });

  test("returns auto-detect for whitespace-only string", () => {
    const result = parseOrgProjectArg("   ");
    expect(result).toEqual({ type: "auto-detect" });
  });

  test("returns explicit for org/project pattern", () => {
    const result = parseOrgProjectArg("sentry/cli");
    expect(result).toEqual({
      type: "explicit",
      org: "sentry",
      project: "cli",
    });
  });

  test("returns explicit with trimmed whitespace", () => {
    const result = parseOrgProjectArg("  sentry/cli  ");
    expect(result).toEqual({
      type: "explicit",
      org: "sentry",
      project: "cli",
    });
  });

  test("returns org-all for org/ pattern (trailing slash)", () => {
    const result = parseOrgProjectArg("sentry/");
    expect(result).toEqual({
      type: "org-all",
      org: "sentry",
    });
  });

  test("returns org-all for org/ with whitespace", () => {
    const result = parseOrgProjectArg("  my-org/  ");
    expect(result).toEqual({
      type: "org-all",
      org: "my-org",
    });
  });

  test("returns project-search for simple project name", () => {
    const result = parseOrgProjectArg("cli");
    expect(result).toEqual({
      type: "project-search",
      projectSlug: "cli",
    });
  });

  test("returns project-search for project name with hyphens", () => {
    const result = parseOrgProjectArg("my-awesome-project");
    expect(result).toEqual({
      type: "project-search",
      projectSlug: "my-awesome-project",
    });
  });

  test("returns project-search for /project pattern (leading slash)", () => {
    // "/cli" → search for project across all orgs
    const result = parseOrgProjectArg("/cli");
    expect(result).toEqual({ type: "project-search", projectSlug: "cli" });
  });

  test("handles only first slash for patterns with multiple slashes", () => {
    // This is an edge case - "org/proj/extra" should parse as org="org", project="proj/extra"
    const result = parseOrgProjectArg("org/proj/extra");
    expect(result).toEqual({
      type: "explicit",
      org: "org",
      project: "proj/extra",
    });
  });

  test("handles numeric org and project names", () => {
    const result = parseOrgProjectArg("123/456");
    expect(result).toEqual({
      type: "explicit",
      org: "123",
      project: "456",
    });
  });

  test("handles underscore in names", () => {
    const result = parseOrgProjectArg("my_org/my_project");
    expect(result).toEqual({
      type: "explicit",
      org: "my_org",
      project: "my_project",
    });
  });
});

describe("word boundary matching (\\b regex)", () => {
  /**
   * Test the word boundary regex pattern used by findProjectsByPattern.
   * Uses \b which matches:
   * - Start/end of string
   * - Between word char (\w) and non-word char (like "-" or "_")
   */
  function matchesPattern(pattern: string, projectSlug: string): boolean {
    const regex = new RegExp(`\\b${pattern}\\b`, "i");
    return regex.test(projectSlug);
  }

  describe("exact matches", () => {
    test("matches exact slug", () => {
      expect(matchesPattern("cli", "cli")).toBe(true);
      expect(matchesPattern("docs", "docs")).toBe(true);
    });

    test("is case-insensitive", () => {
      expect(matchesPattern("CLI", "cli")).toBe(true);
      expect(matchesPattern("cli", "CLI")).toBe(true);
      expect(matchesPattern("Docs", "docs")).toBe(true);
    });
  });

  describe("directory name in project slug", () => {
    test("matches at start with hyphen boundary", () => {
      expect(matchesPattern("cli", "cli-website")).toBe(true);
      expect(matchesPattern("cli", "cli-backend")).toBe(true);
    });

    test("matches at end with hyphen boundary", () => {
      expect(matchesPattern("cli", "my-cli")).toBe(true);
      expect(matchesPattern("cli", "sentry-cli")).toBe(true);
    });

    test("matches in middle with hyphen boundaries", () => {
      expect(matchesPattern("cli", "my-cli-app")).toBe(true);
    });

    test("does NOT match with underscore (underscore is a word char)", () => {
      // In regex \b, underscore is part of \w (word characters)
      // So \bcli\b does NOT match "cli_utils" because there's no word boundary
      expect(matchesPattern("cli", "cli_utils")).toBe(false);
      expect(matchesPattern("cli", "my_cli")).toBe(false);
      expect(matchesPattern("cli", "my_cli_app")).toBe(false);
    });
  });

  describe("project slug in directory name (bidirectional)", () => {
    /**
     * Bidirectional matching: check if either string contains the other
     * at a word boundary. This is how findProjectsByPattern works.
     */
    function matchesBidirectional(
      dirName: string,
      projectSlug: string
    ): boolean {
      const dirInProject = new RegExp(`\\b${dirName}\\b`, "i");
      const projectInDir = new RegExp(`\\b${projectSlug}\\b`, "i");
      return dirInProject.test(projectSlug) || projectInDir.test(dirName);
    }

    test("matches project slug at start of directory", () => {
      // dir: "docs-site", project: "docs"
      // "docs" is in "docs-site" at word boundary
      expect(matchesBidirectional("docs-site", "docs")).toBe(true);
    });

    test("matches project slug at end of directory", () => {
      // dir: "sentry-docs", project: "docs"
      // "docs" is in "sentry-docs" at word boundary
      expect(matchesBidirectional("sentry-docs", "docs")).toBe(true);
    });

    test("matches project slug in middle of directory", () => {
      // dir: "my-docs-app", project: "docs"
      expect(matchesBidirectional("my-docs-app", "docs")).toBe(true);
    });

    test("does not match partial words", () => {
      // dir: "documentary", project: "docs"
      // "docs" is NOT in "documentary" at word boundary
      expect(matchesBidirectional("documentary", "docs")).toBe(false);
    });
  });

  describe("non-matches", () => {
    test("does not match partial word without boundary", () => {
      expect(matchesPattern("cli", "eclipse")).toBe(false);
      expect(matchesPattern("cli", "clipping")).toBe(false);
      expect(matchesPattern("cli", "publicist")).toBe(false);
    });

    test("does not match different words", () => {
      expect(matchesPattern("cli", "web")).toBe(false);
      expect(matchesPattern("docs", "api")).toBe(false);
    });
  });
});
