import fs from "node:fs";
import { MAX_FILE_BYTES } from "./constants.js";
import { detectSentry } from "./tools/detect-sentry.js";
import { listDir } from "./tools/list-dir.js";
import { safePath } from "./tools/shared.js";
import type { DirListingResult } from "./types.js";

/**
 * Common config files that multiple init steps frequently inspect.
 */
const COMMON_CONFIG_FILES = [
  "package.json",
  "tsconfig.json",
  "pyproject.toml",
  "requirements.txt",
  "requirements-dev.txt",
  "setup.py",
  "setup.cfg",
  "Pipfile",
  "Gemfile",
  "Gemfile.lock",
  "go.mod",
  "build.gradle",
  "build.gradle.kts",
  "settings.gradle",
  "settings.gradle.kts",
  "pom.xml",
  "Cargo.toml",
  "pubspec.yaml",
  "mix.exs",
  "composer.json",
  "Podfile",
  "CMakeLists.txt",
  "next.config.js",
  "next.config.mjs",
  "next.config.ts",
  "app.config.js",
  "app.config.mjs",
  "app.config.cjs",
  "app.config.ts",
  "nuxt.config.ts",
  "nuxt.config.js",
  "angular.json",
  "astro.config.mjs",
  "astro.config.ts",
  "svelte.config.js",
  "remix.config.js",
  "vite.config.ts",
  "vite.config.js",
  "webpack.config.js",
  "metro.config.js",
  "app.json",
  "electron-builder.yml",
  "wrangler.toml",
  "wrangler.jsonc",
  "serverless.yml",
  "serverless.ts",
  "bunfig.toml",
  "manage.py",
  "app.py",
  "main.py",
  "artisan",
  "symfony.lock",
  "wp-config.php",
  "config/packages/sentry.yaml",
  "appsettings.json",
  "Program.cs",
  "Startup.cs",
  "app/build.gradle",
  "app/build.gradle.kts",
  "src/main/resources/application.properties",
  "src/main/resources/application.yml",
  "config/application.rb",
  "main.go",
  "sentry.client.config.ts",
  "sentry.client.config.js",
  "sentry.server.config.ts",
  "sentry.server.config.js",
  "sentry.edge.config.ts",
  "sentry.edge.config.js",
  "sentry.properties",
  "instrumentation.ts",
  "instrumentation.js",
] as const;

const MAX_PREREAD_TOTAL_BYTES = 512 * 1024;
const INIT_DISCOVERY_MAX_DEPTH = 5;
const INIT_DISCOVERY_MAX_ENTRIES = 500;

/**
 * Pre-compute the initial directory listing before the first workflow call.
 */
export async function precomputeDirListing(
  directory: string
): Promise<DirListingResult> {
  const result = await listDir({
    type: "tool",
    operation: "list-dir",
    cwd: directory,
    params: {
      path: ".",
      recursive: true,
      maxDepth: INIT_DISCOVERY_MAX_DEPTH,
      maxEntries: INIT_DISCOVERY_MAX_ENTRIES,
    },
  });
  return {
    entries: [],
    truncated: false,
    skippedDirectories: [],
    maxDepth: INIT_DISCOVERY_MAX_DEPTH,
    maxEntries: INIT_DISCOVERY_MAX_ENTRIES,
    ...((result.data as Partial<DirListingResult> | undefined) ?? {}),
  };
}

/**
 * Pre-read common config files to avoid repeated suspend/resume round-trips.
 */
export async function preReadCommonFiles(
  directory: string
): Promise<Record<string, string | null>> {
  const cache: Record<string, string | null> = {};
  let totalBytes = 0;

  for (const filePath of COMMON_CONFIG_FILES) {
    if (totalBytes >= MAX_PREREAD_TOTAL_BYTES) {
      break;
    }
    try {
      const absPath = safePath(directory, filePath);
      const stat = await fs.promises.stat(absPath);
      // Guard against FIFOs / sockets / devices — `fs.readFile` on a
      // FIFO blocks indefinitely waiting for a writer. `stat` follows
      // symlinks, so a symlink → FIFO is also caught here.
      if (!stat.isFile()) {
        cache[filePath] = null;
        continue;
      }
      if (stat.size > MAX_FILE_BYTES) {
        continue;
      }
      const content = await fs.promises.readFile(absPath, "utf-8");
      if (totalBytes + content.length <= MAX_PREREAD_TOTAL_BYTES) {
        cache[filePath] = content;
        totalBytes += content.length;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        continue;
      }
      cache[filePath] = null;
    }
  }

  return cache;
}

/**
 * Pre-compute local Sentry detection so the workflow can start with that context.
 */
export async function precomputeSentryDetection(directory: string) {
  return await detectSentry(directory);
}
