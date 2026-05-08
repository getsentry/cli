/**
 * Compiled-binary sidecar loader for the Ink App.
 *
 * Only imported in the compiled Bun binary (when import.meta.url
 * contains /$bunfs/). In dev mode this module is never loaded, so the
 * `with { type: "file" }` static import never runs and the Bun module
 * cache for ink-app.tsx is never poisoned — which would cause any
 * subsequent import() of that path to return the path string instead
 * of the module.
 */
// @ts-expect-error: `with { type: "file" }` is Bun-specific and not yet typed in @types/bun
import inkAppPath from "./ink-app.tsx" with { type: "file" };

export function loadInkApp(): Promise<typeof import("./ink-app.js")> {
  return import(inkAppPath as string) as Promise<typeof import("./ink-app.js")>;
}
