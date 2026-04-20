/**
 * Bench fixture presets.
 *
 * Three size tiers for benchmarking DSN detection, project-root finding,
 * and the new `src/lib/scan/` module. Presets target approximate total
 * file counts (text + binary) to give predictable scan budgets:
 *
 *   - small:  ~100 files  (single-repo, single flat tree)
 *   - medium: ~1,000 files (monorepo with 10 packages)
 *   - large:  ~10,000 files (monorepo with 20 packages)
 *
 * Everything is derived from the FixtureSpec in `generate.ts`, so any
 * ratio can be overridden on a per-invocation basis (e.g. for micro
 * benchmarks that need extreme binary/DSN ratios).
 */

import type { FixtureSpec } from "./generate.js";

/** Single-repo preset with a flat src/ tree. */
export const SMALL: Omit<FixtureSpec, "rootDir" | "seed"> = {
  packages: 0,
  filesPerPackage: 100,
  fileExtensions: [".ts", ".tsx", ".js", ".json", ".yml", ".md"],
  binaryRatio: 0.05,
  dsnRatio: 0.1,
  gitignoreDepth: "root",
  avgFileKB: 4,
  subdirDepth: 2,
};

/** Monorepo with ~1k files across 10 packages, nested .gitignores. */
export const MEDIUM: Omit<FixtureSpec, "rootDir" | "seed"> = {
  packages: 10,
  filesPerPackage: 100,
  fileExtensions: [".ts", ".tsx", ".js", ".json", ".yml", ".py", ".md"],
  binaryRatio: 0.08,
  dsnRatio: 0.12,
  gitignoreDepth: "nested",
  avgFileKB: 6,
  subdirDepth: 3,
};

/** Monorepo with ~10k files across 20 packages, nested .gitignores. */
export const LARGE: Omit<FixtureSpec, "rootDir" | "seed"> = {
  packages: 20,
  filesPerPackage: 500,
  fileExtensions: [
    ".ts",
    ".tsx",
    ".js",
    ".mjs",
    ".json",
    ".yml",
    ".py",
    ".go",
    ".md",
  ],
  binaryRatio: 0.1,
  dsnRatio: 0.08,
  gitignoreDepth: "nested",
  avgFileKB: 8,
  subdirDepth: 3,
};

/** Preset registry keyed by name for --size flag and tests. */
export const PRESETS = {
  small: SMALL,
  medium: MEDIUM,
  large: LARGE,
} as const satisfies Record<string, Omit<FixtureSpec, "rootDir" | "seed">>;

export type PresetName = keyof typeof PRESETS;

/** All preset names in size order, for iteration in the default bench run. */
export const PRESET_NAMES = ["small", "medium", "large"] as const;
