#!/usr/bin/env bun
import { unlink } from "node:fs/promises";
import { build, type Plugin } from "esbuild";
import pkg from "../package.json";
import { uploadSourcemaps } from "../src/lib/api/sourcemaps.js";
import { injectDebugId } from "./debug-id.js";

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

// Regex patterns for SDK type extraction
/** Matches `export type FooParams = { ... };` blocks (multiline via dotAll) */
const EXPORTED_TYPE_BLOCK_RE = /^export type \w+Params = \{[^}]*\};/gms;

/** Matches method lines: `name: (params): Promise<T> =>` */
const SDK_METHOD_RE = /^(\s+)(\w+): \(([^)]*)\): (Promise<.+>)\s*=>$/;

/** Matches namespace opening: `  name: {` */
const SDK_NAMESPACE_RE = /^\s+\w+: \{$/;

/** Matches invoke call bodies to strip from output */
const SDK_INVOKE_RE = /^\s+invoke/;

/** Matches trailing comma before closing brace in method tree */
const TRAILING_COMMA_BRACE_RE = /},?$/;

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

/** Count net brace depth change in a line (`{` = +1, `}` = -1). */
function countBraces(line: string): number {
  let delta = 0;
  for (const ch of line) {
    if (ch === "{") {
      delta += 1;
    }
    if (ch === "}") {
      delta -= 1;
    }
  }
  return delta;
}

/**
 * Extract the method tree lines from `createSDKMethods` function body.
 * Returns lines between `return {` and the closing `}` of the function,
 * excluding the `return {` line itself.
 */
function extractMethodTreeLines(lines: string[]): string[] {
  const methodLines: string[] = [];
  let inMethodTree = false;
  let depth = 0;

  for (const line of lines) {
    if (line.includes("export function createSDKMethods")) {
      inMethodTree = true;
      depth = 0;
      continue;
    }
    if (!inMethodTree) {
      continue;
    }

    depth += countBraces(line);

    if (depth <= 0) {
      break;
    }
    if (line.trim() === "return {") {
      continue;
    }

    methodLines.push(line);
  }

  return methodLines;
}

/** Transform a method implementation line into a type declaration line. */
function transformMethodLine(line: string): string | null {
  const methodMatch = SDK_METHOD_RE.exec(line);
  if (methodMatch) {
    const [, indent, name, params, returnType] = methodMatch;
    return `${indent}${name}(${params}): ${returnType};`;
  }
  if (SDK_NAMESPACE_RE.test(line)) {
    return line;
  }
  if (line.trim().startsWith("}")) {
    return line.replace(TRAILING_COMMA_BRACE_RE, "};");
  }
  // JSDoc comments
  if (line.trim().startsWith("/**") || line.trim().startsWith("*")) {
    return line;
  }
  // Invoke call bodies — skip
  if (SDK_INVOKE_RE.test(line)) {
    return null;
  }
  return line;
}

/**
 * Extract parameter types and SentrySDK type from the generated SDK source.
 *
 * Parses `sdk.generated.ts` to produce standalone `.d.cts`-safe type declarations:
 * 1. All `export type XxxParams = { ... };` blocks (extracted verbatim)
 * 2. The `SentrySDK` type built from `createSDKMethods` return shape
 *    (method implementations → type signatures, invoke bodies stripped)
 */
function extractSdkTypes(source: string): string {
  const paramTypes = [...source.matchAll(EXPORTED_TYPE_BLOCK_RE)].map(
    (m) => m[0]
  );

  const methodLines = extractMethodTreeLines(source.split("\n"));
  const sdkBody = methodLines
    .map(transformMethodLine)
    .filter((l): l is string => l !== null)
    .join("\n");

  const sdkType = `export type SentrySDK = {\n${sdkBody}\n};`;
  return `${paramTypes.join("\n\n")}\n\n${sdkType}`;
}

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
      const { debugId } = await injectDebugId(jsPath, mapPath);
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
// The SentrySDK type is derived from sdk.generated.ts to stay in sync.
const CORE_DECLARATIONS = `export type SentryOptions = {
  /** Auth token. Auto-filled from SENTRY_AUTH_TOKEN / SENTRY_TOKEN env vars. */
  token?: string;
  /** Return human-readable text instead of parsed JSON. */
  text?: boolean;
  /** Working directory (affects DSN detection, project root). Defaults to process.cwd(). */
  cwd?: string;
};

export declare class SentryError extends Error {
  readonly exitCode: number;
  readonly stderr: string;
  constructor(message: string, exitCode: number, stderr: string);
}

export declare function sentry(...args: string[]): Promise<unknown>;
export declare function sentry(...args: [...string[], SentryOptions]): Promise<unknown>;

export { sentry };
export default sentry;

export declare function createSentrySDK(options?: SentryOptions): SentrySDK;
`;

// Extract parameter types and SentrySDK type from sdk.generated.ts.
// This keeps the bundled .d.cts in sync with the generated SDK automatically.
const sdkSource = await Bun.file("./src/sdk.generated.ts").text();
const sdkTypes = extractSdkTypes(sdkSource);

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
