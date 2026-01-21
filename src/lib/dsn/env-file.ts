/**
 * Environment File Detection
 *
 * Detects DSN from .env files in the project directory.
 * Supports various .env file variants in priority order.
 *
 * For monorepos, also scans common package directories (packages/, apps/, etc.)
 * to find DSNs in individual packages/apps.
 */

import { stat } from "node:fs/promises";
import { join } from "node:path";
import { createDetectedDsn } from "./parser.js";
import { scanSpecificFiles } from "./scanner.js";
import type { DetectedDsn } from "./types.js";
import { MONOREPO_ROOTS } from "./types.js";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/**
 * .env file names to search (in priority order).
 *
 * More specific files (.env.local, .env.development.local) are checked first
 * as they typically contain environment-specific overrides.
 */
export const ENV_FILES = [
  ".env.local",
  ".env.development.local",
  ".env.production.local",
  ".env",
  ".env.development",
  ".env.production",
] as const;

/**
 * Pattern to match SENTRY_DSN in .env files.
 * Handles: SENTRY_DSN=value, SENTRY_DSN="value", SENTRY_DSN='value'
 * Also handles trailing comments: SENTRY_DSN=value # comment
 */
const ENV_DSN_PATTERN = /^SENTRY_DSN\s*=\s*(['"]?)(.+?)\1\s*(?:#.*)?$/;

// ─────────────────────────────────────────────────────────────────────────────
// DSN Extraction
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extract SENTRY_DSN value from .env file content.
 *
 * Parses the content line by line, skipping comments and empty lines.
 * Handles quoted values and trailing comments.
 *
 * @param content - Raw file content
 * @returns DSN string or null if not found
 *
 * @example
 * ```typescript
 * extractDsnFromEnvContent('SENTRY_DSN="https://key@sentry.io/123"')
 * // Returns: "https://key@sentry.io/123"
 * ```
 */
export function extractDsnFromEnvContent(content: string): string | null {
  const lines = content.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip comments and empty lines
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    // Match SENTRY_DSN=value or SENTRY_DSN="value" or SENTRY_DSN='value'
    const match = trimmed.match(ENV_DSN_PATTERN);
    if (match?.[2]) {
      return match[2];
    }
  }

  return null;
}

// Legacy alias for backwards compatibility
export const parseEnvFile = extractDsnFromEnvContent;
export const extractDsnFromEnvFile = extractDsnFromEnvContent;

// ─────────────────────────────────────────────────────────────────────────────
// Detection Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Detect DSN from .env files in the given directory.
 *
 * Searches files in priority order and returns the first valid DSN found.
 * Does NOT scan monorepo subdirectories - use detectFromAllEnvFiles for that.
 *
 * @param cwd - Directory to search in
 * @returns First detected DSN or null if not found
 */
export async function detectFromEnvFiles(
  cwd: string
): Promise<DetectedDsn | null> {
  const results = await scanSpecificFiles(cwd, [...ENV_FILES], {
    stopOnFirst: true,
    processFile: (_relativePath, content) => {
      const dsn = extractDsnFromEnvContent(content);
      return dsn ? { dsn } : null;
    },
    createDsn: (raw, relativePath) =>
      createDetectedDsn(raw, "env_file", relativePath),
  });

  return results[0] ?? null;
}

/**
 * Detect DSN from ALL .env files including monorepo packages.
 *
 * Searches:
 * 1. Root .env files (.env.local, .env, etc.)
 * 2. Monorepo package directories (packages/star/.env, apps/star/.env, etc.)
 *
 * @param cwd - Directory to search in
 * @returns Array of all detected DSNs
 */
export async function detectFromAllEnvFiles(
  cwd: string
): Promise<DetectedDsn[]> {
  const results: DetectedDsn[] = [];

  // 1. Check root .env files (all of them, not just first)
  const rootResults = await scanSpecificFiles(cwd, [...ENV_FILES], {
    stopOnFirst: false,
    processFile: (_relativePath, content) => {
      const dsn = extractDsnFromEnvContent(content);
      return dsn ? { dsn } : null;
    },
    createDsn: (raw, relativePath) =>
      createDetectedDsn(raw, "env_file", relativePath),
  });
  results.push(...rootResults);

  // 2. Check monorepo package directories
  const monorepoResults = await detectFromMonorepoEnvFiles(cwd);
  results.push(...monorepoResults);

  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// Monorepo Support
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Detect DSN from .env files in monorepo package directories.
 *
 * Scans common monorepo patterns like packages/*, apps/*, etc.
 * for .env files containing SENTRY_DSN.
 *
 * @param cwd - Root directory to search from
 * @returns Array of detected DSNs with packagePath set
 */
export async function detectFromMonorepoEnvFiles(
  cwd: string
): Promise<DetectedDsn[]> {
  const results: DetectedDsn[] = [];
  const pkgGlob = new Bun.Glob("*");

  for (const monorepoRoot of MONOREPO_ROOTS) {
    const rootDir = join(cwd, monorepoRoot);

    try {
      // Scan for subdirectories (each is a potential package/app)
      for await (const pkgName of pkgGlob.scan({
        cwd: rootDir,
        onlyFiles: false,
      })) {
        const pkgDir = join(rootDir, pkgName);

        // Only process directories, not files
        try {
          const stats = await stat(pkgDir);
          if (!stats.isDirectory()) continue;
        } catch {
          continue;
        }

        const packagePath = `${monorepoRoot}/${pkgName}`;

        const detected = await detectDsnInPackage(pkgDir, packagePath);
        if (detected) {
          results.push(detected);
        }
      }
    } catch {
      // Directory doesn't exist or scan failed, skip this monorepo root
    }
  }

  return results;
}

/**
 * Detect DSN from .env files in a specific package directory.
 *
 * @param pkgDir - Full path to the package directory
 * @param packagePath - Relative package path (e.g., "packages/frontend")
 * @returns Detected DSN or null if not found
 */
async function detectDsnInPackage(
  pkgDir: string,
  packagePath: string
): Promise<DetectedDsn | null> {
  const results = await scanSpecificFiles(pkgDir, [...ENV_FILES], {
    stopOnFirst: true,
    processFile: (_relativePath, content) => {
      const dsn = extractDsnFromEnvContent(content);
      return dsn ? { dsn, metadata: { packagePath } } : null;
    },
    createDsn: (raw, relativePath, metadata) => {
      const sourcePath = `${packagePath}/${relativePath}`;
      return createDetectedDsn(
        raw,
        "env_file",
        sourcePath,
        metadata?.packagePath
      );
    },
  });

  return results[0] ?? null;
}

// Legacy export name for backwards compatibility with detector.ts
export const detectEnvFilesInMonorepo = detectFromMonorepoEnvFiles;
