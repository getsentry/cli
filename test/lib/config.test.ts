/**
 * Configuration Management Tests
 *
 * Integration tests for config file read/write operations.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  CONFIG_DIR_ENV_VAR,
  clearAuth,
  clearProjectAliases,
  clearProjectCache,
  getAuthToken,
  getCachedProject,
  getCachedProjectByDsnKey,
  getConfigPath,
  getDefaultOrganization,
  getDefaultProject,
  getProjectAliases,
  getProjectByAlias,
  isAuthenticated,
  readConfig,
  setAuthToken,
  setCachedProject,
  setCachedProjectByDsnKey,
  setDefaults,
  setProjectAliases,
  writeConfig,
} from "../../src/lib/config.js";

// Each test gets its own config directory
let testConfigDir: string;

beforeEach(() => {
  testConfigDir = join(
    process.env[CONFIG_DIR_ENV_VAR]!,
    `test-${Math.random().toString(36).slice(2)}`
  );
  mkdirSync(testConfigDir, { recursive: true });
  process.env[CONFIG_DIR_ENV_VAR] = testConfigDir;
});

afterEach(() => {
  try {
    rmSync(testConfigDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
});

describe("readConfig", () => {
  test("returns empty object when no config file exists", async () => {
    const config = await readConfig();
    expect(config).toEqual({});
  });

  test("reads existing config file", async () => {
    const configPath = join(testConfigDir, "config.json");
    writeFileSync(
      configPath,
      JSON.stringify({
        auth: { token: "test-token" },
        defaults: { organization: "test-org" },
      })
    );

    const config = await readConfig();
    expect(config.auth?.token).toBe("test-token");
    expect(config.defaults?.organization).toBe("test-org");
  });

  test("returns empty object for invalid JSON", async () => {
    const configPath = join(testConfigDir, "config.json");
    writeFileSync(configPath, "not valid json {{{");

    const config = await readConfig();
    expect(config).toEqual({});
  });

  test("returns empty object for invalid schema", async () => {
    const configPath = join(testConfigDir, "config.json");
    writeFileSync(
      configPath,
      JSON.stringify({
        auth: { token: 12_345 }, // token should be string
      })
    );

    const config = await readConfig();
    expect(config).toEqual({});
  });
});

describe("writeConfig", () => {
  test("writes config file", async () => {
    await writeConfig({
      auth: { token: "my-token" },
    });

    const config = await readConfig();
    expect(config.auth?.token).toBe("my-token");
  });

  test("overwrites existing config", async () => {
    await writeConfig({ auth: { token: "first" } });
    await writeConfig({ auth: { token: "second" } });

    const config = await readConfig();
    expect(config.auth?.token).toBe("second");
  });
});

describe("auth token management", () => {
  test("setAuthToken stores token", async () => {
    await setAuthToken("test-token-123");

    const token = await getAuthToken();
    expect(token).toBe("test-token-123");
  });

  test("setAuthToken with expiration sets expiresAt", async () => {
    const before = Date.now();
    await setAuthToken("expiring-token", 3600); // 1 hour
    const after = Date.now();

    const config = await readConfig();
    expect(config.auth?.expiresAt).toBeGreaterThanOrEqual(before + 3600 * 1000);
    expect(config.auth?.expiresAt).toBeLessThanOrEqual(after + 3600 * 1000);
  });

  test("setAuthToken stores refresh token", async () => {
    await setAuthToken("access-token", 3600, "refresh-token");

    const config = await readConfig();
    expect(config.auth?.refreshToken).toBe("refresh-token");
  });

  test("getAuthToken returns undefined for expired token", async () => {
    // Set a token that expired 1 second ago
    await writeConfig({
      auth: {
        token: "expired-token",
        expiresAt: Date.now() - 1000,
      },
    });

    const token = await getAuthToken();
    expect(token).toBeUndefined();
  });

  test("getAuthToken returns token if not expired", async () => {
    // Set a token that expires in 1 hour
    await writeConfig({
      auth: {
        token: "valid-token",
        expiresAt: Date.now() + 3600 * 1000,
      },
    });

    const token = await getAuthToken();
    expect(token).toBe("valid-token");
  });

  test("clearAuth removes auth data", async () => {
    await setAuthToken("token-to-clear");
    expect(await getAuthToken()).toBe("token-to-clear");

    await clearAuth();
    expect(await getAuthToken()).toBeUndefined();
  });

  test("isAuthenticated returns true with valid token", async () => {
    await setAuthToken("valid-token");
    expect(await isAuthenticated()).toBe(true);
  });

  test("isAuthenticated returns false without token", async () => {
    expect(await isAuthenticated()).toBe(false);
  });

  test("isAuthenticated returns false with expired token", async () => {
    await writeConfig({
      auth: {
        token: "expired",
        expiresAt: Date.now() - 1000,
      },
    });

    expect(await isAuthenticated()).toBe(false);
  });
});

describe("defaults management", () => {
  test("setDefaults stores organization", async () => {
    await setDefaults("my-org");

    const org = await getDefaultOrganization();
    expect(org).toBe("my-org");
  });

  test("setDefaults stores project", async () => {
    await setDefaults(undefined, "my-project");

    const project = await getDefaultProject();
    expect(project).toBe("my-project");
  });

  test("setDefaults stores both org and project", async () => {
    await setDefaults("my-org", "my-project");

    expect(await getDefaultOrganization()).toBe("my-org");
    expect(await getDefaultProject()).toBe("my-project");
  });

  test("setDefaults preserves existing defaults", async () => {
    await setDefaults("org1", "project1");
    await setDefaults("org2"); // Only update org

    expect(await getDefaultOrganization()).toBe("org2");
    expect(await getDefaultProject()).toBe("project1");
  });

  test("getDefaultOrganization returns undefined when not set", async () => {
    const org = await getDefaultOrganization();
    expect(org).toBeUndefined();
  });

  test("getDefaultProject returns undefined when not set", async () => {
    const project = await getDefaultProject();
    expect(project).toBeUndefined();
  });
});

describe("refreshToken error handling", () => {
  test("network error during refresh does not clear auth", async () => {
    // Set up a token that needs refresh (expired but has refresh token)
    const now = Date.now();
    await writeConfig({
      auth: {
        token: "still-valid-token",
        issuedAt: now - 7200 * 1000,
        expiresAt: now - 100, // Expired
        refreshToken: "my-refresh-token",
      },
    });

    // Set required env var for OAuth
    process.env.SENTRY_CLIENT_ID = "test-client-id";

    // Mock fetch to simulate network error
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      throw new Error("fetch failed: network error");
    };

    try {
      const { refreshToken } = await import("../../src/lib/config.js");
      await refreshToken();
      // Should not reach here
      expect(true).toBe(false);
    } catch (error) {
      // Expected to throw ApiError for network failure
      expect(error).toBeDefined();
    } finally {
      globalThis.fetch = originalFetch;
    }

    // Auth should NOT be cleared on network error
    const config = await readConfig();
    expect(config.auth?.token).toBe("still-valid-token");
    expect(config.auth?.refreshToken).toBe("my-refresh-token");
  });

  test("auth error during refresh clears auth", async () => {
    // Set up a token that needs refresh
    const now = Date.now();
    await writeConfig({
      auth: {
        token: "revoked-token",
        issuedAt: now - 7200 * 1000,
        expiresAt: now - 100, // Expired
        refreshToken: "invalid-refresh-token",
      },
    });

    process.env.SENTRY_CLIENT_ID = "test-client-id";

    // Mock fetch to simulate server rejecting refresh token
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          error: "invalid_grant",
          error_description: "Token revoked",
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );

    try {
      const { refreshToken } = await import("../../src/lib/config.js");
      await refreshToken();
      expect(true).toBe(false);
    } catch (error) {
      expect(error).toBeDefined();
    } finally {
      globalThis.fetch = originalFetch;
    }

    // Auth SHOULD be cleared when server rejects refresh token
    const config = await readConfig();
    expect(config.auth).toBeUndefined();
  });
});

describe("project aliases", () => {
  test("setProjectAliases stores aliases in config", async () => {
    await setProjectAliases({
      e: { orgSlug: "sentry", projectSlug: "spotlight-electron" },
      w: { orgSlug: "sentry", projectSlug: "spotlight-website" },
    });

    const config = await readConfig();
    expect(config.projectAliases?.aliases).toEqual({
      e: { orgSlug: "sentry", projectSlug: "spotlight-electron" },
      w: { orgSlug: "sentry", projectSlug: "spotlight-website" },
    });
    expect(config.projectAliases?.cachedAt).toBeGreaterThan(0);
  });

  test("getProjectAliases returns stored aliases", async () => {
    await setProjectAliases({
      f: { orgSlug: "my-org", projectSlug: "frontend" },
      b: { orgSlug: "my-org", projectSlug: "backend" },
    });

    const aliases = await getProjectAliases();
    expect(aliases).toEqual({
      f: { orgSlug: "my-org", projectSlug: "frontend" },
      b: { orgSlug: "my-org", projectSlug: "backend" },
    });
  });

  test("getProjectAliases returns undefined when not set", async () => {
    const aliases = await getProjectAliases();
    expect(aliases).toBeUndefined();
  });

  test("getProjectByAlias returns correct project", async () => {
    await setProjectAliases({
      e: { orgSlug: "sentry", projectSlug: "spotlight-electron" },
      w: { orgSlug: "sentry", projectSlug: "spotlight-website" },
      s: { orgSlug: "sentry", projectSlug: "spotlight" },
    });

    const project = await getProjectByAlias("e");
    expect(project).toEqual({
      orgSlug: "sentry",
      projectSlug: "spotlight-electron",
    });
  });

  test("getProjectByAlias is case-insensitive", async () => {
    await setProjectAliases({
      e: { orgSlug: "sentry", projectSlug: "spotlight-electron" },
    });

    expect(await getProjectByAlias("E")).toEqual({
      orgSlug: "sentry",
      projectSlug: "spotlight-electron",
    });
    expect(await getProjectByAlias("e")).toEqual({
      orgSlug: "sentry",
      projectSlug: "spotlight-electron",
    });
  });

  test("getProjectByAlias returns undefined for unknown alias", async () => {
    await setProjectAliases({
      e: { orgSlug: "sentry", projectSlug: "spotlight-electron" },
    });

    const project = await getProjectByAlias("x");
    expect(project).toBeUndefined();
  });

  test("getProjectByAlias returns undefined when no aliases set", async () => {
    const project = await getProjectByAlias("e");
    expect(project).toBeUndefined();
  });

  test("clearProjectAliases removes all aliases", async () => {
    await setProjectAliases({
      e: { orgSlug: "sentry", projectSlug: "spotlight-electron" },
    });

    await clearProjectAliases();

    const aliases = await getProjectAliases();
    expect(aliases).toBeUndefined();
  });

  test("setProjectAliases overwrites existing aliases", async () => {
    await setProjectAliases({
      old: { orgSlug: "org1", projectSlug: "project1" },
    });

    await setProjectAliases({
      new: { orgSlug: "org2", projectSlug: "project2" },
    });

    const aliases = await getProjectAliases();
    expect(aliases).toEqual({
      new: { orgSlug: "org2", projectSlug: "project2" },
    });
    expect(aliases?.old).toBeUndefined();
  });
});

describe("DSN-fingerprinted project aliases", () => {
  test("setProjectAliases stores dsnFingerprint", async () => {
    await setProjectAliases(
      {
        e: { orgSlug: "sentry", projectSlug: "spotlight-electron" },
      },
      "123:456,123:789"
    );

    const config = await readConfig();
    expect(config.projectAliases?.dsnFingerprint).toBe("123:456,123:789");
  });

  test("getProjectByAlias returns alias when fingerprint matches", async () => {
    await setProjectAliases(
      {
        e: { orgSlug: "sentry", projectSlug: "spotlight-electron" },
      },
      "123:456,123:789"
    );

    // Same fingerprint
    const project = await getProjectByAlias("e", "123:456,123:789");
    expect(project).toEqual({
      orgSlug: "sentry",
      projectSlug: "spotlight-electron",
    });
  });

  test("getProjectByAlias returns undefined when fingerprint mismatches", async () => {
    await setProjectAliases(
      {
        e: { orgSlug: "sentry", projectSlug: "spotlight-electron" },
      },
      "123:456,123:789"
    );

    // Different fingerprint (different DSN context)
    const project = await getProjectByAlias("e", "999:111");
    expect(project).toBeUndefined();
  });

  test("getProjectByAlias returns alias when no fingerprint stored (legacy cache)", async () => {
    // No fingerprint stored
    await setProjectAliases({
      e: { orgSlug: "sentry", projectSlug: "spotlight-electron" },
    });

    // Should work without fingerprint validation (legacy cache)
    const project = await getProjectByAlias("e", "123:456");
    expect(project).toEqual({
      orgSlug: "sentry",
      projectSlug: "spotlight-electron",
    });
  });

  test("getProjectByAlias returns alias when no current fingerprint provided", async () => {
    await setProjectAliases(
      {
        e: { orgSlug: "sentry", projectSlug: "spotlight-electron" },
      },
      "123:456,123:789"
    );

    // No current fingerprint provided - skip validation
    const project = await getProjectByAlias("e");
    expect(project).toEqual({
      orgSlug: "sentry",
      projectSlug: "spotlight-electron",
    });
  });

  test("fingerprint does not affect case-insensitive lookup", async () => {
    await setProjectAliases(
      {
        e: { orgSlug: "sentry", projectSlug: "spotlight-electron" },
      },
      "123:456"
    );

    // Uppercase alias with matching fingerprint
    const project = await getProjectByAlias("E", "123:456");
    expect(project).toEqual({
      orgSlug: "sentry",
      projectSlug: "spotlight-electron",
    });
  });

  test("getProjectByAlias rejects when current fingerprint is empty but cached is not", async () => {
    // Cache was created with SaaS DSNs
    await setProjectAliases(
      {
        e: { orgSlug: "sentry", projectSlug: "spotlight-electron" },
      },
      "123:456"
    );

    // Current context has no SaaS DSNs (empty fingerprint)
    // This should reject - different workspace/context
    const project = await getProjectByAlias("e", "");
    expect(project).toBeUndefined();
  });

  test("getProjectByAlias rejects when cached fingerprint is empty but current is not", async () => {
    // Cache was created with only self-hosted DSNs (empty fingerprint)
    await setProjectAliases(
      {
        e: { orgSlug: "sentry", projectSlug: "spotlight-electron" },
      },
      ""
    );

    // Current context has SaaS DSNs
    // This should reject - different workspace/context
    const project = await getProjectByAlias("e", "123:456");
    expect(project).toBeUndefined();
  });

  test("getProjectByAlias accepts when both fingerprints are empty", async () => {
    // Cache was created with only self-hosted DSNs
    await setProjectAliases(
      {
        e: { orgSlug: "sentry", projectSlug: "spotlight-electron" },
      },
      ""
    );

    // Current context also has only self-hosted DSNs
    const project = await getProjectByAlias("e", "");
    expect(project).toEqual({
      orgSlug: "sentry",
      projectSlug: "spotlight-electron",
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DSN Key-based Project Cache
// ─────────────────────────────────────────────────────────────────────────────

describe("getCachedProjectByDsnKey / setCachedProjectByDsnKey", () => {
  test("caches and retrieves project by DSN public key", async () => {
    await setCachedProjectByDsnKey("abc123publickey", {
      orgSlug: "my-org",
      orgName: "My Organization",
      projectSlug: "my-project",
      projectName: "My Project",
    });

    const cached = await getCachedProjectByDsnKey("abc123publickey");
    expect(cached).toBeDefined();
    expect(cached?.orgSlug).toBe("my-org");
    expect(cached?.projectSlug).toBe("my-project");
    expect(cached?.cachedAt).toBeDefined();
  });

  test("returns undefined for unknown DSN key", async () => {
    const cached = await getCachedProjectByDsnKey("nonexistent-key");
    expect(cached).toBeUndefined();
  });

  test("stores with dsn: prefix to avoid collisions with orgId:projectId keys", async () => {
    // Set by DSN key
    await setCachedProjectByDsnKey("mykey", {
      orgSlug: "dsn-org",
      orgName: "DSN Org",
      projectSlug: "dsn-project",
      projectName: "DSN Project",
    });

    const config = await readConfig();
    // Should be stored with "dsn:" prefix
    expect(config.projectCache?.["dsn:mykey"]).toBeDefined();
    expect(config.projectCache?.["dsn:mykey"]?.orgSlug).toBe("dsn-org");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Project Cache (by orgId:projectId)
// ─────────────────────────────────────────────────────────────────────────────

describe("getCachedProject / setCachedProject / clearProjectCache", () => {
  test("caches and retrieves project by orgId and projectId", async () => {
    await setCachedProject("123", "456", {
      orgSlug: "my-org",
      orgName: "My Organization",
      projectSlug: "my-project",
      projectName: "My Project",
    });

    const cached = await getCachedProject("123", "456");
    expect(cached).toBeDefined();
    expect(cached?.orgSlug).toBe("my-org");
    expect(cached?.projectSlug).toBe("my-project");
    expect(cached?.cachedAt).toBeDefined();
  });

  test("returns undefined for unknown orgId:projectId", async () => {
    const cached = await getCachedProject("999", "999");
    expect(cached).toBeUndefined();
  });

  test("stores with orgId:projectId key format", async () => {
    await setCachedProject("123", "456", {
      orgSlug: "my-org",
      orgName: "My Organization",
      projectSlug: "my-project",
      projectName: "My Project",
    });

    const config = await readConfig();
    expect(config.projectCache?.["123:456"]).toBeDefined();
    expect(config.projectCache?.["123:456"]?.orgSlug).toBe("my-org");
  });

  test("clearProjectCache removes all cached projects", async () => {
    await setCachedProject("123", "456", {
      orgSlug: "org1",
      orgName: "Org 1",
      projectSlug: "project1",
      projectName: "Project 1",
    });
    await setCachedProjectByDsnKey("key1", {
      orgSlug: "org2",
      orgName: "Org 2",
      projectSlug: "project2",
      projectName: "Project 2",
    });

    await clearProjectCache();

    const config = await readConfig();
    expect(config.projectCache).toBeUndefined();
  });

  test("multiple projects can be cached independently", async () => {
    await setCachedProject("123", "456", {
      orgSlug: "org1",
      orgName: "Org 1",
      projectSlug: "project1",
      projectName: "Project 1",
    });
    await setCachedProject("123", "789", {
      orgSlug: "org1",
      orgName: "Org 1",
      projectSlug: "project2",
      projectName: "Project 2",
    });

    const cached1 = await getCachedProject("123", "456");
    const cached2 = await getCachedProject("123", "789");

    expect(cached1?.projectSlug).toBe("project1");
    expect(cached2?.projectSlug).toBe("project2");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Config Path
// ─────────────────────────────────────────────────────────────────────────────

describe("getConfigPath", () => {
  test("returns the config file path", () => {
    const path = getConfigPath();
    expect(path).toContain("config.json");
    expect(path).toContain(testConfigDir);
  });
});
