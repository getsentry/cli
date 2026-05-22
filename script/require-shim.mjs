/**
 * ESM preload shim that provides `require` in ESM modules.
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
 * Usage: NODE_OPTIONS="--import ./script/require-shim.mjs" tsx script/...
 * Or in package.json scripts via the `pnpm tsx` alias.
 */

import { createRequire } from "node:module";

if (typeof globalThis.require === "undefined") {
  globalThis.require = createRequire(
    new URL("../package.json", import.meta.url)
  );
}
