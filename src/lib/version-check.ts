/**
 * Background version check for "new version available" notifications.
 *
 * Checks GitHub releases for new versions without blocking CLI execution.
 * Results are cached in the database and shown on subsequent runs.
 */

// biome-ignore lint/performance/noNamespaceImport: Sentry SDK recommends namespace import
import * as Sentry from "@sentry/bun";
import { CLI_VERSION } from "./constants.js";
import {
  getVersionCheckInfo,
  setVersionCheckInfo,
} from "./db/version-check.js";
import { cyan, muted } from "./formatters/colors.js";
import { fetchLatestFromGitHub } from "./upgrade.js";

/** Target check interval: ~24 hours */
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** Jitter factor for probabilistic checking (±20%) */
const JITTER_FACTOR = 0.2;

/** Commands/flags that should not show update notifications */
const SUPPRESSED_ARGS = new Set([
  "upgrade",
  "--version",
  "-V",
  "--json",
  "token",
]);

/** AbortController for pending version check fetch */
let pendingAbortController: AbortController | null = null;

/**
 * Determine if we should check for updates based on time since last check.
 * Uses probabilistic approach: probability increases as we approach/pass the interval.
 */
function shouldCheckForUpdate(): boolean {
  const { lastChecked } = getVersionCheckInfo();

  if (lastChecked === null) {
    return true;
  }

  const elapsed = Date.now() - lastChecked;

  // Add jitter to the interval (±20%)
  const jitter = (Math.random() - 0.5) * 2 * JITTER_FACTOR;
  const effectiveInterval = CHECK_INTERVAL_MS * (1 + jitter);

  // Probability ramps up as we approach/exceed the interval
  // At 0% of interval: ~0% chance
  // At 100% of interval: ~63% chance (1 - 1/e)
  // At 200% of interval: ~86% chance
  const probability = 1 - Math.exp(-elapsed / effectiveInterval);

  return Math.random() < probability;
}

/**
 * Check if update notifications should be suppressed for these args.
 */
export function shouldSuppressNotification(args: string[]): boolean {
  return args.some((arg) => SUPPRESSED_ARGS.has(arg));
}

/**
 * Abort any pending version check to allow process exit.
 * Call this when main CLI work is complete.
 */
export function abortPendingVersionCheck(): void {
  pendingAbortController?.abort();
  pendingAbortController = null;
}

/**
 * Start a background check for new versions.
 * Does not block - fires a fetch and lets it complete in the background.
 * Reports errors to Sentry in a detached span for visibility.
 * Never throws - errors are caught and reported to Sentry.
 */
function checkForUpdateInBackgroundImpl(): void {
  try {
    if (!shouldCheckForUpdate()) {
      return;
    }
  } catch (error) {
    // DB access failed - report to Sentry but don't crash CLI
    Sentry.captureException(error);
    return;
  }

  pendingAbortController = new AbortController();
  const { signal } = pendingAbortController;

  Sentry.startSpanManual(
    {
      name: "version-check",
      op: "version.check",
      forceTransaction: true,
    },
    async (span) => {
      try {
        const latestVersion = await fetchLatestFromGitHub(signal);
        setVersionCheckInfo(latestVersion);
        span.setStatus({ code: 1 }); // OK
      } catch (error) {
        // Don't report abort errors - they're expected when process exits
        if (error instanceof Error && error.name !== "AbortError") {
          Sentry.captureException(error);
        }
        span.setStatus({ code: 2 }); // Error
      } finally {
        pendingAbortController = null;
        span.end();
      }
    }
  );
}

/**
 * Get the update notification message if a new version is available.
 * Returns null if up-to-date, no cached version info, or on error.
 * Never throws - errors are caught and reported to Sentry.
 */
function getUpdateNotificationImpl(): string | null {
  try {
    const { latestVersion } = getVersionCheckInfo();

    if (!latestVersion) {
      return null;
    }

    // Use Bun's native semver comparison (polyfilled for Node.js)
    // order() returns 1 if first arg is greater than second
    if (Bun.semver.order(latestVersion, CLI_VERSION) !== 1) {
      return null;
    }

    return `\n${muted("Update available:")} ${cyan(CLI_VERSION)} -> ${cyan(latestVersion)}  Run ${cyan('"sentry cli upgrade"')} to update.\n`;
  } catch (error) {
    // DB access failed - report to Sentry but don't crash CLI
    Sentry.captureException(error);
    return null;
  }
}

/**
 * Check if update checking is disabled via environment variable.
 * Checked at runtime to support test isolation.
 */
function isUpdateCheckDisabled(): boolean {
  return process.env.SENTRY_CLI_NO_UPDATE_CHECK === "1";
}

/**
 * Start a background check for new versions (if not disabled).
 * Does not block - fires a fetch and lets it complete in the background.
 */
export function maybeCheckForUpdateInBackground(): void {
  if (isUpdateCheckDisabled()) {
    return;
  }
  checkForUpdateInBackgroundImpl();
}

/**
 * Get the update notification message if a new version is available.
 * Returns null if disabled, up-to-date, no cached version info, or on error.
 */
export function getUpdateNotification(): string | null {
  if (isUpdateCheckDisabled()) {
    return null;
  }
  return getUpdateNotificationImpl();
}
