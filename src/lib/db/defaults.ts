/**
 * Default Organization/Project Storage
 *
 * CRUD operations for default org/project settings in SQLite.
 * Uses a single-row table pattern (id = 1) for the defaults entry.
 *
 * No TTL - defaults persist indefinitely until explicitly changed.
 */

import { getDatabase } from "./index.js";

/** Defaults row shape from database */
type DefaultsRow = {
  organization: string | null;
  project: string | null;
  updated_at: number;
};

/**
 * Get default organization.
 */
export async function getDefaultOrganization(): Promise<string | undefined> {
  const db = getDatabase();
  const row = db
    .query("SELECT organization FROM defaults WHERE id = 1")
    .get() as Pick<DefaultsRow, "organization"> | undefined;

  return row?.organization ?? undefined;
}

/**
 * Get default project.
 */
export async function getDefaultProject(): Promise<string | undefined> {
  const db = getDatabase();
  const row = db.query("SELECT project FROM defaults WHERE id = 1").get() as
    | Pick<DefaultsRow, "project">
    | undefined;

  return row?.project ?? undefined;
}

/**
 * Set default organization and/or project.
 *
 * @param organization - Organization slug (optional)
 * @param project - Project slug (optional)
 */
export async function setDefaults(
  organization?: string,
  project?: string
): Promise<void> {
  const db = getDatabase();
  const now = Date.now();

  // Get current values
  const current = db
    .query("SELECT organization, project FROM defaults WHERE id = 1")
    .get() as Pick<DefaultsRow, "organization" | "project"> | undefined;

  // Merge with existing values (only update what's provided)
  const newOrg = organization ?? current?.organization ?? null;
  const newProject = project ?? current?.project ?? null;

  db.query(`
    INSERT INTO defaults (id, organization, project, updated_at)
    VALUES (1, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      organization = excluded.organization,
      project = excluded.project,
      updated_at = excluded.updated_at
  `).run(newOrg, newProject, now);
}
