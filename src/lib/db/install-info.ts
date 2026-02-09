/**
 * Installation info persistence.
 *
 * Stores how the CLI was installed (method, path, version) in the metadata table.
 * This is used by the upgrade command to determine the appropriate upgrade method
 * without re-detecting every time.
 */

import type { InstallationMethod } from "../upgrade.js";
import { getDatabase } from "./index.js";
import { runUpsert } from "./utils.js";

const KEY_METHOD = "install.method";
const KEY_PATH = "install.path";
const KEY_VERSION = "install.version";
const KEY_RECORDED_AT = "install.recorded_at";

export type StoredInstallInfo = {
  /** How the CLI was installed */
  method: InstallationMethod;
  /** Absolute path to the binary */
  path: string;
  /** Version when installed or last upgraded */
  version: string;
  /** Unix timestamp (ms) when this info was recorded */
  recordedAt: number;
};

/**
 * Get the stored installation info.
 *
 * @returns Installation info if recorded, null otherwise
 */
export function getInstallInfo(): StoredInstallInfo | null {
  const db = getDatabase();

  const methodRow = db
    .query("SELECT value FROM metadata WHERE key = ?")
    .get(KEY_METHOD) as { value: string } | undefined;

  // If no method is stored, we have no install info
  if (!methodRow) {
    return null;
  }

  const pathRow = db
    .query("SELECT value FROM metadata WHERE key = ?")
    .get(KEY_PATH) as { value: string } | undefined;

  const versionRow = db
    .query("SELECT value FROM metadata WHERE key = ?")
    .get(KEY_VERSION) as { value: string } | undefined;

  const recordedAtRow = db
    .query("SELECT value FROM metadata WHERE key = ?")
    .get(KEY_RECORDED_AT) as { value: string } | undefined;

  return {
    method: methodRow.value as InstallationMethod,
    path: pathRow?.value ?? "",
    version: versionRow?.value ?? "",
    recordedAt: recordedAtRow ? Number(recordedAtRow.value) : 0,
  };
}

/**
 * Store installation info.
 *
 * @param info - Installation info to store (recordedAt is auto-set to now)
 */
export function setInstallInfo(
  info: Omit<StoredInstallInfo, "recordedAt">
): void {
  const db = getDatabase();
  const now = Date.now();

  runUpsert(db, "metadata", { key: KEY_METHOD, value: info.method }, ["key"]);
  runUpsert(db, "metadata", { key: KEY_PATH, value: info.path }, ["key"]);
  runUpsert(db, "metadata", { key: KEY_VERSION, value: info.version }, ["key"]);
  runUpsert(db, "metadata", { key: KEY_RECORDED_AT, value: String(now) }, [
    "key",
  ]);
}

/**
 * Clear stored installation info.
 * Useful for testing or when user wants to re-detect.
 */
export function clearInstallInfo(): void {
  const db = getDatabase();

  db.query("DELETE FROM metadata WHERE key = ?").run(KEY_METHOD);
  db.query("DELETE FROM metadata WHERE key = ?").run(KEY_PATH);
  db.query("DELETE FROM metadata WHERE key = ?").run(KEY_VERSION);
  db.query("DELETE FROM metadata WHERE key = ?").run(KEY_RECORDED_AT);
}
