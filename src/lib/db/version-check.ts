/**
 * Version check state persistence.
 *
 * Stores the last time we checked for updates and the latest known version
 * in the metadata table for the "new version available" notification.
 */

import { getDatabase } from "./index.js";
import { runUpsert } from "./utils.js";

const KEY_LAST_CHECKED = "version_check.last_checked";
const KEY_LATEST_VERSION = "version_check.latest_version";

export type VersionCheckInfo = {
  /** Unix timestamp (ms) of last check, or null if never checked */
  lastChecked: number | null;
  /** Latest version string from GitHub, or null if never fetched */
  latestVersion: string | null;
};

/**
 * Get the stored version check state.
 */
export function getVersionCheckInfo(): VersionCheckInfo {
  const db = getDatabase();

  const lastCheckedRow = db
    .query("SELECT value FROM metadata WHERE key = ?")
    .get(KEY_LAST_CHECKED) as { value: string } | undefined;

  const latestVersionRow = db
    .query("SELECT value FROM metadata WHERE key = ?")
    .get(KEY_LATEST_VERSION) as { value: string } | undefined;

  return {
    lastChecked: lastCheckedRow ? Number(lastCheckedRow.value) : null,
    latestVersion: latestVersionRow?.value ?? null,
  };
}

/**
 * Store the version check result.
 * Updates both the last checked timestamp and the latest known version.
 */
export function setVersionCheckInfo(latestVersion: string): void {
  const db = getDatabase();
  const now = Date.now();

  runUpsert(db, "metadata", { key: KEY_LAST_CHECKED, value: String(now) }, [
    "key",
  ]);
  runUpsert(db, "metadata", { key: KEY_LATEST_VERSION, value: latestVersion }, [
    "key",
  ]);
}
