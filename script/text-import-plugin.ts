/**
 * esbuild plugin that polyfills Bun's `with { type: "text" }` and
 * `with { type: "file" }` import attributes (esbuild only supports
 * `json`).
 *
 * - `text` — intercepts the import, reads the file, and default-
 *   exports its contents as a string. Runtime behavior matches Bun's
 *   native handling.
 * - `file` — copies the source file into the esbuild output
 *   directory, then marks the import external so the original
 *   `import path from "./foo" with { type: "file" }` clause
 *   survives in the bundled JS. Bun.compile downstream understands
 *   the attribute natively, embeds the file as a binary asset, and
 *   resolves the import to a virtual-filesystem path string at
 *   runtime.
 *
 * Used by `script/build.ts` (single-file executable) and
 * `script/bundle.ts` (CJS library bundle) so the grep-worker source
 * in `src/lib/scan/worker-pool.ts` loads correctly in both dev and
 * compiled builds (`text` branch). The `file` branch is kept for
 * future use; today no source file goes through it.
 */

import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { basename, dirname, resolve as resolvePath } from "node:path";
import type { Plugin } from "esbuild";

const TEXT_IMPORT_NS = "text-import";
const ANY_FILTER = /.*/;

export const textImportPlugin: Plugin = {
  name: "text-import",
  setup(build) {
    build.onResolve({ filter: ANY_FILTER }, (args) => {
      if (args.with?.type === "text") {
        return {
          path: resolvePath(args.resolveDir, args.path),
          namespace: TEXT_IMPORT_NS,
        };
      }
      if (args.with?.type === "file") {
        // Copy the source into the bundle's output directory and
        // rewrite the import path so it sits next to the bundle.
        // esbuild keeps the import external (preserving the
        // `with { type: "file" }` clause) so Bun.compile can pick
        // it up from the new location. The copy is needed because
        // Bun.compile resolves imports relative to the bundle file's
        // directory at compile time, not the original source.
        //
        // `mkdirSync` guards against the bundle's `outdir` not yet
        // existing when the plugin fires — esbuild creates the
        // outdir lazily on first write.
        const sourcePath = resolvePath(args.resolveDir, args.path);
        const outdir = build.initialOptions.outdir
          ? resolvePath(build.initialOptions.outdir)
          : dirname(resolvePath(build.initialOptions.outfile ?? "."));
        const filename = basename(sourcePath);
        const copyPath = resolvePath(outdir, filename);
        try {
          mkdirSync(outdir, { recursive: true });
          copyFileSync(sourcePath, copyPath);
        } catch (err) {
          // Surface the failure so the build fails visibly rather
          // than producing a binary that crashes at startup.
          throw new Error(
            `text-import-plugin: failed to copy ${sourcePath} → ${copyPath}: ${
              err instanceof Error ? err.message : String(err)
            }`
          );
        }
        return {
          path: `./${filename}`,
          external: true,
        };
      }
      return null;
    });
    build.onLoad({ filter: ANY_FILTER, namespace: TEXT_IMPORT_NS }, (args) => {
      const content = readFileSync(args.path, "utf-8");
      return {
        contents: `export default ${JSON.stringify(content)};`,
        loader: "js",
      };
    });
  },
};
