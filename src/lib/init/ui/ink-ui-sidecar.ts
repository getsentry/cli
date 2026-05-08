/**
 * Compiled-binary sidecar loader for the Ink App.
 *
 * This module is ONLY imported in the compiled Bun binary. It must
 * NOT be imported in dev mode (`bun run src/bin.ts`) because the
 * `with { type: "file" }` static import poisons the Bun module cache
 * for ink-app.tsx — any later import() of that path gets the path
 * string back instead of the module, breaking mountApp.
 *
 * The text-import-plugin pre-bundles ink-app.tsx → ink-app.js during
 * the esbuild step, so the embedded virtual-FS file is self-contained
 * plain JS that Bun can evaluate at runtime.
 */
// @ts-expect-error: `with { type: "file" }` is Bun-specific and not yet typed in @types/bun
import inkAppPath from "./ink-app.tsx" with { type: "file" };

export function loadInkApp(): Promise<typeof import("./ink-app.js")> {
  return import(inkAppPath as string) as Promise<typeof import("./ink-app.js")>;
}
