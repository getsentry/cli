/**
 * Isolated tests for project-root stat() concurrency limiting.
 *
 * Uses mock.module() at file top-level (required pattern for module mocking
 * in Bun — see test/isolated/dsn/fs-utils.test.ts for the established pattern).
 *
 * Note: pathExists() in project-root.ts uses a statically-bound import of
 * node:fs/promises stat, so mock.module() cannot intercept it post-hoc. These
 * tests instead verify the exported STAT_CONCURRENCY constant (which configures
 * the pLimit instance) and confirm marker detection works end-to-end. The
 * concurrency enforcement itself is delegated to pLimit, whose correctness is
 * covered by its own test suite.
 */

import { describe, expect, mock, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Mock Sentry to avoid telemetry side effects during isolated tests.
// startSpan must pass a no-op span object to the callback — withTracingSpan
// calls span.setStatus() on the result.
const noopSpan = { setStatus: mock(), setAttribute: mock() };
mock.module("@sentry/node-core/light", () => ({
  startSpan: (_opts: unknown, fn: (span: unknown) => unknown) => fn(noopSpan),
  captureException: mock(),
}));

const { hasBuildSystemMarker, hasLanguageMarker, STAT_CONCURRENCY } =
  await import("../../../src/lib/dsn/project-root.js");

function makeTempDir(prefix: string): string {
  const dir = join(
    tmpdir(),
    `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("stat() concurrency limiting", () => {
  test("STAT_CONCURRENCY is 32 — matches the pLimit budget in project-root.ts", () => {
    // Guards against accidental changes to the budget value. The actual
    // enforcement is delegated to pLimit; what we own is this constant.
    expect(STAT_CONCURRENCY).toBe(32);
  });

  test("marker detection works correctly through the limiter (positive case)", async () => {
    const testDir = makeTempDir("sentry-cli-marker");
    writeFileSync(join(testDir, "Makefile"), "");

    const result = await hasBuildSystemMarker(testDir);

    expect(result).toBe(true);
  });

  test("marker detection returns false when no match (negative case)", async () => {
    const testDir = makeTempDir("sentry-cli-no-marker");

    const result = await hasBuildSystemMarker(testDir);

    expect(result).toBe(false);
  });

  test("multiple marker groups run correctly in parallel through shared limiter", async () => {
    const testDir = makeTempDir("sentry-cli-parallel");
    writeFileSync(join(testDir, "package.json"), "{}");

    // Fire both checks concurrently — both share statLimit. The language marker
    // should be found; the build system marker should not.
    const [hasBuild, hasLang] = await Promise.all([
      hasBuildSystemMarker(testDir),
      hasLanguageMarker(testDir),
    ]);

    expect(hasBuild).toBe(false);
    expect(hasLang).toBe(true);
  });
});
