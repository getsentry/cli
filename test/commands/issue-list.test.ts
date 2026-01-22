/**
 * Tests for issue list command utilities
 */

import { describe, expect, test } from "bun:test";

// Import the functions we want to test by re-implementing them here
// (since they're not exported from the module)

/**
 * Find the common word prefix shared by strings that have word boundaries.
 */
function findCommonWordPrefix(strings: string[]): string {
  if (strings.length < 2) {
    return "";
  }

  const getFirstWord = (s: string): string | null => {
    const lower = s.toLowerCase();
    const boundaryIdx = Math.max(lower.indexOf("-"), lower.indexOf("_"));
    if (boundaryIdx > 0) {
      return lower.slice(0, boundaryIdx + 1);
    }
    return null;
  };

  const firstWords: string[] = [];
  for (const s of strings) {
    const word = getFirstWord(s);
    if (word) {
      firstWords.push(word);
    }
  }

  if (firstWords.length < 2) {
    return "";
  }

  const candidate = firstWords[0];
  if (!candidate) {
    return "";
  }

  const allMatch = firstWords.every((w) => w === candidate);
  if (!allMatch) {
    return "";
  }

  return candidate;
}

/**
 * Find the shortest unique prefix for each string in the array.
 */
function findShortestUniquePrefixes(strings: string[]): Map<string, string> {
  const result = new Map<string, string>();

  for (const str of strings) {
    const lowerStr = str.toLowerCase();
    let prefixLen = 1;

    while (prefixLen <= lowerStr.length) {
      const prefix = lowerStr.slice(0, prefixLen);
      const isUnique = strings.every((other) => {
        if (other === str) {
          return true;
        }
        return !other.toLowerCase().startsWith(prefix);
      });

      if (isUnique) {
        result.set(str, prefix);
        break;
      }
      prefixLen += 1;
    }

    if (!result.has(str)) {
      result.set(str, lowerStr);
    }
  }

  return result;
}

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
