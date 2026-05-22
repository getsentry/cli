/**
 * ESM preload shim that provides `require` in ESM modules and handles
 * `with { type: "file" }` import attributes in tsx dev mode.
 *
 * The source code uses bare `require()` for lazy loading (circular dependency
 * breaking, optional features). This works natively in Bun and in the CJS
 * bundle, but fails under tsx/Node ESM. This shim bridges the gap by making
 * `require` globally available via `createRequire`.
 *
 * The `require` function is anchored at the project root (package.json) so
 * that `node:*` builtins and npm package requires resolve correctly. Note
 * that relative `require("./foo.js")` calls resolve from the project root,
 * not from the calling file. Files in `src/` that use lazy relative requires
 * must use a file-local `createRequire(import.meta.url)` instead of relying
 * on this global shim.
 *
 * `with { type: "file" }` import attributes are used to embed sidecar files
 * (e.g. the Ink UI app). Bun supports this natively; esbuild's
 * text-import-plugin handles it at build time. In tsx dev mode neither
 * applies, so we register a loader hook that returns the file path as a
 * string — matching Bun's native behaviour.
 *
 * Usage: NODE_OPTIONS="--import ./script/require-shim.mjs" tsx script/...
 * Or in package.json scripts via the `pnpm tsx` alias.
 */

import { createRequire, registerHooks } from "node:module";

if (typeof globalThis.require === "undefined") {
  globalThis.require = createRequire(
    new URL("../package.json", import.meta.url)
  );
}

// Handle `with { type: "file" }` import attributes in Node.js dev mode.
// Bun supports this natively; esbuild's text-import-plugin handles it at
// build time. In tsx dev mode neither applies, so we register a synchronous
// hook that returns the file path as a string — matching Bun's behaviour.
// registerHooks() is available from Node 22.15+ (our minimum).
registerHooks({
  load(url, context, nextLoad) {
    if (context.importAttributes?.type === "file") {
      return {
        format: "module",
        shortCircuit: true,
        source: `export default ${JSON.stringify(new URL(url).pathname)};`,
      };
    }
    return nextLoad(url, context);
  },
});
