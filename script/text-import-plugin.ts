/**
 * esbuild plugin that polyfills Bun's `with { type: "text" }` import
 * attribute.
 *
 * esbuild doesn't natively support the `text` import attribute (only
 * `json`), but Bun does. Our CLI code uses it to load the grep worker
 * source as a string at bundle time (see
 * `src/lib/scan/worker-pool.ts`). Without this plugin, esbuild errors
 * with `Importing with a type attribute of "text" is not supported`
 * on any file that imports a sibling `.js` as text.
 *
 * The plugin intercepts imports whose `with` attribute matches
 * `{ type: "text" }`, reads the file from disk, and emits it as a JS
 * module that default-exports the file's contents as a string.
 * Runtime behavior matches Bun's native handling, so the same source
 * works in dev (via `bun run`) and in compiled binaries (esbuild +
 * `bun build --compile` two-step).
 *
 * Used by both `script/build.ts` (single-file executable) and
 * `script/bundle.ts` (CJS library bundle for npm).
 */

import { readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import type { Plugin } from "esbuild";

const TEXT_IMPORT_NS = "text-import";
/** Match-any filter for esbuild's plugin API. Hoisted for top-level-regex lint. */
const ANY_FILTER = /.*/;

export const textImportPlugin: Plugin = {
  name: "text-import",
  setup(build) {
    build.onResolve({ filter: ANY_FILTER }, (args) => {
      if (args.with?.type !== "text") {
        return null;
      }
      return {
        path: resolvePath(args.resolveDir, args.path),
        namespace: TEXT_IMPORT_NS,
      };
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
