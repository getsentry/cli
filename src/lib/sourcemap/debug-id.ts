/**
 * Debug ID injection for JavaScript sourcemaps.
 *
 * Injects Sentry debug IDs into JavaScript files and their companion
 * sourcemaps for reliable server-side stack trace resolution. Debug IDs
 * replace fragile filename/release-based sourcemap matching with a
 * deterministic UUID embedded in both the JS file and its sourcemap.
 *
 * The UUID algorithm and runtime snippet are byte-for-byte compatible
 * with `@sentry/bundler-plugin-core`'s `stringToUUID` and
 * `getDebugIdSnippet` — see ECMA-426 (Source Map Format) for the spec.
 */

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

/** Comment prefix used to identify an existing debug ID in a JS file. */
const DEBUGID_COMMENT_PREFIX = "//# debugId=";

/** Regex to extract an existing debug ID from a JS file. */
/** Regex to extract an existing debug ID from a JS file. @internal */
export const EXISTING_DEBUGID_RE = /\/\/# debugId=([0-9a-fA-F-]{36})/;

/**
 * Generate a deterministic debug ID (UUID v4 format) from content.
 *
 * Computes SHA-256 of the input, then formats the first 128 bits as a
 * UUID v4 string. Matches `@sentry/bundler-plugin-core`'s `stringToUUID`
 * exactly — position 12 is forced to `4` (version), and position 16 is
 * forced to one of `8/9/a/b` (variant, RFC 4122 §4.4).
 *
 * @param content - File content (string or Buffer) to hash
 * @returns UUID v4 string, e.g. `"a1b2c3d4-e5f6-4789-abcd-ef0123456789"`
 */
export function contentToDebugId(content: string | Buffer): string {
  const hash = createHash("sha256").update(content).digest("hex");
  // Position 16 (first char of 5th group in the hash) determines the
  // variant nibble. charCodeAt(0) of a hex digit is deterministic.
  const v4variant = ["8", "9", "a", "b"][
    hash.substring(16, 17).charCodeAt(0) % 4
  ];
  return `${hash.substring(0, 8)}-${hash.substring(8, 12)}-4${hash.substring(13, 16)}-${v4variant}${hash.substring(17, 20)}-${hash.substring(20, 32)}`.toLowerCase();
}

/**
 * Build the runtime IIFE snippet that registers a debug ID in
 * `globalThis._sentryDebugIds`.
 *
 * At runtime, the Sentry SDK reads this map (keyed by Error stack traces)
 * to associate stack frames with their debug IDs, which are then used to
 * look up the correct sourcemap on the server.
 *
 * The snippet is a single-line IIFE so it only adds one line to the
 * sourcemap mappings offset.
 *
 * @param debugId - The UUID to embed
 * @returns Minified IIFE string (single line, starts with `;`)
 */
export function getDebugIdSnippet(debugId: string): string {
  return `;!function(){try{var e="undefined"!=typeof window?window:"undefined"!=typeof global?global:"undefined"!=typeof globalThis?globalThis:"undefined"!=typeof self?self:{},n=(new e.Error).stack;n&&(e._sentryDebugIds=e._sentryDebugIds||{},e._sentryDebugIds[n]="${debugId}",e._sentryDebugIdIdentifier="sentry-dbid-${debugId}")}catch(e){}}();`;
}

/**
 * Inject a Sentry debug ID into a JavaScript file and its companion
 * sourcemap.
 *
 * By default performs four mutations:
 * 1. Prepends the runtime snippet to the JS file (after any hashbang)
 * 2. Appends a `//# debugId=<uuid>` comment to the JS file
 * 3. Prepends a `;` to the sourcemap `mappings` (offsets by one line)
 * 4. Adds `debug_id` and `debugId` fields to the sourcemap JSON
 *
 * When `options.skipSnippet` is `true`, step 1 is skipped and step 3
 * is adjusted (no extra `;` prefix since no snippet line is added).
 * This is used by the CLI's own build pipeline where the debug ID is
 * registered in source code (`constants.ts`) instead of via the IIFE.
 *
 * The operation is **idempotent** — files that already contain a
 * `//# debugId=` comment are returned unchanged.
 *
 * @param jsPath - Path to the JavaScript file
 * @param mapPath - Path to the companion `.map` file
 * @param options - Optional settings
 * @param options.skipSnippet - Skip the IIFE runtime snippet (steps 1 & 3)
 * @returns The debug ID and whether it was newly injected
 */
export async function injectDebugId(
  jsPath: string,
  mapPath: string,
  options?: { skipSnippet?: boolean }
): Promise<{ debugId: string; wasInjected: boolean }> {
  const [jsContent, mapContent] = await Promise.all([
    readFile(jsPath, "utf-8"),
    readFile(mapPath, "utf-8"),
  ]);

  // Idempotent: if the JS file already has a debug ID, extract and return it
  const existingMatch = jsContent.match(EXISTING_DEBUGID_RE);
  if (existingMatch?.[1]) {
    return { debugId: existingMatch[1], wasInjected: false };
  }

  // Generate debug ID from the sourcemap content (deterministic)
  const debugId = contentToDebugId(mapContent);
  const skipSnippet = options?.skipSnippet ?? false;

  // --- Mutate JS file ---
  let newJs: string;
  if (skipSnippet) {
    // Metadata-only mode: just append the debugId comment, no IIFE snippet.
    // Used by the CLI's own build where the debug ID is registered in source.
    newJs = jsContent;
  } else {
    // Full mode: prepend the runtime IIFE snippet (for user-facing injection).
    const snippet = getDebugIdSnippet(debugId);
    // Preserve hashbang if present, insert snippet after it
    if (jsContent.startsWith("#!")) {
      const newlineIdx = jsContent.indexOf("\n");
      // Handle hashbang without trailing newline (entire file is the #! line)
      const splitAt = newlineIdx === -1 ? jsContent.length : newlineIdx + 1;
      const hashbang = jsContent.slice(0, splitAt);
      const rest = jsContent.slice(splitAt);
      const sep = newlineIdx === -1 ? "\n" : "";
      newJs = `${hashbang}${sep}${snippet}\n${rest}`;
    } else {
      newJs = `${snippet}\n${jsContent}`;
    }
  }
  // Append debug ID comment at the end
  newJs += `\n${DEBUGID_COMMENT_PREFIX}${debugId}\n`;

  // --- Mutate sourcemap ---
  // Parse, adjust mappings, add debug ID fields
  const map = JSON.parse(mapContent) as {
    mappings: string;
    sources?: (string | null)[];
    debug_id?: string;
    debugId?: string;
  };

  // Normalize Windows backslashes in the sources array so uploaded
  // sourcemaps have consistent forward-slash paths regardless of build
  // platform. Bundlers on Windows (esbuild, Bun) may produce paths like
  // "src\\bin.ts". No-op on Linux/macOS.
  if (map.sources) {
    map.sources = map.sources.map((s) => (s ? s.replaceAll("\\", "/") : s));
  }

  if (!skipSnippet) {
    // Prepend one `;` to mappings — tells decoders "no mappings for the
    // first line" (the injected snippet line). Each `;` in VLQ mappings
    // represents a line boundary.
    map.mappings = `;${map.mappings}`;
  }
  map.debug_id = debugId;
  map.debugId = debugId;

  // Write both files concurrently
  await Promise.all([
    writeFile(jsPath, newJs),
    writeFile(mapPath, JSON.stringify(map)),
  ]);

  return { debugId, wasInjected: true };
}
