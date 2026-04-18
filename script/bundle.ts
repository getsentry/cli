#!/usr/bin/env bun
import { unlink } from "node:fs/promises";
import { build, type Plugin } from "esbuild";
import pkg from "../package.json";
import { uploadSourcemaps } from "../src/lib/api/sourcemaps.js";
import { injectDebugId, PLACEHOLDER_DEBUG_ID } from "./debug-id.js";

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

/** Plugin to replace bun:sqlite with our node:sqlite polyfill. */
const bunSqlitePlugin: Plugin = {
  name: "bun-sqlite-polyfill",
  setup(pluginBuild) {
    pluginBuild.onResolve({ filter: BUN_SQLITE_FILTER }, () => ({
      path: "bun:sqlite",
      namespace: "bun-sqlite-polyfill",
    }));

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

type InjectedFile = { jsPath: string; mapPath: string; debugId: string };

/** Delete .map files after a successful upload — they shouldn't ship to users. */
async function deleteMapFiles(injected: InjectedFile[]): Promise<void> {
  for (const { mapPath } of injected) {
    try {
      await unlink(mapPath);
    } catch {
      // Ignore — file might already be gone
    }
  }
}

/** Inject debug IDs into JS outputs and their companion sourcemaps. */
async function injectDebugIdsForOutputs(
  jsFiles: string[]
): Promise<InjectedFile[]> {
  const injected: InjectedFile[] = [];
  for (const jsPath of jsFiles) {
    const mapPath = `${jsPath}.map`;
    try {
      const { debugId } = await injectDebugId(jsPath, mapPath, {
        skipSnippet: true,
      });
      injected.push({ jsPath, mapPath, debugId });
      console.log(`  Debug ID injected: ${debugId}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(
        `  Warning: Debug ID injection failed for ${jsPath}: ${msg}`
      );
    }
  }
  return injected;
}

/**
 * Upload injected sourcemaps to Sentry via the chunk-upload protocol.
 *
 * @returns `true` if upload succeeded, `false` if it failed (non-fatal).
 */
async function uploadInjectedSourcemaps(
  injected: InjectedFile[]
): Promise<boolean> {
  try {
    console.log("  Uploading sourcemaps to Sentry...");
    await uploadSourcemaps({
      org: "sentry",
      project: "cli",
      release: VERSION,
      files: injected.flatMap(({ jsPath, mapPath, debugId }) => {
        const jsName = jsPath.split("/").pop() ?? "bin.cjs";
        const mapName = mapPath.split("/").pop() ?? "bin.cjs.map";
        return [
          {
            path: jsPath,
            debugId,
            type: "minified_source" as const,
            url: `~/${jsName}`,
            sourcemapFilename: mapName,
          },
          {
            path: mapPath,
            debugId,
            type: "source_map" as const,
            url: `~/${mapName}`,
          },
        ];
      }),
    });
    console.log("  Sourcemaps uploaded to Sentry");
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`  Warning: Sourcemap upload failed: ${msg}`);
    return false;
  }
}

/**
 * esbuild plugin that injects debug IDs and uploads sourcemaps to Sentry.
 *
 * Runs after esbuild finishes bundling (onEnd hook):
 * 1. Injects debug IDs into each JS output + its companion .map
 * 2. Uploads all artifacts to Sentry via the chunk-upload protocol
 * 3. Deletes .map files after upload (they shouldn't ship to users)
 *
 * Replaces `@sentry/esbuild-plugin` with zero external dependencies.
 */
const sentrySourcemapPlugin: Plugin = {
  name: "sentry-sourcemap",
  setup(pluginBuild) {
    pluginBuild.onEnd(async (buildResult) => {
      const outputs = Object.keys(buildResult.metafile?.outputs ?? {});
      const jsFiles = outputs.filter(
        (p) => p.endsWith(".cjs") || (p.endsWith(".js") && !p.endsWith(".map"))
      );

      if (jsFiles.length === 0) {
        return;
      }

      const injected = await injectDebugIdsForOutputs(jsFiles);
      if (injected.length === 0) {
        return;
      }

      // Replace the placeholder UUID with the real debug ID in each JS output.
      // Both are 36-char UUIDs so sourcemap character positions stay valid.
      for (const { jsPath, debugId } of injected) {
        const content = await Bun.file(jsPath).text();
        await Bun.write(
          jsPath,
          content.split(PLACEHOLDER_DEBUG_ID).join(debugId)
        );
      }

      if (!process.env.SENTRY_AUTH_TOKEN) {
        return;
      }

      const uploaded = await uploadInjectedSourcemaps(injected);

      // Only delete .map files after a successful upload — preserving
      // them on failure allows retrying without a full rebuild.
      if (uploaded) {
        await deleteMapFiles(injected);
      }
    });
  },
};

// Always inject debug IDs (even without auth token); upload is gated inside the plugin
const plugins: Plugin[] = [bunSqlitePlugin, sentrySourcemapPlugin];

if (process.env.SENTRY_AUTH_TOKEN) {
  console.log("  Sentry auth token found, source maps will be uploaded");
} else {
  console.log(
    "  No SENTRY_AUTH_TOKEN, debug IDs will be injected but source maps will not be uploaded"
  );
}

const result = await build({
  entryPoints: ["./src/index.ts"],
  bundle: true,
  minify: true,
  // No banner — warning suppression moved to dist/bin.cjs (CLI-only).
  // The library bundle must not suppress the host application's warnings.
  sourcemap: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  outfile: "./dist/index.cjs",
  // Inject Bun polyfills and import.meta.url shim for CJS compatibility
  inject: ["./script/node-polyfills.ts", "./script/import-meta-url.js"],
  define: {
    SENTRY_CLI_VERSION: JSON.stringify(VERSION),
    SENTRY_CLIENT_ID_BUILD: JSON.stringify(SENTRY_CLIENT_ID),
    "process.env.NODE_ENV": JSON.stringify("production"),
    __SENTRY_DEBUG_ID__: JSON.stringify(PLACEHOLDER_DEBUG_ID),
    // Replace import.meta.url with the injected shim variable for CJS
    "import.meta.url": "import_meta_url",
  },
  // Only externalize Node.js built-ins - bundle all npm packages
  external: ["node:*"],
  metafile: true,
  plugins,
});

// Write the CLI bin wrapper (tiny — shebang + version check + dispatch)
const BIN_WRAPPER = `#!/usr/bin/env node
if(parseInt(process.versions.node)<22){console.error("Error: sentry requires Node.js 22 or later (found "+process.version+").\\n\\nEither upgrade Node.js, or install the standalone binary instead:\\n  curl -fsSL https://cli.sentry.dev/install | bash\\n");process.exit(1)}
{let e=process.emit;process.emit=function(n,...a){return n==="warning"?!1:e.apply(this,[n,...a])}}
require('./index.cjs')._cli().catch(()=>{process.exitCode=1});
`;
await Bun.write("./dist/bin.cjs", BIN_WRAPPER);

// Write TypeScript declarations for the library API.
// The SentrySDK type is read from sdk.generated.d.cts (produced by generate-sdk.ts).
const CORE_DECLARATIONS = `export type SentryOptions = {
  /** Auth token. Auto-filled from SENTRY_AUTH_TOKEN / SENTRY_TOKEN env vars. */
  token?: string;
  /** Sentry instance URL for self-hosted. Defaults to sentry.io. */
  url?: string;
  /** Default organization slug. */
  org?: string;
  /** Default project slug. */
  project?: string;
  /** Return human-readable text instead of parsed JSON. */
  text?: boolean;
  /** Working directory (affects DSN detection, project root). Defaults to process.cwd(). */
  cwd?: string;
  /** AbortSignal to cancel streaming commands (e.g. log list --follow). */
  signal?: AbortSignal;
};

export type AsyncChannel<T> = AsyncIterable<T> & {
  push(value: T): void;
  close(): void;
  error(err: Error): void;
};

export declare class SentryError extends Error {
  readonly exitCode: number;
  readonly stderr: string;
  constructor(message: string, exitCode: number, stderr: string);
}

export declare function createSentrySDK(options?: SentryOptions): SentrySDK & {
  /** Run an arbitrary CLI command (escape hatch). Streaming flags return AsyncIterable. */
  run(...args: string[]): Promise<unknown> | AsyncIterable<unknown>;
};

export default createSentrySDK;
`;

// Read pre-built SDK type declarations (generated by generate-sdk.ts)
const sdkTypes = await Bun.file("./src/sdk.generated.d.cts").text();

const TYPE_DECLARATIONS = `${CORE_DECLARATIONS}\n${sdkTypes}\n`;
await Bun.write("./dist/index.d.cts", TYPE_DECLARATIONS);

console.log("  -> dist/bin.cjs (CLI wrapper)");
console.log("  -> dist/index.d.cts (type declarations)");

// Calculate bundle size (only the main bundle, not source maps)
const bundleOutput = result.metafile?.outputs["dist/index.cjs"];
const bundleSize = bundleOutput?.bytes ?? 0;
const bundleSizeKB = (bundleSize / 1024).toFixed(1);

console.log(`\n  -> dist/index.cjs (${bundleSizeKB} KB)`);
console.log(`\n${"=".repeat(40)}`);
console.log("Bundle complete!");
