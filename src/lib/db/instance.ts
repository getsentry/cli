/**
 * Instance identifier for telemetry.
 *
 * Generates and persists a unique identifier for this CLI installation.
 * Uses UUIDv7 for time-sortable, unique identifiers.
 */

import { getDatabase } from "./index.js";

/**
 * Generate a UUIDv7 (time-ordered UUID).
 *
 * UUIDv7 encodes a Unix timestamp in milliseconds in the first 48 bits,
 * making it time-sortable while remaining globally unique.
 *
 * Uses Bun's native randomUUIDv7 if available (Bun 1.0.30+),
 * otherwise falls back to a simple implementation for Node.js (npm bundle).
 */
function generateUUIDv7(): string {
  // Bun 1.0.30+ has native UUIDv7 support
  if (typeof Bun !== "undefined" && typeof Bun.randomUUIDv7 === "function") {
    return Bun.randomUUIDv7();
  }

  // Fallback implementation for Node.js (npm bundle)
  const timestamp = Date.now();

  // Get 10 random bytes for the random portion
  const randomBytes = new Uint8Array(10);
  crypto.getRandomValues(randomBytes);

  // Build UUIDv7: tttttttt-tttt-7xxx-yxxx-xxxxxxxxxxxx
  // t = timestamp (48 bits)
  // 7 = version (4 bits)
  // x = random (12 bits)
  // y = variant (2 bits, value 8-b)
  // x = random (62 bits)

  // Convert timestamp to 12 hex chars (48 bits)
  const timestampHex = timestamp.toString(16).padStart(12, "0");

  // Convert random bytes to hex
  const randomHex = Array.from(randomBytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  // Set version (7) and variant (8-b) bits
  const version = "7";
  // randomBytes[2] is guaranteed to exist since we allocated 10 bytes
  const variantByte = randomBytes[2] ?? 0;
  // biome-ignore lint/suspicious/noBitwiseOperators: Required for UUIDv7 variant bits
  const variant = ((variantByte & 0x3f) | 0x80).toString(16).padStart(2, "0");

  return [
    timestampHex.slice(0, 8), // First 8 hex chars of timestamp
    timestampHex.slice(8, 12), // Next 4 hex chars of timestamp
    `${version}${randomHex.slice(0, 3)}`, // Version + 3 random hex chars
    `${variant}${randomHex.slice(4, 6)}`, // Variant + 2 random hex chars
    randomHex.slice(6, 18), // Remaining 12 random hex chars
  ].join("-");
}

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
  const instanceId = generateUUIDv7();
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
