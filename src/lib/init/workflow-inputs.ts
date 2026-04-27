/**
 * Local preflight that captures a snapshot of the user's project so the
 * agent has phase-1 context on its very first turn — no bridge round-
 * trip needed for the initial `list_dir` / `read_files` calls. Modeled
 * on the main-branch `workflow-inputs.ts`.
 *
 * The output is sent to the server as `InitStartInput.projectContext`
 * and embedded directly in the Claude user prompt.
 */

import fs from "node:fs";
import path from "node:path";
import { MAX_FILE_BYTES } from "./constants.js";
import { detectSentry } from "./tools/detect-sentry.js";
import { listDir } from "./tools/list-dir.js";
import type { DirEntry } from "./types.js";

/**
 * Common config files that almost every init run needs to inspect.
 * Whitelist over all platforms we support — package.json, tsconfig,
 * framework configs, manifests for Python/Ruby/Go/etc.
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

export type ExistingSentryDetection = {
  status: "none" | "installed";
  signals: string[];
  dsn?: string;
};

export type ProjectContext = {
  dirListing: DirEntry[];
  configFiles: Record<string, string | null>;
  existingSentry: ExistingSentryDetection;
};

/**
 * Pre-compute a recursive directory listing capped at depth 3 / 500
 * entries. Skips `node_modules` (and other VCS / build noise that
 * `listDir` already filters by default).
 */
export async function precomputeDirListing(
  directory: string
): Promise<DirEntry[]> {
  const result = await listDir({
    type: "tool",
    operation: "list-dir",
    cwd: directory,
    params: { path: ".", recursive: true, maxDepth: 3, maxEntries: 500 },
  });
  if (!result.ok) return [];
  const data = result.data as { entries?: DirEntry[] } | undefined;
  return data?.entries ?? [];
}

/**
 * Pre-read the subset of `COMMON_CONFIG_FILES` that exist in the
 * project. Capped at 512 KB total (per-file cap from MAX_FILE_BYTES);
 * unread-able / over-large files come back as `null` so the agent can
 * see they exist but didn't fit in the prompt.
 */
export async function preReadCommonFiles(
  directory: string,
  dirListing: DirEntry[]
): Promise<Record<string, string | null>> {
  // `listDir` emits POSIX-normalized paths regardless of host OS, so
  // membership against the POSIX whitelist works on Windows too.
  const listingPaths = new Set(dirListing.map((entry) => entry.path));
  const toRead = COMMON_CONFIG_FILES.filter((filePath) =>
    listingPaths.has(filePath)
  );

  const cache: Record<string, string | null> = {};
  let totalBytes = 0;

  for (const filePath of toRead) {
    if (totalBytes >= MAX_PREREAD_TOTAL_BYTES) break;
    try {
      const absPath = path.join(directory, filePath);
      const stat = await fs.promises.stat(absPath);
      // Guard against FIFOs / sockets / devices — `fs.readFile` on a
      // FIFO blocks indefinitely. `stat` follows symlinks, so a
      // symlink to a FIFO is also caught here.
      if (!stat.isFile()) {
        cache[filePath] = null;
        continue;
      }
      if (stat.size > MAX_FILE_BYTES) {
        cache[filePath] = null;
        continue;
      }
      const content = await fs.promises.readFile(absPath, "utf-8");
      if (totalBytes + content.length <= MAX_PREREAD_TOTAL_BYTES) {
        cache[filePath] = content;
        totalBytes += content.length;
      } else {
        cache[filePath] = null;
      }
    } catch {
      cache[filePath] = null;
    }
  }

  return cache;
}

/**
 * Detect existing Sentry signals (DSN env vars, source-code hits) so
 * the agent can decide between fresh-install and instrumentation-tuning.
 */
export async function precomputeSentryDetection(
  directory: string
): Promise<ExistingSentryDetection> {
  const result = await detectSentry(directory);
  if (!result.ok) {
    return { status: "none", signals: [] };
  }
  const data = result.data as
    | { status?: "none" | "installed"; signals?: string[]; dsn?: string }
    | undefined;
  return {
    status: data?.status ?? "none",
    signals: data?.signals ?? [],
    ...(data?.dsn ? { dsn: data.dsn } : {}),
  };
}

/**
 * Run all three preflight steps for a project. Failures are non-fatal:
 * we return an empty / partial context rather than aborting the wizard.
 */
export async function precomputeProjectContext(
  directory: string
): Promise<ProjectContext> {
  const dirListing = await precomputeDirListing(directory).catch(() => []);
  const [configFiles, existingSentry] = await Promise.all([
    preReadCommonFiles(directory, dirListing).catch(() => ({})),
    precomputeSentryDetection(directory).catch(
      () => ({ status: "none", signals: [] }) as ExistingSentryDetection
    ),
  ]);
  return { dirListing, configFiles, existingSentry };
}
