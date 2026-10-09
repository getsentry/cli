/**
 * ESM preload shim for tsx dev mode.
 *
 * 1. Provides a global `require()` for ESM modules in `"type": "module"`
 *    packages. Anchored at the project root — works for `node:*` builtins
 *    and npm packages. Files that need relative `require()` must use a
 *    file-local `createRequire(import.meta.url)` instead.
 *
 * 2. Handles `with { type: "file" }` import attributes that Node.js doesn't
 *    support natively. Registers a loader hook that returns the file path
 *    as a string — matching Bun's native behaviour.
 *
 * Usage: NODE_OPTIONS="--import ./script/require-shim.mjs" tsx script/...
 * Or in package.json scripts via the `pnpm tsx` alias.
 */

import { createRequire, register } from "node:module";

if (typeof globalThis.require === "undefined") {
  globalThis.require = createRequire(
    new URL("../package.json", import.meta.url)
  );
}

// Use an asynchronous hook so existing CommonJS loaders may omit `source`.
// Node 24 rejects that valid asynchronous result when it passes through a
// synchronous hook.
register(new URL("./file-import-hook.mjs", import.meta.url));
