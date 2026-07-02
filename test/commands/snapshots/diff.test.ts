/**
 * Tests for `sentry snapshots diff`.
 *
 * Drives the command via its wrapper `loader()` against real image
 * directories generated with pngjs. Asserts side effects (mask files, exit
 * code) rather than the rendered markdown.
 */

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PNG } from "pngjs";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { diffCommand } from "../../../src/commands/snapshots/diff.js";
import { ValidationError } from "../../../src/lib/errors.js";

let tmpDir: string;
let baseDir: string;
let headDir: string;
let outDir: string;

function png(rgb: [number, number, number]): Buffer {
  const image = new PNG({ width: 4, height: 4 });
  for (let i = 0; i < 4 * 4 * 4; i += 4) {
    image.data[i] = rgb[0];
    image.data[i + 1] = rgb[1];
    image.data[i + 2] = rgb[2];
    image.data[i + 3] = 255;
  }
  return PNG.sync.write(image);
}

function createContext() {
  return {
    context: {
      stdout: { write: () => true },
      stderr: { write: () => true },
      cwd: tmpDir,
      env: {} as NodeJS.ProcessEnv,
      process: { ...process, exitCode: undefined } as typeof process,
    },
    get exitCode() {
      return this.context.process.exitCode;
    },
  };
}

describe("snapshots diff", () => {
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "snap-diff-cmd-"));
    baseDir = join(tmpDir, "base");
    headDir = join(tmpDir, "head");
    outDir = join(tmpDir, "out");
    mkdirSync(baseDir);
    mkdirSync(headDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("writes a diff mask for changed images and reports status", async () => {
    writeFileSync(join(baseDir, "changed.png"), png([255, 0, 0]));
    writeFileSync(join(headDir, "changed.png"), png([0, 255, 0]));
    writeFileSync(join(baseDir, "same.png"), png([9, 9, 9]));
    writeFileSync(join(headDir, "same.png"), png([9, 9, 9]));
    writeFileSync(join(headDir, "added.png"), png([1, 1, 1]));

    const harness = createContext();
    const func = await diffCommand.loader();
    await func.call(harness.context, { output: outDir }, baseDir, headDir);

    // A mask was written for the changed image, but not the unchanged one.
    expect(existsSync(join(outDir, "changed.png"))).toBe(true);
    expect(existsSync(join(outDir, "same.png"))).toBe(false);
    // Without --fail-on-diff, a clean (zero) exit even with changes.
    expect(harness.exitCode ?? 0).toBe(0);
  });

  test("--fail-on-diff exits non-zero when changes exist", async () => {
    writeFileSync(join(baseDir, "a.png"), png([0, 0, 0]));
    writeFileSync(join(headDir, "a.png"), png([255, 255, 255]));

    const harness = createContext();
    const func = await diffCommand.loader();
    await func.call(
      harness.context,
      { output: outDir, "fail-on-diff": true },
      baseDir,
      headDir
    );

    expect(harness.exitCode).toBe(1);
  });

  test("--fail-on-diff exits cleanly when there are no changes", async () => {
    writeFileSync(join(baseDir, "a.png"), png([5, 5, 5]));
    writeFileSync(join(headDir, "a.png"), png([5, 5, 5]));

    const harness = createContext();
    const func = await diffCommand.loader();
    await func.call(
      harness.context,
      { output: outDir, "fail-on-diff": true },
      baseDir,
      headDir
    );

    expect(harness.exitCode ?? 0).toBe(0);
  });

  test("rejects a missing base directory", async () => {
    const harness = createContext();
    const func = await diffCommand.loader();
    await expect(
      func.call(harness.context, {}, join(tmpDir, "nope"), headDir)
    ).rejects.toThrow(ValidationError);
  });
});
