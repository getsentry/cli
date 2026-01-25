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

// TODO: Set SENTRY_DSN in CI environment for production builds
// This DSN is for the CLI's own telemetry, not user projects
const SENTRY_DSN = process.env.SENTRY_DSN ?? "";

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
  format: "esm",
  outfile: "./dist/bin.mjs",
  inject: ["./script/node-polyfills.ts"],
  define: {
    SENTRY_CLI_VERSION: JSON.stringify(VERSION),
    SENTRY_CLIENT_ID_BUILD: JSON.stringify(SENTRY_CLIENT_ID),
    SENTRY_DSN_BUILD: JSON.stringify(SENTRY_DSN),
  },
  // Externalize Node.js built-ins and @sentry/node (has native dependencies)
  external: ["node:*", "@sentry/node", "@opentelemetry/*"],
  metafile: true,
});

// Calculate bundle size
const outputs = Object.values(result.metafile?.outputs || {});
const bundleSize = outputs.reduce((sum, out) => sum + out.bytes, 0);
const bundleSizeKB = (bundleSize / 1024).toFixed(1);

console.log(`\n  -> dist/bin.mjs (${bundleSizeKB} KB)`);
console.log(`\n${"=".repeat(40)}`);
console.log("Bundle complete!");
