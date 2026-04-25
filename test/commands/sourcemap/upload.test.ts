/**
 * Tests for the strict-by-default zero-pairs behavior on `sentry
 * sourcemap inject` / `upload`, including the per-shape diagnostic
 * branches in `buildEmptyDiscoveryError`.
 */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { injectCommand } from "../../../src/commands/sourcemap/inject.js";
import { uploadCommand } from "../../../src/commands/sourcemap/upload.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as sourcemapsApi from "../../../src/lib/api/sourcemaps.js";
import { ValidationError } from "../../../src/lib/errors.js";

type InjectFuncArgs = {
  ext?: string;
  "dry-run"?: boolean;
  "allow-empty"?: boolean;
};
type UploadFuncArgs = {
  release?: string;
  "url-prefix"?: string;
  "allow-empty"?: boolean;
};
type CmdFunc<A> = (this: unknown, flags: A, dir: string) => Promise<unknown>;

function makeContext() {
  return {
    stdout: { write: mock(() => true) },
    stderr: { write: mock(() => true) },
    cwd: "/tmp",
  };
}

describe("sourcemap inject command — --allow-empty behavior", () => {
  let dir: string;
  let func: CmdFunc<InjectFuncArgs>;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "sentry-inject-cmd-"));
    func = (await injectCommand.loader()) as unknown as CmdFunc<InjectFuncArgs>;
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("empty directory: throws actionable ValidationError", async () => {
    const ctx = makeContext();
    try {
      await func.call(ctx, {}, dir);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      const msg = (err as Error).message;
      expect(msg).toContain(dir);
      expect(msg).toContain("--allow-empty");
      expect(msg).toMatch(/no JS or sourcemap files/i);
    }
  });

  test("empty directory with --allow-empty: succeeds silently", async () => {
    const ctx = makeContext();
    await expect(
      func.call(ctx, { "allow-empty": true }, dir)
    ).resolves.toBeUndefined();
  });

  test("directory with a .js + .map pair: succeeds (0 pairs guard not triggered)", async () => {
    writeFileSync(join(dir, "app.js"), "console.log(1)\n");
    writeFileSync(join(dir, "app.js.map"), '{"version":3}\n');
    const ctx = makeContext();
    await expect(func.call(ctx, {}, dir)).resolves.toBeUndefined();
  });

  test(".js files without matching .map files: throws with bundler hint", async () => {
    writeFileSync(join(dir, "app.js"), "console.log(1)\n");
    writeFileSync(join(dir, "other.js"), "console.log(2)\n");
    const ctx = makeContext();
    try {
      await func.call(ctx, {}, dir);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      const msg = (err as Error).message;
      expect(msg).toContain("2 JS file(s)");
      expect(msg).toMatch(/vite|webpack/i);
      expect(msg).toContain("sourcemap");
    }
  });

  test(".map files without matching .js files: throws with mismatch hint", async () => {
    writeFileSync(join(dir, "app.js.map"), '{"version":3}\n');
    const ctx = makeContext();
    try {
      await func.call(ctx, {}, dir);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      const msg = (err as Error).message;
      expect(msg).toContain(".map file(s)");
      expect(msg).toContain("no companion JS");
    }
  });

  test("js and map present but no basename match: reports both counts", async () => {
    writeFileSync(join(dir, "app.abc123.js"), "console.log(1)\n");
    writeFileSync(join(dir, "app.js.map"), '{"version":3}\n');
    const ctx = makeContext();
    try {
      await func.call(ctx, {}, dir);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      const msg = (err as Error).message;
      expect(msg).toContain("1 JS");
      expect(msg).toContain("1 .map");
      expect(msg).toContain("matching basename");
    }
  });

  test("non-existent directory: throws with distinct 'does not exist' message", async () => {
    const missing = join(dir, "does-not-exist");
    const ctx = makeContext();
    try {
      await func.call(ctx, {}, missing);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      const msg = (err as Error).message;
      expect(msg).toContain(missing);
      expect(msg).toMatch(/does not exist/i);
      expect(msg).not.toContain("--allow-empty");
    }
  });

  test("path is a file, not a directory: throws with distinct message", async () => {
    const filePath = join(dir, "not-a-dir.txt");
    writeFileSync(filePath, "hello\n");
    const ctx = makeContext();
    try {
      await func.call(ctx, {}, filePath);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      const msg = (err as Error).message;
      expect(msg).toContain(filePath);
      expect(msg).toMatch(/not a directory/i);
    }
  });

  test("--dry-run + empty directory: still errors (dry-run is not an escape hatch)", async () => {
    const ctx = makeContext();
    await expect(
      func.call(ctx, { "dry-run": true }, dir)
    ).rejects.toBeInstanceOf(ValidationError);
  });

  test("--dry-run + --allow-empty: succeeds silently", async () => {
    const ctx = makeContext();
    await expect(
      func.call(ctx, { "dry-run": true, "allow-empty": true }, dir)
    ).resolves.toBeUndefined();
  });
});

describe("sourcemap upload command — --allow-empty behavior", () => {
  let dir: string;
  let func: CmdFunc<UploadFuncArgs>;
  let savedEnv: Record<string, string | undefined>;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "sentry-upload-cmd-"));
    // Short-circuit resolveOrgAndProject so tests don't need DSN/config.
    savedEnv = {
      SENTRY_ORG: process.env.SENTRY_ORG,
      SENTRY_PROJECT: process.env.SENTRY_PROJECT,
    };
    process.env.SENTRY_ORG = "test-org";
    process.env.SENTRY_PROJECT = "test-project";
    func = (await uploadCommand.loader()) as unknown as CmdFunc<UploadFuncArgs>;
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = v;
      }
    }
  });

  test("empty directory: throws actionable ValidationError", async () => {
    const ctx = makeContext();
    try {
      await func.call(ctx, {}, dir);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      const msg = (err as Error).message;
      expect(msg).toContain(dir);
      expect(msg).toContain("--allow-empty");
    }
  });

  test("empty directory with --allow-empty: succeeds silently", async () => {
    const ctx = makeContext();
    await expect(
      func.call(ctx, { "allow-empty": true }, dir)
    ).resolves.toBeUndefined();
  });

  test("empty directory with --allow-empty: does not require credentials", async () => {
    // The library-only / conditional-release-skip cases named in the
    // docs may run without DSN/org/project context. With nothing to
    // upload, the command must not insist on resolving them.
    delete process.env.SENTRY_ORG;
    delete process.env.SENTRY_PROJECT;
    const ctx = makeContext();
    await expect(
      func.call(ctx, { "allow-empty": true }, dir)
    ).resolves.toBeUndefined();
  });

  test("directory with .js files but no .map files: throws", async () => {
    mkdirSync(join(dir, "_astro"));
    writeFileSync(join(dir, "_astro", "app.js"), "console.log(1)\n");
    const ctx = makeContext();
    await expect(func.call(ctx, {}, dir)).rejects.toBeInstanceOf(
      ValidationError
    );
  });

  test("non-existent directory: throws before resolving org/project", async () => {
    // Cleared so the dir-check has to fire first to produce a useful error.
    delete process.env.SENTRY_ORG;
    delete process.env.SENTRY_PROJECT;
    const missing = join(dir, "does-not-exist");
    const ctx = makeContext();
    try {
      await func.call(ctx, {}, missing);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      const msg = (err as Error).message;
      expect(msg).toMatch(/does not exist/i);
    }
  });

  test("error path does not mutate files (js-only dir)", async () => {
    // Discovery must be read-only — injection only runs once we've
    // decided the upload will proceed.
    mkdirSync(join(dir, "_astro"));
    const jsPath = join(dir, "_astro", "app.js");
    const original = "console.log(1)\n";
    writeFileSync(jsPath, original);
    const ctx = makeContext();
    await expect(func.call(ctx, {}, dir)).rejects.toBeInstanceOf(
      ValidationError
    );
    const after = await Bun.file(jsPath).text();
    expect(after).toBe(original);
    expect(after).not.toContain("_sentryDebugIds");
    expect(after).not.toContain("sentry-dbid");
  });

  test("happy path: directory with JS+map pair invokes uploadSourcemaps", async () => {
    mkdirSync(join(dir, "_astro"));
    const jsPath = join(dir, "_astro", "app.js");
    const mapPath = join(dir, "_astro", "app.js.map");
    writeFileSync(jsPath, "console.log(1)\n");
    writeFileSync(
      mapPath,
      JSON.stringify({
        version: 3,
        sources: ["app.ts"],
        names: [],
        mappings: "",
      })
    );

    const uploadSpy = spyOn(
      sourcemapsApi,
      "uploadSourcemaps"
    ).mockResolvedValue(undefined);
    try {
      const ctx = makeContext();
      await func.call(ctx, {}, dir);
      expect(uploadSpy).toHaveBeenCalledTimes(1);
      const callArgs = uploadSpy.mock.calls[0]?.[0];
      expect(callArgs?.org).toBe("test-org");
      expect(callArgs?.project).toBe("test-project");
      expect(callArgs?.files).toHaveLength(2);
      const types = callArgs?.files.map((f) => f.type);
      expect(types).toContain("minified_source");
      expect(types).toContain("source_map");
    } finally {
      uploadSpy.mockRestore();
    }
  });
});
