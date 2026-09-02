import { createRequire } from "node:module";

const _require = createRequire(import.meta.url);

/**
 * Return bytes embedded in a Node single-executable application, if any.
 *
 * `node:sea` cannot be imported in ordinary Node processes, so load it lazily
 * and let callers use their normal package/development fallback when absent.
 */
export function getSeaRawAsset(key: string): Uint8Array | undefined {
  try {
    const sea = _require("node:sea") as {
      isSea?: () => boolean;
      getRawAsset?: (key: string) => ArrayBuffer;
    };
    if (sea.isSea?.() && sea.getRawAsset) {
      return new Uint8Array(sea.getRawAsset(key));
    }
  } catch {
    // `node:sea` is unavailable outside a SEA executable.
  }
  return;
}
