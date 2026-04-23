/**
 * esbuild plugin that polyfills Bun's `with { type: "text" }` import
 * attribute (esbuild only supports `json`). Intercepts matching
 * imports, reads the file, and default-exports its contents as a
 * string. Runtime behavior matches Bun's native handling.
 *
 * Used by `script/build.ts` (single-file executable) and
 * `script/bundle.ts` (CJS library bundle) so the grep-worker source
 * in `src/lib/scan/worker-pool.ts` loads correctly in both dev and
 * compiled builds.
 */

import { readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import type { Plugin } from "esbuild";

const TEXT_IMPORT_NS = "text-import";
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
