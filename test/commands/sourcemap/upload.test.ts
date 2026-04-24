/**
 * sourcemap inject / upload command tests
 *
 * Focused on the "strict by default, --allow-empty opt-out" behavior added
 * to guard against silent bundler misconfigurations where no .map files are
 * present in the upload directory. A zero-file upload used to succeed
 * silently, producing no Sentry symbolication and no CI signal — the exact
 * failure mode the getsentry/cli docs site hit (see PR #xxx).
 */

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { injectCommand } from "../../../src/commands/sourcemap/inject.js";
import { uploadCommand } from "../../../src/commands/sourcemap/upload.js";
import { ValidationError } from "../../../src/lib/errors.js";

// The loader() return is the wrapper-produced async function (NOT a
// generator) that internally iterates the original generator body and
// writes rendered output to ctx.stdout. Errors thrown inside the
// generator body propagate out as a rejected promise.
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
      process: {
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
      },
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

  test("empty directory: throws ValidationError by default", async () => {
    const { ctx } = makeContext();
    await expect(runFunc(func, ctx, {}, dir)).rejects.toBeInstanceOf(
      ValidationError
    );
  });

  test("empty directory: error message mentions the directory and escape hatch", async () => {
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

  test("directory with a .js + .map pair: succeeds (0 pairs guard not triggered)", async () => {
    writeFileSync(join(dir, "app.js"), "console.log(1)\n");
    writeFileSync(join(dir, "app.js.map"), '{"version":3}\n');
    const { ctx } = makeContext();
    await expect(runFunc(func, ctx, {}, dir)).resolves.toBeUndefined();
  });

  test(".js files without matching .map files: throws (0 pairs discovered)", async () => {
    // A common misconfiguration: bundler emits JS but no sourcemaps.
    writeFileSync(join(dir, "app.js"), "console.log(1)\n");
    writeFileSync(join(dir, "other.js"), "console.log(2)\n");
    const { ctx } = makeContext();
    await expect(runFunc(func, ctx, {}, dir)).rejects.toBeInstanceOf(
      ValidationError
    );
  });

  test(".map files without matching .js files: throws (0 pairs discovered)", async () => {
    // Stray sourcemaps without their JS — also not usable.
    writeFileSync(join(dir, "app.js.map"), '{"version":3}\n');
    const { ctx } = makeContext();
    await expect(runFunc(func, ctx, {}, dir)).rejects.toBeInstanceOf(
      ValidationError
    );
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

  test("empty directory: throws ValidationError by default", async () => {
    const { ctx } = makeContext();
    await expect(runFunc(func, ctx, {}, dir)).rejects.toBeInstanceOf(
      ValidationError
    );
  });

  test("empty directory: error message mentions the directory and escape hatch", async () => {
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
});
