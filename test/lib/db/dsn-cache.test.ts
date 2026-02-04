/**
 * DSN Cache Tests
 *
 * Tests for both single-DSN caching and full detection caching with mtime validation.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  clearDsnCache,
  getCachedDetection,
  getCachedDsn,
  setCachedDetection,
  setCachedDsn,
  updateCachedResolution,
} from "../../../src/lib/db/dsn-cache.js";
import type { DetectedDsn } from "../../../src/lib/dsn/types.js";
import { cleanupTestDir, createTestConfigDir } from "../../helpers.js";

let testConfigDir: string;
let testProjectDir: string;

beforeEach(async () => {
  testConfigDir = await createTestConfigDir("test-dsn-cache-");
  process.env.SENTRY_CLI_CONFIG_DIR = testConfigDir;

  // Create a test project directory with source files
  testProjectDir = join(testConfigDir, "project");
  mkdirSync(testProjectDir, { recursive: true });
  mkdirSync(join(testProjectDir, "src"), { recursive: true });
  writeFileSync(
    join(testProjectDir, "src/app.ts"),
    'const DSN = "https://abc@o123.ingest.sentry.io/456";'
  );
});

afterEach(async () => {
  delete process.env.SENTRY_CLI_CONFIG_DIR;
  await cleanupTestDir(testConfigDir);
});

// =============================================================================
// Single DSN Cache Tests (Original functionality)
// =============================================================================

describe("getCachedDsn", () => {
  test("returns undefined when no cache entry exists", async () => {
    const result = await getCachedDsn("/nonexistent/path");
    expect(result).toBeUndefined();
  });

  test("returns cached entry when it exists", async () => {
    await setCachedDsn(testProjectDir, {
      dsn: "https://abc@o123.ingest.sentry.io/456",
      projectId: "456",
      orgId: "123",
      source: "env",
      sourcePath: ".env",
    });

    const result = await getCachedDsn(testProjectDir);
    expect(result?.dsn).toBe("https://abc@o123.ingest.sentry.io/456");
    expect(result?.projectId).toBe("456");
    expect(result?.orgId).toBe("123");
    expect(result?.source).toBe("env");
    expect(result?.sourcePath).toBe(".env");
  });
});

describe("setCachedDsn", () => {
  test("stores DSN cache entry", async () => {
    await setCachedDsn(testProjectDir, {
      dsn: "https://key@o999.ingest.sentry.io/111",
      projectId: "111",
      orgId: "999",
      source: "code",
      sourcePath: "src/index.ts",
    });

    const result = await getCachedDsn(testProjectDir);
    expect(result?.dsn).toBe("https://key@o999.ingest.sentry.io/111");
    expect(result?.projectId).toBe("111");
  });

  test("overwrites existing cache entry", async () => {
    await setCachedDsn(testProjectDir, {
      dsn: "https://first@o1.ingest.sentry.io/1",
      projectId: "1",
      source: "env",
    });

    await setCachedDsn(testProjectDir, {
      dsn: "https://second@o2.ingest.sentry.io/2",
      projectId: "2",
      source: "code",
    });

    const result = await getCachedDsn(testProjectDir);
    expect(result?.dsn).toBe("https://second@o2.ingest.sentry.io/2");
    expect(result?.projectId).toBe("2");
  });
});

describe("updateCachedResolution", () => {
  test("updates resolved org/project info", async () => {
    await setCachedDsn(testProjectDir, {
      dsn: "https://abc@o123.ingest.sentry.io/456",
      projectId: "456",
      source: "env",
    });

    await updateCachedResolution(testProjectDir, {
      orgSlug: "my-org",
      orgName: "My Organization",
      projectSlug: "my-project",
      projectName: "My Project",
    });

    const result = await getCachedDsn(testProjectDir);
    expect(result?.resolved?.orgSlug).toBe("my-org");
    expect(result?.resolved?.orgName).toBe("My Organization");
    expect(result?.resolved?.projectSlug).toBe("my-project");
    expect(result?.resolved?.projectName).toBe("My Project");
  });

  test("does nothing if cache entry does not exist", async () => {
    // Should not throw
    await updateCachedResolution("/nonexistent", {
      orgSlug: "org",
      orgName: "Org",
      projectSlug: "project",
      projectName: "Project",
    });
  });
});

describe("clearDsnCache", () => {
  test("removes specific directory cache", async () => {
    await setCachedDsn(testProjectDir, {
      dsn: "https://abc@o123.ingest.sentry.io/456",
      projectId: "456",
      source: "env",
    });

    await clearDsnCache(testProjectDir);

    const result = await getCachedDsn(testProjectDir);
    expect(result).toBeUndefined();
  });

  test("removes all caches when no directory specified", async () => {
    const dir1 = join(testConfigDir, "dir1");
    const dir2 = join(testConfigDir, "dir2");
    mkdirSync(dir1);
    mkdirSync(dir2);

    await setCachedDsn(dir1, {
      dsn: "https://a@o1.ingest.sentry.io/1",
      projectId: "1",
      source: "env",
    });
    await setCachedDsn(dir2, {
      dsn: "https://b@o2.ingest.sentry.io/2",
      projectId: "2",
      source: "code",
    });

    await clearDsnCache();

    expect(await getCachedDsn(dir1)).toBeUndefined();
    expect(await getCachedDsn(dir2)).toBeUndefined();
  });
});

// =============================================================================
// Full Detection Cache Tests (v4 functionality)
// =============================================================================

const createTestDsn = (overrides: Partial<DetectedDsn> = {}): DetectedDsn => ({
  protocol: "https",
  publicKey: "testkey",
  host: "o123.ingest.sentry.io",
  projectId: "456",
  orgId: "123",
  raw: "https://testkey@o123.ingest.sentry.io/456",
  source: "code",
  sourcePath: "src/app.ts",
  ...overrides,
});

describe("getCachedDetection", () => {
  test("returns undefined when no cache entry exists", async () => {
    const result = await getCachedDetection("/nonexistent/path");
    expect(result).toBeUndefined();
  });

  test("returns cached detection when valid", async () => {
    const testDsn = createTestDsn();
    const sourceMtimes = {
      "src/app.ts": Bun.file(join(testProjectDir, "src/app.ts")).lastModified,
    };

    // Get current root dir mtime
    const { stat } = await import("node:fs/promises");
    const rootStats = await stat(testProjectDir);
    const rootDirMtime = Math.floor(rootStats.mtimeMs);

    await setCachedDetection(testProjectDir, {
      fingerprint: "test-fingerprint",
      allDsns: [testDsn],
      sourceMtimes,
      dirMtimes: {},
      rootDirMtime,
    });

    const result = await getCachedDetection(testProjectDir);
    expect(result).toBeDefined();
    expect(result?.fingerprint).toBe("test-fingerprint");
    expect(result?.allDsns).toHaveLength(1);
    expect(result?.allDsns[0].raw).toBe(testDsn.raw);
  });

  test("invalidates cache when source file mtime changes", async () => {
    const testDsn = createTestDsn();
    const sourceMtimes = {
      "src/app.ts": Bun.file(join(testProjectDir, "src/app.ts")).lastModified,
    };

    const { stat } = await import("node:fs/promises");
    const rootStats = await stat(testProjectDir);
    const rootDirMtime = Math.floor(rootStats.mtimeMs);

    await setCachedDetection(testProjectDir, {
      fingerprint: "test-fingerprint",
      allDsns: [testDsn],
      sourceMtimes,
      dirMtimes: {},
      rootDirMtime,
    });

    // Verify cache exists
    const before = await getCachedDetection(testProjectDir);
    expect(before).toBeDefined();

    // Wait a moment and modify the source file
    await Bun.sleep(10);
    writeFileSync(
      join(testProjectDir, "src/app.ts"),
      'const DSN = "https://changed@o123.ingest.sentry.io/789";'
    );

    // Cache should be invalidated
    const after = await getCachedDetection(testProjectDir);
    expect(after).toBeUndefined();
  });

  test("invalidates cache when source file is deleted", async () => {
    const testDsn = createTestDsn();
    const sourceMtimes = {
      "src/app.ts": Bun.file(join(testProjectDir, "src/app.ts")).lastModified,
    };

    const { stat } = await import("node:fs/promises");
    const rootStats = await stat(testProjectDir);
    const rootDirMtime = Math.floor(rootStats.mtimeMs);

    await setCachedDetection(testProjectDir, {
      fingerprint: "test-fingerprint",
      allDsns: [testDsn],
      sourceMtimes,
      dirMtimes: {},
      rootDirMtime,
    });

    // Delete the source file
    const { rm } = await import("node:fs/promises");
    await rm(join(testProjectDir, "src/app.ts"));

    // Cache should be invalidated
    const result = await getCachedDetection(testProjectDir);
    expect(result).toBeUndefined();
  });

  test("invalidates cache when root directory mtime changes", async () => {
    const testDsn = createTestDsn();
    const sourceMtimes = {
      "src/app.ts": Bun.file(join(testProjectDir, "src/app.ts")).lastModified,
    };

    const { stat } = await import("node:fs/promises");
    const rootStats = await stat(testProjectDir);
    const rootDirMtime = Math.floor(rootStats.mtimeMs);

    await setCachedDetection(testProjectDir, {
      fingerprint: "test-fingerprint",
      allDsns: [testDsn],
      sourceMtimes,
      dirMtimes: {},
      rootDirMtime,
    });

    // Verify cache exists
    const before = await getCachedDetection(testProjectDir);
    expect(before).toBeDefined();

    // Wait and add a new file to change directory mtime
    await Bun.sleep(10);
    writeFileSync(join(testProjectDir, "new-file.txt"), "test");

    // Cache should be invalidated
    const after = await getCachedDetection(testProjectDir);
    expect(after).toBeUndefined();
  });

  test("invalidates cache when tracked subdirectory mtime changes", async () => {
    const testDsn = createTestDsn();
    const sourceMtimes = {
      "src/app.ts": Bun.file(join(testProjectDir, "src/app.ts")).lastModified,
    };

    const { stat } = await import("node:fs/promises");
    const rootStats = await stat(testProjectDir);
    const rootDirMtime = Math.floor(rootStats.mtimeMs);
    const srcStats = await stat(join(testProjectDir, "src"));
    const srcDirMtime = Math.floor(srcStats.mtimeMs);

    // Store cache with tracked src/ directory mtime
    await setCachedDetection(testProjectDir, {
      fingerprint: "test-fingerprint",
      allDsns: [testDsn],
      sourceMtimes,
      dirMtimes: { src: srcDirMtime },
      rootDirMtime,
    });

    // Verify cache exists
    const before = await getCachedDetection(testProjectDir);
    expect(before).toBeDefined();

    // Wait and add a new file to src/ to change its mtime
    await Bun.sleep(10);
    writeFileSync(
      join(testProjectDir, "src/new-config.ts"),
      "export default {}"
    );

    // Cache should be invalidated because src/ mtime changed
    const after = await getCachedDetection(testProjectDir);
    expect(after).toBeUndefined();
  });
});

describe("setCachedDetection", () => {
  test("stores full detection result", async () => {
    const testDsn = createTestDsn();
    const sourceMtimes = {
      "src/app.ts": Bun.file(join(testProjectDir, "src/app.ts")).lastModified,
    };

    const { stat } = await import("node:fs/promises");
    const rootStats = await stat(testProjectDir);
    const rootDirMtime = Math.floor(rootStats.mtimeMs);

    await setCachedDetection(testProjectDir, {
      fingerprint: "fp-123",
      allDsns: [testDsn],
      sourceMtimes,
      dirMtimes: {},
      rootDirMtime,
    });

    const result = await getCachedDetection(testProjectDir);
    expect(result?.fingerprint).toBe("fp-123");
    expect(result?.allDsns).toHaveLength(1);
    expect(Object.keys(result?.sourceMtimes ?? {})).toContain("src/app.ts");
  });

  test("stores multiple DSNs", async () => {
    const dsn1 = createTestDsn({ raw: "https://a@o1.ingest.sentry.io/1" });
    const dsn2 = createTestDsn({ raw: "https://b@o2.ingest.sentry.io/2" });
    const sourceMtimes = {
      "src/app.ts": Bun.file(join(testProjectDir, "src/app.ts")).lastModified,
    };

    const { stat } = await import("node:fs/promises");
    const rootStats = await stat(testProjectDir);
    const rootDirMtime = Math.floor(rootStats.mtimeMs);

    await setCachedDetection(testProjectDir, {
      fingerprint: "fp-multi",
      allDsns: [dsn1, dsn2],
      sourceMtimes,
      dirMtimes: {},
      rootDirMtime,
    });

    const result = await getCachedDetection(testProjectDir);
    expect(result?.allDsns).toHaveLength(2);
  });

  test("stores empty DSN array", async () => {
    const { stat } = await import("node:fs/promises");
    const rootStats = await stat(testProjectDir);
    const rootDirMtime = Math.floor(rootStats.mtimeMs);

    await setCachedDetection(testProjectDir, {
      fingerprint: "fp-empty",
      allDsns: [],
      sourceMtimes: {},
      dirMtimes: {},
      rootDirMtime,
    });

    const result = await getCachedDetection(testProjectDir);
    expect(result?.fingerprint).toBe("fp-empty");
    expect(result?.allDsns).toHaveLength(0);
  });

  test("overwrites existing detection cache", async () => {
    const dsn1 = createTestDsn({ raw: "https://first@o1.ingest.sentry.io/1" });
    const dsn2 = createTestDsn({ raw: "https://second@o2.ingest.sentry.io/2" });
    const sourceMtimes = {
      "src/app.ts": Bun.file(join(testProjectDir, "src/app.ts")).lastModified,
    };

    const { stat } = await import("node:fs/promises");
    const rootStats = await stat(testProjectDir);
    const rootDirMtime = Math.floor(rootStats.mtimeMs);

    await setCachedDetection(testProjectDir, {
      fingerprint: "fp-first",
      allDsns: [dsn1],
      sourceMtimes,
      dirMtimes: {},
      rootDirMtime,
    });

    await setCachedDetection(testProjectDir, {
      fingerprint: "fp-second",
      allDsns: [dsn2],
      sourceMtimes,
      dirMtimes: {},
      rootDirMtime,
    });

    const result = await getCachedDetection(testProjectDir);
    expect(result?.fingerprint).toBe("fp-second");
    expect(result?.allDsns[0].raw).toBe("https://second@o2.ingest.sentry.io/2");
  });
});
