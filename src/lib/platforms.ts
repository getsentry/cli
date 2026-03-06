/**
 * Sentry platform identifiers and normalization utilities.
 *
 * The Sentry project-creation API accepts a curated set of ~120 platform
 * identifiers (defined in sentry/src/sentry/utils/platform_categories.py).
 * These use hyphen-separated format (e.g. `javascript-nextjs`).
 *
 * The release-registry (https://release-registry.services.sentry.io/sdks)
 * uses dot-separated SDK keys (e.g. `sentry.javascript.node`) which do NOT
 * correspond 1:1 with API platform identifiers. For example:
 *   - Registry: `sentry.javascript.node`  → API platform: `node`
 *   - Registry: `sentry.javascript.nextjs` → API platform: `javascript-nextjs`
 *
 * The server-side AI agent sometimes generates identifiers that mix these
 * namespaces (e.g. `javascript-node` instead of `node`). The normalization
 * functions here handle these mismatches.
 */

/**
 * Common Sentry platform identifiers shown when platform arg is missing or
 * invalid.
 *
 * This is a curated subset of the ~120 supported values — the full list is
 * available via the Sentry API.
 */
export const PLATFORMS = [
  "javascript",
  "javascript-react",
  "javascript-nextjs",
  "javascript-vue",
  "javascript-angular",
  "javascript-svelte",
  "javascript-remix",
  "javascript-astro",
  "node",
  "node-express",
  "python",
  "python-django",
  "python-flask",
  "python-fastapi",
  "go",
  "ruby",
  "ruby-rails",
  "php",
  "php-laravel",
  "java",
  "android",
  "dotnet",
  "react-native",
  "apple-ios",
  "rust",
  "elixir",
  "bun",
] as const;

const PLATFORM_SET: ReadonlySet<string> = new Set(PLATFORMS);

/**
 * Map of AI-generated platform identifiers that don't match the Sentry API
 * platform registry. Built from observed mismatches between the SDK release
 * registry keys (dot-notation) and the API's accepted platform values.
 *
 * The AI agent often derives identifiers from registry keys like
 * `sentry.javascript.node` → `javascript-node`, but the API expects `node`.
 */
const PLATFORM_ALIASES: Record<string, string> = {
  // Node.js variants — API platform is `node`, not `javascript-node`
  "javascript-node": "node",
  "javascript-express": "node-express",
  "javascript-hono": "node",
  "javascript-koa": "node",
  "javascript-fastify": "node",
  "javascript-nest": "node",
  "javascript-nestjs": "node",
  "javascript-connect": "node",
  // Node sub-framework variants
  "node-hono": "node",
  "node-koa": "node",
  "node-fastify": "node",
  "node-nestjs": "node",
  "node-nest": "node",
  "node-connect": "node",
  // Bun
  "javascript-bun": "bun",
  // React Native — API uses `react-native`, not `javascript-react-native`
  "javascript-react-native": "react-native",
  // Browser SDK — API uses `javascript`, not `javascript-browser`
  "javascript-browser": "javascript",
  // Electron — API uses `electron`
  "javascript-electron": "electron",
  // Capacitor
  "javascript-capacitor": "capacitor",
};

/**
 * Normalize a platform identifier to a valid Sentry API platform value.
 *
 * Handles:
 * 1. Dot-to-hyphen correction (e.g. `javascript.nextjs` → `javascript-nextjs`)
 * 2. Known alias mapping (e.g. `javascript-node` → `node`)
 * 3. Already-valid platforms pass through unchanged
 *
 * Returns the normalized platform, or the original value if no mapping is
 * found (the API will validate and return a clear error).
 */
export function normalizePlatform(platform: string): string {
  // Step 1: Normalize dots to hyphens (common copy-paste from docs URLs)
  let normalized = platform.includes(".")
    ? platform.replace(/\./g, "-")
    : platform;

  // Step 2: Strip `sentry-` prefix if present (from full registry keys)
  if (normalized.startsWith("sentry-")) {
    normalized = normalized.slice("sentry-".length);
  }

  // Step 3: If already a valid platform, return as-is
  if (PLATFORM_SET.has(normalized)) {
    return normalized;
  }

  // Step 4: Check alias map
  const alias = PLATFORM_ALIASES[normalized];
  if (alias) {
    return alias;
  }

  // Step 5: No match — return as-is and let the API validate
  return normalized;
}
