/**
 * Instance identifier for telemetry.
 *
 * Generates and persists a unique identifier for this CLI installation.
 * Uses UUIDv7 for time-sortable, unique identifiers.
 */

import { getDatabase } from "./index.js";

/**
 * Get the instance ID, generating one if it doesn't exist.
 *
 * The instance ID is generated once on first access and persisted
 * in the database. It identifies this CLI installation for telemetry.
 */
export function getInstanceId(): string {
  const db = getDatabase();

  // Try to get existing instance ID
  const existingRow = db
    .query("SELECT instance_id FROM instance_info WHERE id = 1")
    .get() as { instance_id: string } | undefined;

  if (existingRow) {
    return existingRow.instance_id;
  }

  // Generate and store new instance ID
  // Use INSERT OR IGNORE to handle race condition when multiple CLI processes
  // start simultaneously - only the first insert succeeds
  // Bun.randomUUIDv7() is native in Bun, polyfilled via uuidv7 package for Node.js
  const instanceId = Bun.randomUUIDv7();
  const now = Date.now();

  db.query(`
    INSERT OR IGNORE INTO instance_info (id, instance_id, created_at)
    VALUES (1, ?, ?)
  `).run(instanceId, now);

  // Re-fetch to get the actual stored value (may differ if another process won the race)
  const row = db
    .query("SELECT instance_id FROM instance_info WHERE id = 1")
    .get() as { instance_id: string };

  return row.instance_id;
}
