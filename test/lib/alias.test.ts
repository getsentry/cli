/**
 * Tests for alias generation utilities
 */

import { describe, expect, test } from "bun:test";
import {
  buildOrgAwareAliases,
  findCommonWordPrefix,
  findShortestUniquePrefixes,
} from "../../src/lib/alias.js";

describe("findCommonWordPrefix", () => {
  test("finds common prefix with hyphen boundary", () => {
    const result = findCommonWordPrefix([
      "spotlight-electron",
      "spotlight-website",
      "spotlight-mobile",
    ]);
    expect(result).toBe("spotlight-");
  });

  test("finds common prefix with underscore boundary", () => {
    const result = findCommonWordPrefix([
      "my_app_frontend",
      "my_app_backend",
      "my_app_worker",
    ]);
    expect(result).toBe("my_");
  });

  test("handles mix of strings with and without boundaries", () => {
    // spotlight has no boundary, but spotlight-electron and spotlight-website do
    const result = findCommonWordPrefix([
      "spotlight-electron",
      "spotlight-website",
      "spotlight",
    ]);
    expect(result).toBe("spotlight-");
  });

  test("returns empty string when no common prefix", () => {
    const result = findCommonWordPrefix(["frontend", "backend", "worker"]);
    expect(result).toBe("");
  });

  test("returns empty string when strings have different first words", () => {
    const result = findCommonWordPrefix([
      "app-frontend",
      "service-backend",
      "worker-queue",
    ]);
    expect(result).toBe("");
  });

  test("returns empty string for single string", () => {
    const result = findCommonWordPrefix(["spotlight-electron"]);
    expect(result).toBe("");
  });

  test("returns empty string for empty array", () => {
    const result = findCommonWordPrefix([]);
    expect(result).toBe("");
  });

  test("returns empty string when only one string has boundary", () => {
    const result = findCommonWordPrefix(["spotlight-electron", "backend"]);
    expect(result).toBe("");
  });
});

describe("findShortestUniquePrefixes", () => {
  test("finds shortest unique prefixes for distinct strings", () => {
    const result = findShortestUniquePrefixes([
      "frontend",
      "functions",
      "backend",
    ]);
    expect(result.get("frontend")).toBe("fr");
    expect(result.get("functions")).toBe("fu");
    expect(result.get("backend")).toBe("b");
  });

  test("handles single character differences", () => {
    const result = findShortestUniquePrefixes(["electron", "website", "main"]);
    expect(result.get("electron")).toBe("e");
    expect(result.get("website")).toBe("w");
    expect(result.get("main")).toBe("m");
  });

  test("handles strings with common prefixes", () => {
    const result = findShortestUniquePrefixes(["api", "app", "auth"]);
    expect(result.get("api")).toBe("api");
    expect(result.get("app")).toBe("app");
    expect(result.get("auth")).toBe("au");
  });

  test("handles single string", () => {
    const result = findShortestUniquePrefixes(["frontend"]);
    expect(result.get("frontend")).toBe("f");
  });

  test("handles empty array", () => {
    const result = findShortestUniquePrefixes([]);
    expect(result.size).toBe(0);
  });

  test("is case-insensitive", () => {
    const result = findShortestUniquePrefixes(["Frontend", "BACKEND"]);
    expect(result.get("Frontend")).toBe("f");
    expect(result.get("BACKEND")).toBe("b");
  });
});

describe("alias generation integration", () => {
  test("generates short aliases for spotlight projects", () => {
    const projectSlugs = [
      "spotlight-electron",
      "spotlight-website",
      "spotlight",
    ];

    // Strip common prefix
    const commonPrefix = findCommonWordPrefix(projectSlugs);
    expect(commonPrefix).toBe("spotlight-");

    // Create remainders
    const slugToRemainder = new Map<string, string>();
    for (const slug of projectSlugs) {
      const remainder = slug.slice(commonPrefix.length);
      slugToRemainder.set(slug, remainder || slug);
    }

    expect(slugToRemainder.get("spotlight-electron")).toBe("electron");
    expect(slugToRemainder.get("spotlight-website")).toBe("website");
    expect(slugToRemainder.get("spotlight")).toBe("spotlight"); // No prefix to strip

    // Find unique prefixes for remainders
    const remainders = [...slugToRemainder.values()];
    const prefixes = findShortestUniquePrefixes(remainders);

    expect(prefixes.get("electron")).toBe("e");
    expect(prefixes.get("website")).toBe("w");
    expect(prefixes.get("spotlight")).toBe("s");
  });

  test("generates aliases without stripping for unrelated projects", () => {
    const projectSlugs = ["frontend", "backend", "worker"];

    const commonPrefix = findCommonWordPrefix(projectSlugs);
    expect(commonPrefix).toBe("");

    const prefixes = findShortestUniquePrefixes(projectSlugs);
    expect(prefixes.get("frontend")).toBe("f");
    expect(prefixes.get("backend")).toBe("b");
    expect(prefixes.get("worker")).toBe("w");
  });
});

describe("buildOrgAwareAliases", () => {
  test("returns empty map for empty input", () => {
    const result = buildOrgAwareAliases([]);
    expect(result.aliasMap.size).toBe(0);
  });

  test("single org multiple projects - no collision", () => {
    const result = buildOrgAwareAliases([
      { org: "acme", project: "frontend" },
      { org: "acme", project: "backend" },
    ]);
    expect(result.aliasMap.get("acme/frontend")).toBe("f");
    expect(result.aliasMap.get("acme/backend")).toBe("b");
  });

  test("multiple orgs with unique project slugs - no collision", () => {
    const result = buildOrgAwareAliases([
      { org: "org1", project: "frontend" },
      { org: "org2", project: "backend" },
    ]);
    expect(result.aliasMap.get("org1/frontend")).toBe("f");
    expect(result.aliasMap.get("org2/backend")).toBe("b");
  });

  test("same project slug in different orgs - collision", () => {
    const result = buildOrgAwareAliases([
      { org: "org1", project: "dashboard" },
      { org: "org2", project: "dashboard" },
    ]);

    const alias1 = result.aliasMap.get("org1/dashboard");
    const alias2 = result.aliasMap.get("org2/dashboard");

    // Both should have org-prefixed format with slash
    expect(alias1).toContain("/");
    expect(alias2).toContain("/");

    // Must be different aliases
    expect(alias1).not.toBe(alias2);

    // Should follow pattern: orgPrefix/projectPrefix
    expect(alias1).toMatch(/^o.*\/d$/);
    expect(alias2).toMatch(/^o.*\/d$/);
  });

  test("collision with distinct org names", () => {
    const result = buildOrgAwareAliases([
      { org: "acme-corp", project: "api" },
      { org: "bigco", project: "api" },
    ]);

    const alias1 = result.aliasMap.get("acme-corp/api");
    const alias2 = result.aliasMap.get("bigco/api");

    // Org prefixes should be unique: "a" vs "b"
    expect(alias1).toBe("a/a");
    expect(alias2).toBe("b/a");
  });

  test("mixed - some colliding, some unique project slugs", () => {
    const result = buildOrgAwareAliases([
      { org: "org1", project: "dashboard" },
      { org: "org2", project: "dashboard" },
      { org: "org1", project: "backend" },
    ]);

    // dashboard collides → org-prefixed aliases with slash
    const dashAlias1 = result.aliasMap.get("org1/dashboard");
    const dashAlias2 = result.aliasMap.get("org2/dashboard");
    expect(dashAlias1).toContain("/");
    expect(dashAlias2).toContain("/");
    expect(dashAlias1).not.toBe(dashAlias2);

    // backend is unique → simple alias
    const backendAlias = result.aliasMap.get("org1/backend");
    expect(backendAlias).toBe("b");
  });

  test("preserves common word prefix stripping for unique projects", () => {
    const result = buildOrgAwareAliases([
      { org: "acme", project: "spotlight-electron" },
      { org: "acme", project: "spotlight-website" },
    ]);
    // Common prefix "spotlight-" is stripped internally, resulting in short aliases
    expect(result.aliasMap.get("acme/spotlight-electron")).toBe("e");
    expect(result.aliasMap.get("acme/spotlight-website")).toBe("w");
  });

  test("handles single project", () => {
    const result = buildOrgAwareAliases([{ org: "acme", project: "frontend" }]);
    expect(result.aliasMap.get("acme/frontend")).toBe("f");
  });

  test("collision with similar org names uses longer prefixes", () => {
    const result = buildOrgAwareAliases([
      { org: "organization1", project: "app" },
      { org: "organization2", project: "app" },
    ]);

    const alias1 = result.aliasMap.get("organization1/app");
    const alias2 = result.aliasMap.get("organization2/app");

    // Both orgs start with "organization", so prefixes need to be longer
    expect(alias1).not.toBe(alias2);
    // Should include enough of the org to be unique
    expect(alias1).toMatch(/\/a$/); // ends with project prefix
    expect(alias2).toMatch(/\/a$/);
  });

  test("multiple collisions across same orgs", () => {
    const result = buildOrgAwareAliases([
      { org: "org1", project: "api" },
      { org: "org2", project: "api" },
      { org: "org1", project: "web" },
      { org: "org2", project: "web" },
    ]);

    // All four should have org-prefixed aliases with slash
    expect(result.aliasMap.get("org1/api")).toContain("/");
    expect(result.aliasMap.get("org2/api")).toContain("/");
    expect(result.aliasMap.get("org1/web")).toContain("/");
    expect(result.aliasMap.get("org2/web")).toContain("/");

    // All should be unique
    const aliases = [...result.aliasMap.values()];
    const uniqueAliases = new Set(aliases);
    expect(uniqueAliases.size).toBe(aliases.length);
  });

  test("collision with same-letter project slugs uses unique project prefixes", () => {
    // Both "api" and "app" start with "a" - need unique project prefixes
    const result = buildOrgAwareAliases([
      { org: "org1", project: "api" },
      { org: "org2", project: "api" },
      { org: "org1", project: "app" },
      { org: "org2", project: "app" },
    ]);

    // All four should be unique
    const aliases = [...result.aliasMap.values()];
    const uniqueAliases = new Set(aliases);
    expect(uniqueAliases.size).toBe(4);

    // api and app should have different project prefixes (not both "a")
    const org1Api = result.aliasMap.get("org1/api");
    const org1App = result.aliasMap.get("org1/app");
    expect(org1Api).not.toBe(org1App);

    // Project prefixes should distinguish api vs app
    // e.g., "o1/api" vs "o1/app"
    expect(org1Api).toMatch(/^o.*\/api$/);
    expect(org1App).toMatch(/^o.*\/app$/);
  });
});
