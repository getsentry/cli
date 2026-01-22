/**
 * Tests for alias generation utilities
 */

import { describe, expect, test } from "bun:test";
import {
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
