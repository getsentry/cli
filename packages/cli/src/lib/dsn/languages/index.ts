/**
 * Language Detection Registry
 *
 * Unified scanner for detecting DSN from source code across all supported languages.
 * Uses a registry of language detectors to scan files by extension.
 *
 * ## Adding a New Language
 *
 * 1. Create `{lang}.ts` implementing `LanguageDetector`
 * 2. Import and add to `languageDetectors` array below
 * 3. Add tests in `test/lib/dsn/languages/{lang}.test.ts`
 *
 * @example
 * ```typescript
 * // languages/rust.ts
 * export const rustDetector: LanguageDetector = {
 *   name: "Rust",
 *   extensions: [".rs"],
 *   skipDirs: ["target"],
 *   extractDsn: (content) => { ... }
 * };
 * ```
 */

import { extname, join } from "node:path";
import { createDetectedDsn, inferPackagePath } from "../parser.js";
import type { DetectedDsn } from "../types.js";
import { goDetector } from "./go.js";
import { javaDetector } from "./java.js";
import { javascriptDetector } from "./javascript.js";
import { phpDetector } from "./php.js";
import { pythonDetector } from "./python.js";
import { rubyDetector } from "./ruby.js";
import type { LanguageDetector } from "./types.js";

// ─────────────────────────────────────────────────────────────────────────────
// Registry
// ─────────────────────────────────────────────────────────────────────────────

/**
 * All supported language detectors.
 *
 * Order matters for performance - most common languages first.
 * Add new detectors here after creating the detector file.
 */
export const languageDetectors: LanguageDetector[] = [
  javascriptDetector,
  pythonDetector,
  phpDetector,
  rubyDetector,
  goDetector,
  javaDetector,
];

// ─────────────────────────────────────────────────────────────────────────────
// Derived Configuration
// ─────────────────────────────────────────────────────────────────────────────

/** Map of file extension to detector for fast lookup */
const extensionToDetector = new Map<string, LanguageDetector>();
for (const detector of languageDetectors) {
  for (const ext of detector.extensions) {
    extensionToDetector.set(ext, detector);
  }
}

/** Combined set of all skip directories from all detectors */
const allSkipDirs = new Set<string>();
for (const detector of languageDetectors) {
  for (const dir of detector.skipDirs) {
    allSkipDirs.add(dir);
  }
}

/** All file extensions to scan */
const allExtensions = languageDetectors.flatMap((d) => d.extensions);

/** Glob pattern matching all supported file extensions */
const globPattern = `**/*{${allExtensions.join(",")}}`;
const codeGlob = new Bun.Glob(globPattern);

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get the appropriate detector for a file based on its extension.
 *
 * Used by cache verification to extract DSN from a specific file.
 *
 * @param filepath - File path to get detector for
 * @returns The matching detector, or undefined if no detector handles this extension
 */
export function getDetectorForFile(
  filepath: string
): LanguageDetector | undefined {
  const ext = extname(filepath);
  return extensionToDetector.get(ext);
}

/**
 * Detect DSN from source code files in a directory.
 *
 * Scans all supported languages and returns the first DSN found.
 * This is the fast path for single-project detection.
 *
 * @param cwd - Directory to search in
 * @returns First detected DSN or null if not found
 */
export async function detectFromCode(cwd: string): Promise<DetectedDsn | null> {
  const results = await scanCodeFiles(cwd, true);
  return results[0] ?? null;
}

/**
 * Detect DSN from ALL source code files.
 *
 * Unlike detectFromCode, this doesn't stop at the first match.
 * Useful for monorepos with multiple Sentry projects.
 *
 * @param cwd - Directory to search in
 * @returns Array of all detected DSNs with packagePath inferred
 */
export async function detectAllFromCode(cwd: string): Promise<DetectedDsn[]> {
  return scanCodeFiles(cwd, false);
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check if a path should be skipped during scanning.
 *
 * @param filepath - Relative file path to check
 * @returns True if any path segment matches a skip directory
 */
function shouldSkipPath(filepath: string): boolean {
  const parts = filepath.split("/");
  return parts.some((part) => allSkipDirs.has(part));
}

/**
 * Scan code files for DSNs.
 *
 * @param cwd - Directory to search in
 * @param stopOnFirst - Whether to stop after first match
 * @returns Array of detected DSNs
 */
async function scanCodeFiles(
  cwd: string,
  stopOnFirst: boolean
): Promise<DetectedDsn[]> {
  const results: DetectedDsn[] = [];

  for await (const relativePath of codeGlob.scan({ cwd, onlyFiles: true })) {
    if (shouldSkipPath(relativePath)) {
      continue;
    }

    const detector = getDetectorForFile(relativePath);
    if (!detector) {
      continue;
    }

    const filepath = join(cwd, relativePath);

    try {
      const content = await Bun.file(filepath).text();
      const dsn = detector.extractDsn(content);

      if (dsn) {
        const packagePath = inferPackagePath(relativePath);
        const detected = createDetectedDsn(
          dsn,
          "code",
          relativePath,
          packagePath
        );

        if (detected) {
          results.push(detected);

          if (stopOnFirst) {
            return results;
          }
        }
      }
    } catch {
      // Skip files we can't read
    }
  }

  return results;
}
