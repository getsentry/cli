/**
 * esbuild plugin that polyfills Bun's `with { type: "text" }` and
 * `with { type: "file" }` import attributes (esbuild only supports
 * `json`).
 *
 * - `text` — intercepts the import, reads the file, and default-
 *   exports its contents as a string. Runtime behavior matches Bun's
 *   native handling.
 * - `file` — pre-bundles the source file (TypeScript/TSX → JS) into
 *   a self-contained module and writes it into the esbuild output
 *   directory, then marks the import external so the
 *   `with { type: "file" }` clause survives in the bundled JS.
 *   Bun.compile downstream understands the attribute natively,
 *   embeds the file as a binary asset, and resolves the import to a
 *   virtual-filesystem path string at runtime.
 *
 *   The pre-bundle step is critical for two reasons:
 *
 *   1. Bun's `/$bunfs/` virtual filesystem parses embedded files
 *      with its JavaScript parser, not its TypeScript parser, so
 *      raw `.tsx` files fail with `SyntaxError` on
 *      `import { type Foo }` and similar TS-only syntax.
 *   2. The embedded file runs from `/$bunfs/root/` at runtime,
 *      where neither `node_modules` nor sibling source files
 *      exist. Bundling inlines ALL dependencies (local modules
 *      like `ink-frame.tsx` and third-party packages like `ink`,
 *      `react`) so the file is fully self-contained.
 *
 *   Non-TypeScript files (plain `.js`) are copied verbatim.
 *
 * Used by `script/build.ts` (single-file executable) and
 * `script/bundle.ts` (CJS library bundle). The `text` branch
 * handles `with { type: "text" }` imports (e.g. worker source).
 * The `file` branch handles the Ink app component embedded via
 * `with { type: "file" }` in `src/lib/init/ui/ink-ui.ts`.
 */

import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { basename, dirname, extname, resolve as resolvePath } from "node:path";
import { build as esbuildBuild, type Plugin } from "esbuild";

const TEXT_IMPORT_NS = "text-import";
const ANY_FILTER = /.*/;

/** Extensions that need TypeScript/JSX transpilation before embedding. */
const TS_EXTENSIONS = new Set([".ts", ".tsx", ".jsx"]);

/**
 * Banner injected into the pre-bundled sidecar JS. Provides a real
 * `require` function so esbuild's CJS-wrapping `__require` shims can
 * resolve Node.js builtins (`assert`, `events`, etc.) at runtime.
 */
const REQUIRE_BANNER =
  'import { createRequire as ___cr } from "node:module";' +
  " var require = ___cr(import.meta.url);";

/**
 * Pre-bundle a TypeScript/TSX source file into a self-contained JS module.
 * All dependencies (local modules AND npm packages) are inlined;
 * only `node:*` builtins are external since Bun resolves them natively.
 */
async function prebundleTs(sourcePath: string, outPath: string): Promise<void> {
  await esbuildBuild({
    entryPoints: [sourcePath],
    bundle: true,
    outfile: outPath,
    platform: "node",
    target: "esnext",
    format: "esm",
    jsx: "automatic",
    external: ["node:*"],
    banner: { js: REQUIRE_BANNER },
    define: {
      "process.env.NODE_ENV": JSON.stringify("production"),
    },
    minify: false,
    write: true,
  });
}

/** Resolve the output directory from the parent esbuild config. */
function resolveOutdir(build: {
  initialOptions: { outdir?: string; outfile?: string };
}): string {
  return build.initialOptions.outdir
    ? resolvePath(build.initialOptions.outdir)
    : dirname(resolvePath(build.initialOptions.outfile ?? "."));
}

export const textImportPlugin: Plugin = {
  name: "text-import",
  setup(build) {
    build.onResolve({ filter: ANY_FILTER }, async (args) => {
      if (args.with?.type === "text") {
        return {
          path: resolvePath(args.resolveDir, args.path),
          namespace: TEXT_IMPORT_NS,
        };
      }
      if (args.with?.type === "file") {
        const sourcePath = resolvePath(args.resolveDir, args.path);
        const outdir = resolveOutdir(build);
        mkdirSync(outdir, { recursive: true });

        const ext = extname(sourcePath);
        const outFilename = `${basename(sourcePath, ext)}.js`;
        const outPath = resolvePath(outdir, outFilename);

        try {
          if (TS_EXTENSIONS.has(ext)) {
            await prebundleTs(sourcePath, outPath);
          } else {
            copyFileSync(sourcePath, outPath);
          }
        } catch (err) {
          throw new Error(
            `text-import-plugin: failed to process ${sourcePath} → ${outPath}: ${
              err instanceof Error ? err.message : String(err)
            }`
          );
        }

        return { path: `./${outFilename}`, external: true };
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
