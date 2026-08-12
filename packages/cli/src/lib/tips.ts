/**
 * Tip-hint suppression.
 *
 * Commands return a footer `{ hint: "Tip: ..." }` that `buildCommand` renders
 * below the output. Users who find these tips noisy can turn them off with the
 * global `--no-tips` flag or the `SENTRY_DISABLE_TIPS` environment variable.
 *
 * The cache-age footer ("cached · 3m ago · use -f to refresh") is a staleness
 * indicator rather than a tip, so it is left untouched.
 *
 * getsentry/cli#1412
 *
 * @module
 */

import { getEnv } from "./env.js";
import { isTruthyEnv } from "./formatters/plain-detect.js";

/**
 * Decide whether command tip hints should be suppressed.
 *
 * - Explicit `--no-tips` (flag value `false`) always wins.
 * - Otherwise, honor `SENTRY_DISABLE_TIPS` using the shared truthy-env
 *   semantics (`"0"` / `"false"` / `""` are falsy).
 * - Default: tips are shown.
 *
 * @param tipsFlag - Value of the injected global `tips` flag (defaults to
 *   `true`; `false` when the user passed `--no-tips`).
 */
export function tipsSuppressed(tipsFlag: boolean | undefined): boolean {
  if (tipsFlag === false) {
    return true;
  }
  const envVal = getEnv().SENTRY_DISABLE_TIPS;
  if (envVal !== undefined) {
    return isTruthyEnv(envVal);
  }
  return false;
}
