#!/usr/bin/env bun
/**
 * Bundle script for npm package
 *
 * Creates a single-file Node.js bundle using esbuild.
 * Injects Bun polyfills for Node.js compatibility.
 *
 * Usage:
 *   bun run script/bundle.ts
 *
 * Output:
 *   dist/bin.mjs - Minified, single-file bundle for npm
 */
import { build } from "esbuild";
import pkg from "../package.json";

const VERSION = pkg.version;
const SENTRY_CLIENT_ID = process.env.SENTRY_CLIENT_ID ?? "";

// DSN for CLI telemetry (not user projects) - safe to hardcode as it's public
const SENTRY_DSN =
  "https://1188a86f3f8168f089450587b00bca66@o1.ingest.us.sentry.io/4510776311808000";

console.log(`\nBundling sentry v${VERSION} for npm`);
console.log("=".repeat(40));

if (!SENTRY_CLIENT_ID) {
  console.error("\nError: SENTRY_CLIENT_ID environment variable is required.");
  console.error("   The CLI requires OAuth to function.");
  console.error("   Set it via: SENTRY_CLIENT_ID=xxx bun run bundle\n");
  process.exit(1);
}

const result = await build({
  entryPoints: ["./src/bin.ts"],
  bundle: true,
  minify: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  outfile: "./dist/bin.cjs",
  inject: ["./script/node-polyfills.ts"],
  define: {
    SENTRY_CLI_VERSION: JSON.stringify(VERSION),
    SENTRY_CLIENT_ID_BUILD: JSON.stringify(SENTRY_CLIENT_ID),
    SENTRY_DSN_BUILD: JSON.stringify(SENTRY_DSN),
  },
  // Only externalize Node.js built-ins - bundle all npm packages
  external: ["node:*"],
  metafile: true,
});

// Calculate bundle size
const outputs = Object.values(result.metafile?.outputs || {});
const bundleSize = outputs.reduce((sum, out) => sum + out.bytes, 0);
const bundleSizeKB = (bundleSize / 1024).toFixed(1);

console.log(`\n  -> dist/bin.cjs (${bundleSizeKB} KB)`);
console.log(`\n${"=".repeat(40)}`);
console.log("Bundle complete!");
