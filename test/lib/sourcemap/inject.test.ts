/**
 * Tests for directory-level debug-ID injection. Covers the discovery
 * walk (used to be hand-rolled, now delegates to `walkFiles`) —
 * specifically the skip policy for `node_modules` / dotfiles, the
 * `.gitignore` bypass for build-output dirs, and the extension
 * filter.
 */

import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { injectDirectory } from "../../../src/lib/sourcemap/inject.js";

describe("injectDirectory — discovery", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "sentry-inject-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  /** Write a .js + .js.map pair at `rel` inside `dir`. */
  function writePair(rel: string): void {
    const full = join(dir, rel);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, `// ${rel}\n`);
    writeFileSync(`${full}.map`, "{}\n");
  }

  test("discovers .js pairs in nested dirs", async () => {
    writePair("app.js");
    writePair("a/nested.js");
    writePair("a/b/deep.js");

    const results = await injectDirectory(dir, { dryRun: true });
    const paths = results.map((r) => r.jsPath.slice(dir.length + 1)).sort();
    expect(paths).toEqual(["a/b/deep.js", "a/nested.js", "app.js"]);
  });

  test("skips .js files without a companion .map", async () => {
    writePair("withmap.js");
    writeFileSync(join(dir, "orphan.js"), "// orphan\n");

    const results = await injectDirectory(dir, { dryRun: true });
    const paths = results.map((r) => r.jsPath.slice(dir.length + 1));
    expect(paths).toEqual(["withmap.js"]);
  });

  test("discovers .cjs and .mjs files by default", async () => {
    writePair("a.js");
    writePair("b.cjs");
    writePair("c.mjs");

    const results = await injectDirectory(dir, { dryRun: true });
    const paths = results.map((r) => r.jsPath.slice(dir.length + 1)).sort();
    expect(paths).toEqual(["a.js", "b.cjs", "c.mjs"]);
  });

  test("respects custom extensions", async () => {
    writePair("a.js");
    writePair("b.ts");

    const results = await injectDirectory(dir, {
      dryRun: true,
      extensions: ["ts"],
    });
    const paths = results.map((r) => r.jsPath.slice(dir.length + 1));
    expect(paths).toEqual(["b.ts"]);
  });

  test("skips node_modules", async () => {
    writePair("app.js");
    writePair("node_modules/foo/lib.js");

    const results = await injectDirectory(dir, { dryRun: true });
    const paths = results.map((r) => r.jsPath.slice(dir.length + 1));
    expect(paths).toEqual(["app.js"]);
  });

  test("skips hidden (dot-prefixed) directories", async () => {
    writePair("app.js");
    writePair(".cache/cached.js");
    writePair(".git/hooks/script.js");

    const results = await injectDirectory(dir, { dryRun: true });
    const paths = results.map((r) => r.jsPath.slice(dir.length + 1));
    expect(paths).toEqual(["app.js"]);
  });

  test("ignores .gitignore — build-output dirs are always scanned", async () => {
    // Typical build setup: `dist/` is gitignored but contains the
    // files we want to inject into.
    writeFileSync(join(dir, ".gitignore"), "dist/\nbuild/\n");
    writePair("src/a.js");
    writePair("dist/bundle.js");
    writePair("build/out.js");

    const results = await injectDirectory(dir, { dryRun: true });
    const paths = results.map((r) => r.jsPath.slice(dir.length + 1)).sort();
    expect(paths).toEqual(["build/out.js", "dist/bundle.js", "src/a.js"]);
  });

  test("scans a directory that's itself named like a gitignore target", async () => {
    // User passes `dist/` directly as the scan root. The default
    // skip list in `scan/` includes "dist" — we explicitly narrow
    // it to `["node_modules"]` for this use case.
    writePair("bundle.js");
    writePair("chunks/one.js");

    const results = await injectDirectory(dir, { dryRun: true });
    const paths = results.map((r) => r.jsPath.slice(dir.length + 1)).sort();
    expect(paths).toEqual(["bundle.js", "chunks/one.js"]);
  });

  test("does not follow symlinks", async () => {
    // Default: symlinks are ignored (matches pre-refactor behavior).
    writePair("real.js");
    const realDir = join(dir, "src");
    const linkDir = join(dir, "link");
    mkdirSync(realDir, { recursive: true });
    writePair("src/x.js");
    try {
      symlinkSync(realDir, linkDir, "dir");
    } catch {
      // Some filesystems (e.g. Windows without dev mode) can't
      // create symlinks — skip this assertion in that case.
      return;
    }
    const results = await injectDirectory(dir, { dryRun: true });
    const paths = results.map((r) => r.jsPath.slice(dir.length + 1)).sort();
    // `real.js` + `src/x.js` should be discovered; `link/x.js` must NOT.
    expect(paths).toEqual(["real.js", "src/x.js"]);
  });

  test("returns empty for missing directory", async () => {
    const results = await injectDirectory(join(dir, "does-not-exist"), {
      dryRun: true,
    });
    expect(results).toEqual([]);
  });

  test("accepts relative paths (not just absolute)", async () => {
    // Regression: `walkFiles` enforces absolute cwd and throws on
    // relative input. CLI callers (`sourcemap inject ./dist`) pass
    // the user-supplied arg straight through, so the adapter must
    // resolve it to absolute itself.
    writePair("app.js");
    const originalCwd = process.cwd();
    process.chdir(dir);
    try {
      for (const relDir of ["./", ".", "./."]) {
        const results = await injectDirectory(relDir, { dryRun: true });
        expect(results).toHaveLength(1);
        // The jsPath must still be absolute — consumers expect
        // absolute paths for downstream file ops.
        expect(results[0]?.jsPath).toMatch(/^\//);
      }
    } finally {
      process.chdir(originalCwd);
    }
  });

  test("discovers large JS bundles (> walker's default 256 KB)", async () => {
    // Regression: `walkFiles` defaults to `maxFileSize: 256 KB`,
    // which silently skipped any `.js` file larger than that —
    // i.e. every real-world webpack/rollup/Next.js bundle. The
    // adapter must opt out of the size cap.
    const bundlePath = join(dir, "bundle.js");
    // 512 KB of filler — exceeds the walker's default 256 KB cap.
    writeFileSync(bundlePath, "x".repeat(512 * 1024));
    writeFileSync(`${bundlePath}.map`, "{}\n");

    const results = await injectDirectory(dir, { dryRun: true });
    const paths = results.map((r) => r.jsPath.slice(dir.length + 1));
    expect(paths).toEqual(["bundle.js"]);
  });
});
