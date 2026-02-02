/**
 * Tests for resolve-target utilities
 */

import { describe, expect, test } from "bun:test";
import { parseOrgProjectArg } from "../../src/lib/resolve-target.js";

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

  test("returns auto-detect for /project pattern (no org)", () => {
    // "/cli" is invalid - no org specified before the slash
    const result = parseOrgProjectArg("/cli");
    expect(result).toEqual({ type: "auto-detect" });
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
