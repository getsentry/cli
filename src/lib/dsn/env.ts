/**
 * Environment Variable Detection
 *
 * Detects DSN from SENTRY_DSN environment variable.
 * This is the highest priority source.
 */

import { getEnv } from "../env.js";
import { createDetectedDsn } from "./parser.js";
import type { DetectedDsn } from "./types.js";

/** Environment variable name for Sentry DSN */
export const SENTRY_DSN_ENV = "SENTRY_DSN";

/**
 * Framework-prefixed env var names that commonly hold a Sentry DSN.
 * Checked in order after `SENTRY_DSN` (canonical name has priority).
 */
const FRAMEWORK_DSN_VARS = [
  "NEXT_PUBLIC_SENTRY_DSN",
  "REACT_APP_SENTRY_DSN",
  "VITE_SENTRY_DSN",
  "EXPO_PUBLIC_SENTRY_DSN",
  "NUXT_PUBLIC_SENTRY_DSN",
] as const;

/**
 * Detect DSN from environment variables.
 *
 * Checks `SENTRY_DSN` first (canonical), then common framework-prefixed
 * variants (NEXT_PUBLIC_SENTRY_DSN, REACT_APP_SENTRY_DSN, etc.).
 *
 * @returns Detected DSN or null if not set/invalid
 *
 * @example
 * // With SENTRY_DSN=https://key@o123.ingest.sentry.io/456
 * const dsn = detectFromEnv();
 * // { raw: "...", source: "env", projectId: "456", ... }
 */
export function detectFromEnv(): DetectedDsn | null {
  const env = getEnv();

  const canonical = env[SENTRY_DSN_ENV];
  if (canonical) {
    return createDetectedDsn(canonical, "env");
  }

  for (const varName of FRAMEWORK_DSN_VARS) {
    const value = env[varName];
    if (value) {
      return createDetectedDsn(value, "env");
    }
  }

  return null;
}
