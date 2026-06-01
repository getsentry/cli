/**
 * Tests for installBinary's canonical() fallback when realpathSync throws on a
 * path that exists.
 *
 * realpathSync only throws for an existing path under rare conditions (e.g. a
 * permission error, or a TOCTOU race where the file is removed between the
 * existsSync check and the realpathSync call). We mock realpathSync to throw so
 * the catch branch — which logs and falls back to resolve() — is exercised.
 *
 * Kept in a sibling `.mocked.test.ts` file so the node:fs mock doesn't leak
 * into binary.test.ts, which relies on the real filesystem.
 */

import { chmodSync, mkdirSync, rmSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// Mock only realpathSync to throw; everything else stays real via importOriginal.
vi.mock("node:fs", async (importOriginal) => {
  const orig = await importOriginal<typeof import("node:fs")>();
  return {
    ...orig,
    realpathSync: () => {
      throw new Error("EACCES: permission denied (simulated)");
    },
  };
});

// Import AFTER the mock so binary.ts picks up the throwing realpathSync.
import { getBinaryFilename, installBinary } from "../../src/lib/binary.js";
import { logger } from "../../src/lib/logger.js";

describe("installBinary canonical() fallback when realpathSync throws", () => {
  let testDir: string;
  let installDir: string;

  beforeEach(() => {
    testDir = join(
      "/tmp",
      `binary-mocked-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    installDir = join(testDir, "install");
    mkdirSync(installDir, { recursive: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(testDir, { recursive: true, force: true });
  });

  test("falls back to resolve() and logs when realpathSync throws on an existing path", async () => {
    if (process.platform === "win32") return;

    // Mirror the upgrade-spawn case: sourcePath IS the .download file, so the
    // guard must recognize them as the same file. With realpathSync throwing,
    // canonical() must fall back to resolve() (which still matches here) rather
    // than unlinking the source and crashing.
    const tempPath = join(installDir, `${getBinaryFilename()}.download`);
    await writeFile(tempPath, "upgraded binary");
    chmodSync(tempPath, 0o755);

    const debugSpy = vi.spyOn(logger, "debug");

    const result = await installBinary(tempPath, installDir);

    expect(result).toBe(join(installDir, getBinaryFilename()));
    expect(await readFile(result, "utf-8")).toBe("upgraded binary");
    expect(debugSpy).toHaveBeenCalledWith(
      "realpathSync failed, falling back to resolve()",
      expect.any(Error)
    );
  });
});
