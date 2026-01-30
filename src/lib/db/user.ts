/**
 * User identity storage for telemetry.
 *
 * Stores user info fetched from Sentry API to set Sentry user context.
 */

import { getDatabase } from "./index.js";

export type UserInfo = {
  userId: string;
  email?: string;
  username?: string;
};

type UserRow = {
  user_id: string;
  email: string | null;
  username: string | null;
};

/**
 * Get stored user info.
 * Returns undefined if no user info is stored.
 */
export function getUserInfo(): UserInfo | undefined {
  const db = getDatabase();
  const row = db.query("SELECT * FROM user_info WHERE id = 1").get() as
    | UserRow
    | undefined;

  if (!row) {
    return;
  }

  return {
    userId: row.user_id,
    email: row.email ?? undefined,
    username: row.username ?? undefined,
  };
}

/**
 * Store user info.
 * Overwrites any existing user info.
 */
export function setUserInfo(info: UserInfo): void {
  const db = getDatabase();
  const now = Date.now();

  db.query(`
    INSERT INTO user_info (id, user_id, email, username, updated_at)
    VALUES (1, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      user_id = excluded.user_id,
      email = excluded.email,
      username = excluded.username,
      updated_at = excluded.updated_at
  `).run(info.userId, info.email ?? null, info.username ?? null, now);
}

/**
 * Clear stored user info.
 * Called during logout.
 */
export function clearUserInfo(): void {
  const db = getDatabase();
  db.query("DELETE FROM user_info WHERE id = 1").run();
}
