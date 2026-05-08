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
import type { Plugin } from "esbuild";

const TEXT_IMPORT_NS = "text-import";
const ANY_FILTER = /.*/;

/** Extensions that need TypeScript/JSX transpilation before embedding. */
const TS_EXTENSIONS = new Set([".ts", ".tsx", ".jsx"]);

/**
 * Pre-bundle a TypeScript/TSX source file into a self-contained JS module
 * using Bun.build. All dependencies (local modules AND npm packages) are
 * inlined; Bun handles node:* builtins natively.
 *
 * Using Bun.build (rather than esbuild) is critical. esbuild wraps CJS
 * packages (e.g. `signal-exit`, `parse-keypress`) in `__commonJS` helpers.
 * When Bun.compile later embeds the esbuild output as a `with { type: "file"
 * }` asset, it injects `__promiseAll` helpers at wrong positions inside those
 * wrappers, causing `SyntaxError: Unexpected identifier '__promiseAll'` at
 * runtime on all platforms. Bun.build produces output that Bun.compile
 * recognises natively and handles without mis-injecting the helper.
 */
async function prebundleTs(sourcePath: string, outPath: string): Promise<void> {
  const result = await Bun.build({
    entrypoints: [sourcePath],
    target: "bun",
    outdir: dirname(outPath),
    naming: "[name].js",
    define: {
      "process.env.NODE_ENV": JSON.stringify("production"),
    },
    minify: false,
  });
  if (!result.success) {
    throw new Error(
      result.logs.map((l) => String(l)).join("\n") || "unknown error"
    );
  }
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
