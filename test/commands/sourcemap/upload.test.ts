/**
 * sourcemap inject / upload command tests
 *
 * Focused on the "strict by default, --allow-empty opt-out" behavior added
 * in #846 to guard against silent bundler misconfigurations where no .map
 * files are present in the upload directory. A zero-file upload used to
 * succeed silently, producing no Sentry symbolication and no CI signal —
 * the exact failure mode the getsentry/cli docs site hit (see #845).
 *
 * Also covers the diagnostic branches in `buildEmptyDiscoveryError`
 * (src/lib/sourcemap/inject.ts) that tailor the error message to the
 * specific input shape: empty dir vs. JS-only vs. maps-only.
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

// The loader() return is the wrapper-produced async function (NOT a
// generator) that internally iterates the original generator body and
// writes rendered output to ctx.stdout. Errors thrown inside the
// generator body propagate out as a rejected promise.
//
// The wrapper uses `this.stdout`/`this.stderr` directly (see
// `src/lib/command.ts:566`), not `this.process.*`. See AGENTS.md "Stricli
// buildCommand" lore entry.
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
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  return {
    ctx: {
      stdout: {
        write: mock((s: string) => {
          stdoutChunks.push(s);
        }),
      },
      stderr: {
        write: mock((s: string) => {
          stderrChunks.push(s);
        }),
      },
      cwd: "/tmp",
    },
    stdout: () => stdoutChunks.join(""),
    stderr: () => stderrChunks.join(""),
  };
}

async function runFunc<A>(
  func: CmdFunc<A>,
  ctx: unknown,
  flags: A,
  dir: string
): Promise<void> {
  await func.call(ctx, flags, dir);
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

  test("empty directory: throws ValidationError mentioning empty-dir", async () => {
    const { ctx } = makeContext();
    try {
      await runFunc(func, ctx, {}, dir);
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
    const { ctx } = makeContext();
    await expect(
      runFunc(func, ctx, { "allow-empty": true }, dir)
    ).resolves.toBeUndefined();
  });

  test("directory with a .js + .map pair: succeeds (0 pairs guard not triggered)", async () => {
    writeFileSync(join(dir, "app.js"), "console.log(1)\n");
    writeFileSync(join(dir, "app.js.map"), '{"version":3}\n');
    const { ctx } = makeContext();
    await expect(runFunc(func, ctx, {}, dir)).resolves.toBeUndefined();
  });

  test(".js files without matching .map files: throws with bundler hint", async () => {
    // The getsentry/cli docs-site failure mode: JS emitted but no .map
    // files (#845). Error should explicitly name Vite/webpack config.
    writeFileSync(join(dir, "app.js"), "console.log(1)\n");
    writeFileSync(join(dir, "other.js"), "console.log(2)\n");
    const { ctx } = makeContext();
    try {
      await runFunc(func, ctx, {}, dir);
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
    const { ctx } = makeContext();
    try {
      await runFunc(func, ctx, {}, dir);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      const msg = (err as Error).message;
      expect(msg).toContain(".map file(s)");
      expect(msg).toContain("no companion JS");
    }
  });

  test("js and map present but no basename match: reports both counts", async () => {
    // e.g. hash-renamed JS paired with a stable-name map.
    writeFileSync(join(dir, "app.abc123.js"), "console.log(1)\n");
    writeFileSync(join(dir, "app.js.map"), '{"version":3}\n');
    const { ctx } = makeContext();
    try {
      await runFunc(func, ctx, {}, dir);
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
    const { ctx } = makeContext();
    try {
      await runFunc(func, ctx, {}, missing);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      const msg = (err as Error).message;
      expect(msg).toContain(missing);
      expect(msg).toMatch(/does not exist/i);
      // Must NOT conflate with the bundler hint.
      expect(msg).not.toContain("--allow-empty");
    }
  });

  test("path is a file, not a directory: throws with distinct message", async () => {
    const filePath = join(dir, "not-a-dir.txt");
    writeFileSync(filePath, "hello\n");
    const { ctx } = makeContext();
    try {
      await runFunc(func, ctx, {}, filePath);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      const msg = (err as Error).message;
      expect(msg).toContain(filePath);
      expect(msg).toMatch(/not a directory/i);
    }
  });

  test("--dry-run + empty directory: still errors (dry-run is not an escape hatch)", async () => {
    const { ctx } = makeContext();
    await expect(
      runFunc(func, ctx, { "dry-run": true }, dir)
    ).rejects.toBeInstanceOf(ValidationError);
  });

  test("--dry-run + --allow-empty: succeeds silently", async () => {
    const { ctx } = makeContext();
    await expect(
      runFunc(func, ctx, { "dry-run": true, "allow-empty": true }, dir)
    ).resolves.toBeUndefined();
  });
});

describe("sourcemap upload command — --allow-empty behavior", () => {
  let dir: string;
  let func: CmdFunc<UploadFuncArgs>;
  let savedEnv: Record<string, string | undefined>;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "sentry-upload-cmd-"));
    // resolveOrgAndProject reads env vars; short-circuit via SENTRY_ORG /
    // SENTRY_PROJECT so the test doesn't need network or config files.
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

  test("empty directory: throws ValidationError mentioning empty-dir", async () => {
    const { ctx } = makeContext();
    try {
      await runFunc(func, ctx, {}, dir);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      const msg = (err as Error).message;
      expect(msg).toContain(dir);
      expect(msg).toContain("--allow-empty");
    }
  });

  test("empty directory with --allow-empty: succeeds silently", async () => {
    const { ctx } = makeContext();
    await expect(
      runFunc(func, ctx, { "allow-empty": true }, dir)
    ).resolves.toBeUndefined();
  });

  test("directory with .js files but no .map files: throws", async () => {
    // Exact reproduction of the silent-failure mode: docs site had .js
    // files emitted but no .map files, and upload reported success with
    // 0 files uploaded.
    mkdirSync(join(dir, "_astro"));
    writeFileSync(join(dir, "_astro", "app.js"), "console.log(1)\n");
    const { ctx } = makeContext();
    await expect(runFunc(func, ctx, {}, dir)).rejects.toBeInstanceOf(
      ValidationError
    );
  });

  test("non-existent directory: throws before touching Sentry creds", async () => {
    // Even with SENTRY_ORG/SENTRY_PROJECT cleared, the dir-check should
    // fire first — that's the whole point of reordering the checks so
    // local/unauthenticated invocations get actionable errors.
    delete process.env.SENTRY_ORG;
    delete process.env.SENTRY_PROJECT;
    const missing = join(dir, "does-not-exist");
    const { ctx } = makeContext();
    try {
      await runFunc(func, ctx, {}, missing);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      const msg = (err as Error).message;
      expect(msg).toMatch(/does not exist/i);
    }
  });

  test("happy path: directory with JS+map pair invokes uploadSourcemaps", async () => {
    // Prove the guard doesn't false-positive on a real upload path, and
    // that we reach the API call with sensible artifact files.
    mkdirSync(join(dir, "_astro"));
    const jsPath = join(dir, "_astro", "app.js");
    const mapPath = join(dir, "_astro", "app.js.map");
    writeFileSync(jsPath, "console.log(1)\n");
    // Valid minimal sourcemap so injectDebugId's inject step doesn't
    // choke parsing.
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
      const { ctx } = makeContext();
      await runFunc(func, ctx, {}, dir);
      expect(uploadSpy).toHaveBeenCalledTimes(1);
      const callArgs = uploadSpy.mock.calls[0]?.[0];
      expect(callArgs?.org).toBe("test-org");
      expect(callArgs?.project).toBe("test-project");
      // One JS + one sourcemap artifact per pair.
      expect(callArgs?.files).toHaveLength(2);
      const types = callArgs?.files.map((f) => f.type);
      expect(types).toContain("minified_source");
      expect(types).toContain("source_map");
    } finally {
      uploadSpy.mockRestore();
    }
  });
});
