#!/usr/bin/env bun
/**
 * Bundle script for npm package
 *
 * Creates a single-file Node.js bundle using esbuild.
 * Injects Bun polyfills for Node.js compatibility.
 * Uploads source maps to Sentry when SENTRY_AUTH_TOKEN is available.
 *
 * Usage:
 *   bun run script/bundle.ts
 *
 * Output:
 *   dist/bin.cjs - Minified, single-file bundle for npm
 */
import { sentryEsbuildPlugin } from "@sentry/esbuild-plugin";
import { build, type Plugin } from "esbuild";
import pkg from "../package.json";

const VERSION = pkg.version;
const SENTRY_CLIENT_ID = process.env.SENTRY_CLIENT_ID ?? "";

console.log(`\nBundling sentry v${VERSION} for npm`);
console.log("=".repeat(40));

if (!SENTRY_CLIENT_ID) {
  console.error("\nError: SENTRY_CLIENT_ID environment variable is required.");
  console.error("   The CLI requires OAuth to function.");
  console.error("   Set it via: SENTRY_CLIENT_ID=xxx bun run bundle\n");
  process.exit(1);
}

// Regex patterns for esbuild plugin (must be top-level for performance)
const BUN_SQLITE_FILTER = /^bun:sqlite$/;
const ANY_FILTER = /.*/;

// Plugin to replace bun:sqlite with our node:sqlite polyfill
const bunSqlitePlugin: Plugin = {
  name: "bun-sqlite-polyfill",
  setup(pluginBuild) {
    // Intercept imports of "bun:sqlite" and redirect to our polyfill
    pluginBuild.onResolve({ filter: BUN_SQLITE_FILTER }, () => ({
      path: "bun:sqlite",
      namespace: "bun-sqlite-polyfill",
    }));

    // Provide the polyfill content
    pluginBuild.onLoad(
      { filter: ANY_FILTER, namespace: "bun-sqlite-polyfill" },
      () => ({
        contents: `
          // Use the polyfill injected by node-polyfills.ts
          const polyfill = globalThis.__bun_sqlite_polyfill;
          export const Database = polyfill.Database;
          export default polyfill;
        `,
        loader: "js",
      })
    );
  },
};

// Configure Sentry plugin for source map uploads (production builds only)
const plugins: Plugin[] = [bunSqlitePlugin];

if (process.env.SENTRY_AUTH_TOKEN) {
  console.log("  Sentry auth token found, source maps will be uploaded");
  plugins.push(
    sentryEsbuildPlugin({
      org: "sentry",
      project: "cli",
      authToken: process.env.SENTRY_AUTH_TOKEN,
      release: {
        name: VERSION,
      },
      sourcemaps: {
        filesToDeleteAfterUpload: ["dist/**/*.map"],
      },
      // Don't fail the build if source map upload fails
      errorHandler: (err) => {
        console.warn("  Warning: Source map upload failed:", err.message);
      },
    })
  );
} else {
  console.log("  No SENTRY_AUTH_TOKEN, skipping source map upload");
}

const result = await build({
  entryPoints: ["./src/bin.ts"],
  bundle: true,
  minify: true,
  // Replace @sentry/bun with @sentry/node for Node.js npm package
  alias: {
    "@sentry/bun": "@sentry/node",
  },
  banner: {
    // Suppress Node.js warnings (e.g., SQLite experimental) - not useful for CLI users
    js: `#!/usr/bin/env node
{let e=process.emit;process.emit=function(n,...a){return n==="warning"?!1:e.apply(this,[n,...a])}}`,
  },
  sourcemap: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  outfile: "./dist/bin.cjs",
  // Inject Bun polyfills and import.meta.url shim for CJS compatibility
  inject: ["./script/node-polyfills.ts", "./script/import-meta-url.js"],
  define: {
    SENTRY_CLI_VERSION: JSON.stringify(VERSION),
    SENTRY_CLIENT_ID_BUILD: JSON.stringify(SENTRY_CLIENT_ID),
    "process.env.NODE_ENV": JSON.stringify("production"),
    // Replace import.meta.url with the injected shim variable for CJS
    "import.meta.url": "import_meta_url",
  },
  // Only externalize Node.js built-ins - bundle all npm packages
  external: ["node:*"],
  metafile: true,
  plugins,
});

// Calculate bundle size (only the main bundle, not source maps)
const bundleOutput = result.metafile?.outputs["dist/bin.cjs"];
const bundleSize = bundleOutput?.bytes ?? 0;
const bundleSizeKB = (bundleSize / 1024).toFixed(1);

console.log(`\n  -> dist/bin.cjs (${bundleSizeKB} KB)`);
console.log(`\n${"=".repeat(40)}`);
console.log("Bundle complete!");
