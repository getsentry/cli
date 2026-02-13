/**
 * Project Cache Tests
 *
 * Tests for caching project information by orgId:projectId or DSN public key.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { closeDatabase } from "../../../src/lib/db/index.js";
import {
  clearProjectCache,
  getCachedProject,
  getCachedProjectByDsnKey,
  setCachedProject,
  setCachedProjectByDsnKey,
} from "../../../src/lib/db/project-cache.js";
import { cleanupTestDir, createTestConfigDir } from "../../helpers.js";

let testConfigDir: string;
let savedConfigDir: string | undefined;

beforeEach(async () => {
  savedConfigDir = process.env.SENTRY_CONFIG_DIR;
  testConfigDir = await createTestConfigDir("test-project-cache-");
  process.env.SENTRY_CONFIG_DIR = testConfigDir;
});

afterEach(async () => {
  // Close database to release file handles before cleanup
  closeDatabase();
  if (savedConfigDir !== undefined) {
    process.env.SENTRY_CONFIG_DIR = savedConfigDir;
  } else {
    delete process.env.SENTRY_CONFIG_DIR;
  }
  await cleanupTestDir(testConfigDir);
});

describe("getCachedProject", () => {
  test("returns undefined when no cache entry exists", async () => {
    const result = await getCachedProject("org-123", "project-456");
    expect(result).toBeUndefined();
  });

  test("returns cached project when entry exists", async () => {
    await setCachedProject("org-123", "project-456", {
      orgSlug: "my-org",
      orgName: "My Organization",
      projectSlug: "my-project",
      projectName: "My Project",
    });

    const result = await getCachedProject("org-123", "project-456");
    expect(result).toBeDefined();
    expect(result?.orgSlug).toBe("my-org");
    expect(result?.orgName).toBe("My Organization");
    expect(result?.projectSlug).toBe("my-project");
    expect(result?.projectName).toBe("My Project");
    expect(result?.cachedAt).toBeGreaterThan(0);
  });

  test("returns undefined for different orgId", async () => {
    await setCachedProject("org-123", "project-456", {
      orgSlug: "my-org",
      orgName: "My Organization",
      projectSlug: "my-project",
      projectName: "My Project",
    });

    const result = await getCachedProject("org-different", "project-456");
    expect(result).toBeUndefined();
  });

  test("returns undefined for different projectId", async () => {
    await setCachedProject("org-123", "project-456", {
      orgSlug: "my-org",
      orgName: "My Organization",
      projectSlug: "my-project",
      projectName: "My Project",
    });

    const result = await getCachedProject("org-123", "project-different");
    expect(result).toBeUndefined();
  });
});

describe("setCachedProject", () => {
  test("creates new cache entry", async () => {
    await setCachedProject("org-123", "project-456", {
      orgSlug: "my-org",
      orgName: "My Organization",
      projectSlug: "my-project",
      projectName: "My Project",
    });

    const result = await getCachedProject("org-123", "project-456");
    expect(result).toBeDefined();
    expect(result?.orgSlug).toBe("my-org");
  });

  test("updates existing cache entry (upsert)", async () => {
    // Set initial cache
    await setCachedProject("org-123", "project-456", {
      orgSlug: "old-org",
      orgName: "Old Organization",
      projectSlug: "old-project",
      projectName: "Old Project",
    });

    // Update cache
    await setCachedProject("org-123", "project-456", {
      orgSlug: "new-org",
      orgName: "New Organization",
      projectSlug: "new-project",
      projectName: "New Project",
    });

    const result = await getCachedProject("org-123", "project-456");
    expect(result).toBeDefined();
    expect(result?.orgSlug).toBe("new-org");
    expect(result?.orgName).toBe("New Organization");
    expect(result?.projectSlug).toBe("new-project");
    expect(result?.projectName).toBe("New Project");
  });

  test("stores cachedAt timestamp", async () => {
    const before = Date.now();

    await setCachedProject("org-123", "project-456", {
      orgSlug: "my-org",
      orgName: "My Organization",
      projectSlug: "my-project",
      projectName: "My Project",
    });

    const after = Date.now();
    const result = await getCachedProject("org-123", "project-456");

    expect(result?.cachedAt).toBeGreaterThanOrEqual(before);
    expect(result?.cachedAt).toBeLessThanOrEqual(after);
  });

  test("handles multiple distinct cache entries", async () => {
    await setCachedProject("org-1", "project-1", {
      orgSlug: "org-one",
      orgName: "Org One",
      projectSlug: "project-one",
      projectName: "Project One",
    });

    await setCachedProject("org-2", "project-2", {
      orgSlug: "org-two",
      orgName: "Org Two",
      projectSlug: "project-two",
      projectName: "Project Two",
    });

    const result1 = await getCachedProject("org-1", "project-1");
    const result2 = await getCachedProject("org-2", "project-2");

    expect(result1?.orgSlug).toBe("org-one");
    expect(result2?.orgSlug).toBe("org-two");
  });
});

describe("getCachedProjectByDsnKey", () => {
  test("returns undefined when no cache entry exists", async () => {
    const result = await getCachedProjectByDsnKey("abc123publickey");
    expect(result).toBeUndefined();
  });

  test("returns cached project when entry exists", async () => {
    await setCachedProjectByDsnKey("abc123publickey", {
      orgSlug: "dsn-org",
      orgName: "DSN Organization",
      projectSlug: "dsn-project",
      projectName: "DSN Project",
    });

    const result = await getCachedProjectByDsnKey("abc123publickey");
    expect(result).toBeDefined();
    expect(result?.orgSlug).toBe("dsn-org");
    expect(result?.orgName).toBe("DSN Organization");
    expect(result?.projectSlug).toBe("dsn-project");
    expect(result?.projectName).toBe("DSN Project");
    expect(result?.cachedAt).toBeGreaterThan(0);
  });

  test("returns undefined for different public key", async () => {
    await setCachedProjectByDsnKey("abc123publickey", {
      orgSlug: "dsn-org",
      orgName: "DSN Organization",
      projectSlug: "dsn-project",
      projectName: "DSN Project",
    });

    const result = await getCachedProjectByDsnKey("different-key");
    expect(result).toBeUndefined();
  });
});

describe("setCachedProjectByDsnKey", () => {
  test("creates new cache entry", async () => {
    await setCachedProjectByDsnKey("mykey123", {
      orgSlug: "key-org",
      orgName: "Key Organization",
      projectSlug: "key-project",
      projectName: "Key Project",
    });

    const result = await getCachedProjectByDsnKey("mykey123");
    expect(result).toBeDefined();
    expect(result?.orgSlug).toBe("key-org");
  });

  test("updates existing cache entry (upsert)", async () => {
    await setCachedProjectByDsnKey("mykey123", {
      orgSlug: "old-org",
      orgName: "Old Organization",
      projectSlug: "old-project",
      projectName: "Old Project",
    });

    await setCachedProjectByDsnKey("mykey123", {
      orgSlug: "new-org",
      orgName: "New Organization",
      projectSlug: "new-project",
      projectName: "New Project",
    });

    const result = await getCachedProjectByDsnKey("mykey123");
    expect(result?.orgSlug).toBe("new-org");
    expect(result?.orgName).toBe("New Organization");
  });

  test("dsn key cache is separate from orgId:projectId cache", async () => {
    // Cache by orgId:projectId
    await setCachedProject("123", "456", {
      orgSlug: "by-id-org",
      orgName: "By ID Organization",
      projectSlug: "by-id-project",
      projectName: "By ID Project",
    });

    // Cache by DSN key
    await setCachedProjectByDsnKey("publickey", {
      orgSlug: "by-dsn-org",
      orgName: "By DSN Organization",
      projectSlug: "by-dsn-project",
      projectName: "By DSN Project",
    });

    // Both should exist independently
    const byId = await getCachedProject("123", "456");
    const byDsn = await getCachedProjectByDsnKey("publickey");

    expect(byId?.orgSlug).toBe("by-id-org");
    expect(byDsn?.orgSlug).toBe("by-dsn-org");

    // Cross-lookup should fail - keys are in different formats
    // orgId:projectId format -> "123:456"
    // DSN key format -> "dsn:publickey"
    const byIdAsDsn = await getCachedProjectByDsnKey("123:456");
    expect(byIdAsDsn).toBeUndefined();

    // Lookup with wrong key format
    const wrongKey = await getCachedProject("wrong", "key");
    expect(wrongKey).toBeUndefined();
  });
});

describe("clearProjectCache", () => {
  test("clears all cache entries", async () => {
    // Add several entries
    await setCachedProject("org-1", "project-1", {
      orgSlug: "org-one",
      orgName: "Org One",
      projectSlug: "project-one",
      projectName: "Project One",
    });

    await setCachedProject("org-2", "project-2", {
      orgSlug: "org-two",
      orgName: "Org Two",
      projectSlug: "project-two",
      projectName: "Project Two",
    });

    await setCachedProjectByDsnKey("key1", {
      orgSlug: "key-org",
      orgName: "Key Organization",
      projectSlug: "key-project",
      projectName: "Key Project",
    });

    // Clear all
    await clearProjectCache();

    // All should be undefined
    expect(await getCachedProject("org-1", "project-1")).toBeUndefined();
    expect(await getCachedProject("org-2", "project-2")).toBeUndefined();
    expect(await getCachedProjectByDsnKey("key1")).toBeUndefined();
  });

  test("does not throw when cache is already empty", async () => {
    // Should not throw
    await clearProjectCache();
    await clearProjectCache();
  });
});

describe("cache key uniqueness", () => {
  test("different orgId:projectId combinations are stored separately", async () => {
    await setCachedProject("org-A", "project-1", {
      orgSlug: "org-a",
      orgName: "Org A",
      projectSlug: "project-1",
      projectName: "Project 1 in A",
    });

    await setCachedProject("org-B", "project-1", {
      orgSlug: "org-b",
      orgName: "Org B",
      projectSlug: "project-1",
      projectName: "Project 1 in B",
    });

    await setCachedProject("org-A", "project-2", {
      orgSlug: "org-a",
      orgName: "Org A",
      projectSlug: "project-2",
      projectName: "Project 2 in A",
    });

    const resultA1 = await getCachedProject("org-A", "project-1");
    const resultB1 = await getCachedProject("org-B", "project-1");
    const resultA2 = await getCachedProject("org-A", "project-2");

    expect(resultA1?.projectName).toBe("Project 1 in A");
    expect(resultB1?.projectName).toBe("Project 1 in B");
    expect(resultA2?.projectName).toBe("Project 2 in A");
  });

  test("handles special characters in IDs", async () => {
    await setCachedProject("org:with:colons", "project/with/slashes", {
      orgSlug: "special-org",
      orgName: "Special Organization",
      projectSlug: "special-project",
      projectName: "Special Project",
    });

    const result = await getCachedProject(
      "org:with:colons",
      "project/with/slashes"
    );
    expect(result?.orgSlug).toBe("special-org");
  });

  test("handles numeric-like string IDs", async () => {
    await setCachedProject("123", "456", {
      orgSlug: "numeric-org",
      orgName: "Numeric Organization",
      projectSlug: "numeric-project",
      projectName: "Numeric Project",
    });

    const result = await getCachedProject("123", "456");
    expect(result?.orgSlug).toBe("numeric-org");
  });
});
